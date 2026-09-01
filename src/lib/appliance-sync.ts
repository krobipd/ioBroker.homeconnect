// Appliance sync + write routing — extracted from main.ts so the device-tree
// building and the write path are a testable unit (a fake AdapterPort stands in
// for the adapter). main.ts keeps the lifecycle, OAuth, event-stream wiring and
// the REST transport (apiGet/apiWrite, which own the token + 401-refresh);
// ApplianceSync holds the object-tree state and turns BSH data ↔ ioBroker states.

import {
  transformItem,
  expandBshItem,
  isDoorStatusKey,
  transformOptionDefinition,
  shortEnum,
  stateIdForKey,
  parseConstraints,
  type BshOptionDefinition,
  type TransformedState,
} from "./value-transformer";
import { eventKeysForType, LOCKABLE_DOOR_TYPES, PROGRAMLESS_TYPES } from "./device-catalog";
import { resolveWrite, type WriteContext, type WriteRequest } from "./command-dispatch";
import { slugify, disambiguateSlug, isRecord, errMessage } from "./pure-helpers";
import type { SseEvent } from "./sse-parser";
import type { JsonResult } from "./http";

/** The slice of the adapter ApplianceSync needs — injected so it can be faked in tests. */
export interface AdapterPort {
  /** The adapter namespace, e.g. "homeconnect.0". */
  readonly namespace: string;
  /** The adapter logger. */
  readonly log: ioBroker.Logger;
  /** Create/extend an object (idempotent). */
  extendObject(id: string, obj: ioBroker.PartialObject): Promise<unknown>;
  /** Set a state value. */
  setState(id: string, state: ioBroker.SettableState): Promise<unknown>;
  /** Set a state value only if it changed. */
  setStateChanged(id: string, state: ioBroker.SettableState): Promise<unknown>;
  /** Read a state. */
  getState(id: string): Promise<ioBroker.State | null | undefined>;
  /** Read an object. */
  getObject(id: string): Promise<ioBroker.Object | null | undefined>;
  /** Create an object only if it does not exist (full shape, no merge). */
  setObjectNotExists(id: string, obj: ioBroker.PartialObject): Promise<unknown>;
  /** Delete an object (leaf state). */
  delObject(id: string): Promise<void>;
  /** Delete an object and everything below it (a whole appliance tree). */
  delObjectRecursive(id: string): Promise<void>;
  /** Enumerate this instance's objects of a type (for start-up priming). */
  getForeignObjects(pattern: string, type: "state" | "device"): Promise<Record<string, ioBroker.Object>>;
  /** GET a Home Connect resource (token + 401-refresh handled by main); undefined on failure. */
  apiGet(path: string): Promise<unknown>;
  /** Send a Home Connect write (token + 401-refresh handled by main). */
  apiWrite(req: WriteRequest): Promise<JsonResult | undefined>;
}

/** What a known state carries: its BSH key + candidate values (for the write-back resolve). */
interface KnownState {
  bshKey?: string;
  bshValues?: string[];
  /** Signature of the object parts we own — a REST re-sync refreshes the object when it changes. */
  metaSig?: string;
}

/** The `common` fields the transformer owns. `name` is deliberately absent: a user rename survives. */
const OWNED_COMMON_KEYS = ["type", "role", "read", "write", "unit", "min", "max", "step", "states", "def"] as const;

/**
 * Deterministic signature of the object parts the adapter owns (the transformer's
 * `common` fields minus `name`, plus the BSH native data). Computed both from a
 * fresh transform and from a DB object at priming, so an unchanged object never
 * gets rewritten — and a changed one (new allowed values, changed bounds, improved
 * transform in a new adapter version) is detected and refreshed exactly once.
 *
 * @param common the state's `common` (fresh from the transformer, or from the DB)
 * @param native the BSH parts of the state's `native`
 * @param native.bshKey the fully-qualified BSH key
 * @param native.bshValues the full BSH candidate values of a writable enum
 * @returns a stable string signature
 */
export function metaSignature(
  common: Partial<ioBroker.StateCommon>,
  native: { bshKey?: string; bshValues?: string[] },
): string {
  const c = common as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of OWNED_COMMON_KEYS) {
    const v = key === "states" && c[key] !== null && typeof c[key] === "object" ? sortedRecord(c[key]) : c[key];
    if (v !== undefined) {
      picked[key] = v;
    }
  }
  return JSON.stringify({ c: picked, k: native.bshKey, v: native.bshValues });
}

/**
 * A key-sorted shallow copy, so the signature does not depend on insertion order.
 *
 * @param v the record to sort (already checked to be a non-null object)
 * @returns the same entries in sorted key order
 */
function sortedRecord(v: unknown): Record<string, unknown> {
  const rec = v as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(rec)
      .sort()
      .map(k => [k, rec[k]]),
  );
}

/** Builds + updates the appliance object tree and routes writes back to the Home Connect API. */
export class ApplianceSync {
  /** haId → speaking device id, for routing stream events. */
  private readonly deviceIdByHaId = new Map<string, string>();
  /** speaking device id → haId, for routing writes back to the appliance. */
  private readonly haIdByDeviceId = new Map<string, string>();
  /** Namespace-relative state id → its BSH key + candidate values; also gates object creation. */
  private readonly knownStates = new Map<string, KnownState>();
  /** device id → the option ids from the selected program's definition (writable, sent on start). */
  private readonly optionKeys = new Map<string, Set<string>>();
  /** device ids with an in-flight data sync — serialises concurrent CONNECTED/re-sync events. */
  private readonly syncing = new Set<string>();
  /** device id → its last written reachable value, the single source for the instance summary. */
  private readonly reachableByDeviceId = new Map<string, boolean>();
  /** device id → its appliance type ("WasherDryer", …) — drives the catalog (events, door form, programs). */
  private readonly typeByDeviceId = new Map<string, string>();
  /**
   * device id → program key → its option state ids. The definition cache: each
   * program definition is fetched ONCE, then remembered here and persisted in the
   * device object's native (an internal attribute, not a datapoint) — so a program
   * change or re-sync costs no definition request at all, which keeps the daily
   * request budget untouched and sidesteps the "wrong operation state" refusal
   * while a program runs.
   */
  private readonly programDefs = new Map<string, Record<string, string[]>>();

  /**
   * @param port the injected adapter capabilities
   */
  constructor(private readonly port: AdapterPort) {}

  /**
   * Prime the in-memory maps from the objects already in the DB, so writes work
   * for an appliance that is offline at start (its objects exist from a previous
   * run but no REST re-sync populated the maps this run). Covers all four write
   * readers: knownStates + optionKeys + the deviceId↔haId maps.
   */
  async primeFromObjects(): Promise<void> {
    const prefix = `${this.port.namespace}.`;
    try {
      // Device objects carry the haId in native — without the deviceId↔haId maps
      // the write path can't resolve a target, so this must run before the state pass.
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      for (const [fullId, obj] of Object.entries(devices)) {
        const deviceId = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (obj.native ?? {}) as { haId?: unknown; type?: unknown; programOptions?: unknown };
        if (deviceId.length > 0 && !deviceId.includes(".") && typeof native.haId === "string") {
          this.deviceIdByHaId.set(native.haId, deviceId);
          this.haIdByDeviceId.set(deviceId, native.haId);
          if (typeof native.type === "string") {
            this.typeByDeviceId.set(deviceId, native.type);
          }
          // Restore the persisted definition cache — across restarts no program
          // definition is ever fetched again unless a new program appears.
          if (isRecord(native.programOptions)) {
            const defs: Record<string, string[]> = {};
            for (const [program, ids] of Object.entries(native.programOptions)) {
              if (Array.isArray(ids)) {
                defs[program] = ids.filter((v): v is string => typeof v === "string");
              }
            }
            this.programDefs.set(deviceId, defs);
          }
        }
      }
    } catch (e) {
      this.port.log.debug(`priming devices from objects failed: ${errMessage(e)}`);
    }
    try {
      const objects = await this.port.getForeignObjects(`${this.port.namespace}.*`, "state");
      for (const [fullId, obj] of Object.entries(objects)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (obj.native ?? {}) as { bshKey?: unknown; bshValues?: unknown };
        const bshKey = typeof native.bshKey === "string" ? native.bshKey : undefined;
        const bshValues = Array.isArray(native.bshValues)
          ? native.bshValues.filter((v): v is string => typeof v === "string")
          : undefined;
        this.knownStates.set(rel, {
          bshKey,
          bshValues,
          // The pattern is type-filtered to states, so common is a StateCommon.
          metaSig: metaSignature((obj.common ?? {}) as Partial<ioBroker.StateCommon>, { bshKey, bshValues }),
        });
        const parts = rel.split(".");
        // Writable options.* belong to the start-payload set (optionKeys); read-only
        // display options (RemainingProgramTime, …) must not.
        if (parts.length === 3 && parts[1] === "options" && obj.common?.write === true) {
          const deviceId = parts[0];
          const set = this.optionKeys.get(deviceId) ?? new Set<string>();
          set.add(parts[2]);
          this.optionKeys.set(deviceId, set);
        }
      }
    } catch (e) {
      this.port.log.debug(`priming known states from objects failed: ${errMessage(e)}`);
    }
  }

  /**
   * Migrate datapoints whose id changed with a newer adapter version to their
   * corrected place — the update cleans up after itself, the user never deletes
   * objects by hand. Runs BEFORE priming, so the maps only ever see current ids.
   *
   * Covered: every state whose stored BSH key now routes to a different
   * channel/id (the old "misc" mis-channeling, nested keys), the door text
   * states that became booleans, and the whole `programs` channel of appliance
   * types that have no programs. A 1:1 rename carries the user's history
   * configuration and a custom name along; a reshaped state (text → boolean
   * pair) starts fresh and gets its live value from the next sync.
   */
  async migrateRenamedStates(): Promise<void> {
    const prefix = `${this.port.namespace}.`;
    try {
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      const typeByDevice = new Map<string, string>();
      for (const [fullId, obj] of Object.entries(devices)) {
        const deviceId = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const type = (obj.native as { type?: unknown } | undefined)?.type;
        if (!deviceId.includes(".") && typeof type === "string") {
          typeByDevice.set(deviceId, type);
        }
      }
      const states = await this.port.getForeignObjects(`${this.port.namespace}.*`, "state");
      // Per device.channel: how many states remain — drained old channels lose their channel object.
      const remaining = new Map<string, number>();
      for (const fullId of Object.keys(states)) {
        const parts = (fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId).split(".");
        if (parts.length >= 3) {
          const channelPath = `${parts[0]}.${parts[1]}`;
          remaining.set(channelPath, (remaining.get(channelPath) ?? 0) + 1);
        }
      }
      const drainedCandidates = new Set<string>();
      let migrated = 0;
      for (const [fullId, obj] of Object.entries(states)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const parts = rel.split(".");
        if (parts.length < 3) {
          continue;
        }
        const deviceId = parts[0] ?? "";
        const channelPath = `${deviceId}.${parts[1]}`;
        const type = typeByDevice.get(deviceId);
        // A program-less appliance type loses its whole programs channel.
        if (type && PROGRAMLESS_TYPES.has(type) && parts[1] === "programs") {
          await this.deleteMigratedState(rel, channelPath, remaining, drainedCandidates);
          migrated++;
          continue;
        }
        const native = (obj.native ?? {}) as { bshKey?: unknown };
        if (typeof native.bshKey !== "string") {
          continue;
        }
        const lockable = LOCKABLE_DOOR_TYPES.has(type ?? "");
        const oldValue = (await this.port.getState(rel))?.val;
        // For a door the old short text ("open"/"locked") is folded back into a
        // synthetic enum value, so the expansion derives the right booleans.
        const value =
          isDoorStatusKey(native.bshKey) && typeof oldValue === "string"
            ? `BSH.Common.EnumType.DoorState.${oldValue.charAt(0).toUpperCase()}${oldValue.slice(1)}`
            : oldValue;
        const expanded = expandBshItem({ key: native.bshKey, value }, lockable);
        if (expanded.some(t => `${t.channel}.${t.id}` === parts.slice(1).join("."))) {
          continue; // already in its current place
        }
        const oneToOne = expanded.length === 1;
        for (const t of expanded) {
          const newRel = `${deviceId}.${t.channel}.${t.id}`;
          const common: ioBroker.StateCommon = { ...t.common };
          const oldCommon = (obj.common ?? {}) as Partial<ioBroker.StateCommon> & { custom?: unknown };
          if (oneToOne && t.common.type === oldCommon.type) {
            // Same shape, new place: keep the authoritative metadata the REST
            // sync established, the user's rename and the history configuration.
            Object.assign(common, oldCommon);
            if (t.channel === "settings") {
              // The old misc mis-channeling also mis-derived read-only; the next
              // REST sync re-tightens genuine read-only settings via the signature.
              common.write = true;
            }
          }
          if (typeof oldCommon.name === "string" && oldCommon.name !== parts[parts.length - 1]) {
            common.name = oldCommon.name; // a user rename survives, an auto-name is re-derived
          } else {
            common.name = t.id;
          }
          await this.port.extendObject(`${deviceId}.${t.channel}`, {
            type: "channel",
            common: { name: t.channel },
            native: {},
          });
          await this.port.extendObject(newRel, {
            type: "state",
            common,
            native: { bshKey: native.bshKey, bshValues: t.bshValues },
          });
          const newValue = oneToOne && t.common.type === oldCommon.type ? oldValue : t.value;
          if (newValue !== null && newValue !== undefined) {
            await this.port.setState(newRel, { val: newValue, ack: true });
          }
          this.port.log.debug(`migrated ${rel} → ${newRel}`);
        }
        await this.deleteMigratedState(rel, channelPath, remaining, drainedCandidates);
        migrated++;
      }
      for (const channelPath of drainedCandidates) {
        if ((remaining.get(channelPath) ?? 0) === 0) {
          await this.port.delObject(channelPath).catch(() => undefined);
        }
      }
      if (migrated > 0) {
        this.port.log.info(`Migrated ${migrated} datapoint(s) to the corrected tree layout.`);
      }
    } catch (e) {
      this.port.log.warn(`migrating renamed datapoints failed: ${errMessage(e)}`);
    }
  }

  /**
   * Delete one migrated-away state and account for its channel possibly
   * draining empty (the channel object is removed at the end then).
   *
   * @param rel the namespace-relative state id to delete
   * @param channelPath the device-qualified channel it lives under
   * @param remaining the per-channel remaining-state counter
   * @param drained the set of channels that may end up empty
   */
  private async deleteMigratedState(
    rel: string,
    channelPath: string,
    remaining: Map<string, number>,
    drained: Set<string>,
  ): Promise<void> {
    try {
      await this.port.delObject(rel);
    } catch (e) {
      this.port.log.debug(`removing ${rel} failed: ${errMessage(e)}`);
    }
    remaining.set(channelPath, (remaining.get(channelPath) ?? 1) - 1);
    drained.add(channelPath);
  }

  /**
   * Route a stream event to its device's states.
   *
   * @param event the parsed SSE event
   */
  handleStreamEvent(event: SseEvent): void {
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isRecord(payload)) {
        return;
      }
      // The payload haId is authoritative. The SSE id only serves as a fallback
      // (issue #88: sometimes one of the two is missing) — it persists across
      // events per the SSE spec, so a stale id must never override the payload.
      const payloadHaId = typeof payload.haId === "string" && payload.haId.length > 0 ? payload.haId : undefined;
      const haId = payloadHaId ?? (event.id || undefined);
      if (!haId) {
        return;
      }
      const deviceId = this.deviceIdByHaId.get(haId);

      // A device coming (back) online, or a newly paired one: (re)build its data tree.
      if (event.event === "CONNECTED" || event.event === "PAIRED") {
        if (deviceId) {
          void this.guarded(async () => {
            await this.setReachable(deviceId, true);
            await this.syncApplianceData(deviceId, haId);
          });
        } else if (event.event === "PAIRED") {
          // A genuinely new appliance — fetch the full list once.
          void this.guarded(() => this.syncAppliances());
        } else {
          // CONNECTED for an unknown haId — fetch just that appliance, not a full re-sync.
          void this.guarded(() => this.syncSingleAppliance(haId));
        }
        return;
      }

      if (!deviceId) {
        return;
      }

      // Merely offline: the appliance is switched off but still on the account.
      if (event.event === "DISCONNECTED") {
        void this.guarded(() => this.setReachable(deviceId, false));
        return;
      }

      // Removed from the account: what is not there any more does not stay in the
      // tree. Keeping it would leave datapoints that can never update again and an
      // entry that counts as permanently offline in the instance summary.
      if (event.event === "DEPAIRED") {
        this.port.log.info(`Appliance ${deviceId} was removed from the Home Connect account — removing its objects.`);
        void this.guarded(() => this.removeAppliance(deviceId, haId));
        return;
      }

      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const raw of items) {
        if (isRecord(raw)) {
          void this.guarded(() => this.applyBshItem(deviceId, raw, "values"));
        }
      }
    } catch (e) {
      this.port.log.warn(`handling stream event failed: ${errMessage(e)}`);
    }
  }

  /**
   * Run a fire-and-forget async unit with a top-level catch (no unhandled rejection).
   *
   * @param fn the async unit to run
   */
  private async guarded(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.port.log.warn(`appliance sync task failed: ${errMessage(e)}`);
    }
  }

  /** Fetch the paired appliances and build/update their object tree. */
  async syncAppliances(): Promise<void> {
    const data = await this.port.apiGet("/api/homeappliances");
    // A failed or malformed fetch must not report "0 appliances" — nothing was learned.
    if (!isRecord(data) || !Array.isArray(data.homeappliances)) {
      this.port.log.debug("appliance list not available — keeping the current tree.");
      return;
    }
    const list = data.homeappliances;
    const seen = new Set<string>();
    for (const raw of list) {
      if (isRecord(raw)) {
        if (typeof raw.haId === "string") {
          seen.add(raw.haId);
        }
        await this.syncAppliance(raw);
      }
    }
    // The second way an appliance disappears: not through a DEPAIRED event but by
    // simply no longer being in the list — removed while the adapter was off. Only
    // reached on a SUCCESSFUL fetch (the guard above returns early otherwise), so a
    // failed request can never wipe the tree.
    for (const [haId, deviceId] of [...this.deviceIdByHaId]) {
      if (!seen.has(haId)) {
        this.port.log.info(`Appliance ${deviceId} is no longer on the Home Connect account — removing its objects.`);
        await this.removeAppliance(deviceId, haId);
      }
    }
    this.port.log.info(`Home Connect: ${list.length} appliance(s) found.`);
  }

  /**
   * Fetch a single appliance (used for a CONNECTED event whose haId we don't know yet).
   *
   * @param haId the appliance's haId
   */
  private async syncSingleAppliance(haId: string): Promise<void> {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}`);
    if (isRecord(data)) {
      await this.syncAppliance(data);
    }
  }

  /**
   * Build the object tree for one appliance under a speaking id and sync its data
   * (only when currently connected).
   *
   * @param a the appliance record from /api/homeappliances
   */
  private async syncAppliance(a: Record<string, unknown>): Promise<void> {
    const haId = typeof a.haId === "string" ? a.haId : undefined;
    if (!haId) {
      return;
    }
    const name = typeof a.name === "string" && a.name.length > 0 ? a.name : haId;
    const deviceId = this.deviceIdByHaId.get(haId) ?? this.assignDeviceId(haId, name);
    await this.port.extendObject(deviceId, {
      type: "device",
      // statusStates is what puts the green/grey dot on the device node — the
      // `info.reachable` state alone is just a value nobody links to the icon.
      // The id has to be the full path, not the device-relative one.
      common: { name, statusStates: { onlineId: `${this.port.namespace}.${deviceId}.info.reachable` } },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber },
    });
    if (typeof a.type === "string") {
      this.typeByDeviceId.set(deviceId, a.type);
    }
    // The catalog events exist from the first sync on — even for an appliance
    // that is currently switched off (they need no cloud data, only the type).
    await this.ensureEventStates(deviceId);
    await this.setReachable(deviceId, a.connected === true);
    if (a.connected === true) {
      await this.syncApplianceData(deviceId, haId);
    }
  }

  /**
   * Create the catalog events of the appliance's type upfront (value `false`),
   * so no event datapoint first appears only when it first fires. Events can not
   * be enumerated over REST — the catalog (device-catalog.ts) is the only source.
   * An unknown type simply gets none; its events still appear via the stream.
   *
   * @param deviceId the id-safe device path segment
   */
  private async ensureEventStates(deviceId: string): Promise<void> {
    for (const key of eventKeysForType(this.typeByDeviceId.get(deviceId))) {
      const t = transformItem({ key, value: undefined });
      const fullId = `${deviceId}.${t.channel}.${t.id}`;
      if (this.knownStates.has(fullId)) {
        continue;
      }
      await this.port.extendObject(`${deviceId}.${t.channel}`, {
        type: "channel",
        common: { name: t.channel },
        native: {},
      });
      await this.port.extendObject(fullId, { type: "state", common: t.common, native: { bshKey: key } });
      await this.port.setStateChanged(fullId, { val: false, ack: true });
      this.knownStates.set(fullId, {
        bshKey: key,
        metaSig: metaSignature(t.common, { bshKey: key, bshValues: undefined }),
      });
    }
  }

  /**
   * Create (once) and set the per-device online indicator, fed by the appliance
   * list's `connected` flag and the CONNECTED / DISCONNECTED / DEPAIRED stream
   * events — so stale values are distinguishable from live ones.
   *
   * @param deviceId the id-safe device path segment
   * @param reachable whether the appliance is currently connected to Home Connect
   */
  private async setReachable(deviceId: string, reachable: boolean): Promise<void> {
    const fullId = `${deviceId}.info.reachable`;
    if (!this.knownStates.has(fullId)) {
      await this.port.extendObject(`${deviceId}.info`, { type: "channel", common: { name: "info" }, native: {} });
      await this.port.extendObject(fullId, {
        type: "state",
        common: {
          name: "reachable",
          type: "boolean",
          role: "indicator.reachable",
          read: true,
          write: false,
          def: false,
        },
        native: {},
      });
      this.knownStates.set(fullId, {});
    }
    // An online/offline transition is worth a log line — without it a device's
    // connect history can not be traced in the log at all.
    const previous = this.reachableByDeviceId.get(deviceId);
    if (previous !== undefined && previous !== reachable) {
      this.port.log.info(`Appliance ${deviceId} is now ${reachable ? "online" : "offline"}.`);
    }
    await this.port.setStateChanged(fullId, { val: reachable, ack: true });
    this.reachableByDeviceId.set(deviceId, reachable);
    await this.writeDeviceRollup();
  }

  /**
   * Write the instance-level summary of how many appliances there are and how
   * many of them are connected to Home Connect.
   *
   * Derived here because every marker write goes through `setReachable` — a
   * second place doing the counting would drift away from the per-device values.
   *
   * `devicesTotal` deliberately keeps its value while the adapter is stopped: how
   * many appliances are paired does not change because the adapter is off, and a
   * `0` there would read as "nothing paired". `devicesAllOnline` needs at least
   * one appliance, otherwise an account without a single one would report that
   * all of them are connected.
   */
  private async writeDeviceRollup(): Promise<void> {
    const values = [...this.reachableByDeviceId.values()];
    const online = values.filter(Boolean).length;
    await this.port.setStateChanged("info.devicesTotal", { val: values.length, ack: true });
    await this.port.setStateChanged("info.devicesOnline", { val: online, ack: true });
    await this.port.setStateChanged("info.devicesAllOnline", {
      val: values.length > 0 && online === values.length,
      ack: true,
    });
  }

  /**
   * Mark every known appliance as not reachable.
   *
   * Two moments need this and neither may wait for the cloud: start-up (the
   * previous run's values survive in the database, and the appliance list can
   * fail to arrive — an expired token, no internet — in which case nothing would
   * ever correct a stale "reachable") and shutdown (nothing else resets them).
   */
  async markAllUnreachable(): Promise<void> {
    for (const deviceId of this.haIdByDeviceId.keys()) {
      await this.setReachable(deviceId, false);
    }
  }

  /**
   * Drop an appliance that is no longer in the Home Connect account: its whole
   * object tree goes, along with every in-memory trace of it.
   *
   * What is not on the account is not there any more (krobi 2026-08-27) — keeping
   * the tree would leave datapoints that can never update again, and would keep
   * the appliance in the instance summary as permanently offline.
   *
   * @param deviceId the speaking device id to remove
   * @param haId its Home Connect appliance id
   */
  private async removeAppliance(deviceId: string, haId: string): Promise<void> {
    try {
      await this.port.delObjectRecursive(deviceId);
    } catch (e) {
      this.port.log.debug(`removing the object tree of ${deviceId} failed: ${errMessage(e)}`);
    }
    this.deviceIdByHaId.delete(haId);
    this.haIdByDeviceId.delete(deviceId);
    this.optionKeys.delete(deviceId);
    this.reachableByDeviceId.delete(deviceId);
    this.typeByDeviceId.delete(deviceId);
    this.programDefs.delete(deviceId);
    for (const rel of [...this.knownStates.keys()]) {
      if (rel === deviceId || rel.startsWith(`${deviceId}.`)) {
        this.knownStates.delete(rel);
      }
    }
    await this.writeDeviceRollup();
  }

  /**
   * Assign a stable, collision-free speaking id to an haId (first time seen).
   *
   * @param haId the appliance's haId
   * @param name its friendly name
   * @returns the assigned device id
   */
  private assignDeviceId(haId: string, name: string): string {
    const deviceId = disambiguateSlug(slugify(name), haId, new Set(this.haIdByDeviceId.keys()));
    this.deviceIdByHaId.set(haId, deviceId);
    this.haIdByDeviceId.set(deviceId, haId);
    return deviceId;
  }

  /**
   * Sync a connected appliance's full data tree. Serialised per device so
   * overlapping CONNECTED / re-sync events don't double-fetch or race the maps.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  private async syncApplianceData(deviceId: string, haId: string): Promise<void> {
    if (this.syncing.has(deviceId)) {
      return;
    }
    this.syncing.add(deviceId);
    try {
      await this.syncItems(deviceId, haId, "/status", "status");
      await this.syncItems(deviceId, haId, "/settings", "settings");
      await this.syncPrograms(deviceId, haId);
      await this.ensureCommands(deviceId, haId);
    } finally {
      this.syncing.delete(deviceId);
    }
  }

  /**
   * Fetch a status/settings list, transform each item, and create the object +
   * set the value under the speaking channel/id.
   *
   * Deliberately NO pruning of states missing from the response: the cloud
   * reports a state-dependent SUBSET (a switched-off washer in network standby
   * answers with `powerState` only), so "not in this response" never means "the
   * appliance does not have it". Appliance capabilities do not change — every
   * datapoint stays once created; only removing an appliance from the account
   * deletes its tree.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param subpath the endpoint sub-path, e.g. "/status"
   * @param arrayKey the array field in the response body, e.g. "status"
   */
  private async syncItems(deviceId: string, haId: string, subpath: string, arrayKey: string): Promise<void> {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}${subpath}`);
    if (!isRecord(data) || !Array.isArray(data[arrayKey])) {
      return;
    }
    for (const raw of data[arrayKey]) {
      if (isRecord(raw)) {
        await this.applyBshItem(deviceId, raw, "sync");
      }
    }
  }

  /**
   * Transform one raw BSH item and write it under the device's speaking tree
   * (usually one state; a door status or the operation state expand to several).
   * A new state creates the channel + object; a known one normally only updates
   * the value. A REST-sourced item additionally refreshes the object's metadata
   * when it changed (new allowed values, changed bounds, improved transform in a
   * newer adapter version) — stream events never touch objects, so the old
   * adapter's object-tree flood (#387) stays impossible.
   *
   * @param deviceId the id-safe device path segment
   * @param raw the raw status / setting / event item
   * @param source "sync" for a REST sync that owns the metadata; "values" for
   *   value-only items (stream events, and a program's option values — whose
   *   object shape is owned by the option *definition*, not the value item)
   */
  private async applyBshItem(deviceId: string, raw: Record<string, unknown>, source: "sync" | "values"): Promise<void> {
    if (typeof raw.key !== "string") {
      return;
    }
    const lockableDoor = LOCKABLE_DOOR_TYPES.has(this.typeByDeviceId.get(deviceId) ?? "");
    const states = expandBshItem(
      {
        key: raw.key,
        value: raw.value,
        unit: typeof raw.unit === "string" ? raw.unit : undefined,
        constraints: parseConstraints(raw.constraints),
      },
      lockableDoor,
    );
    for (const t of states) {
      await this.applyTransformedState(deviceId, raw.key, t, source);
    }
  }

  /**
   * Create/refresh one transformed state and set its value (the per-state half
   * of {@link applyBshItem}).
   *
   * @param deviceId the id-safe device path segment
   * @param bshKey the source BSH key (shared by all states of an expanded item)
   * @param t the transformed state
   * @param source "sync" (owns metadata) or "values" (value-only)
   */
  private async applyTransformedState(
    deviceId: string,
    bshKey: string,
    t: TransformedState,
    source: "sync" | "values",
  ): Promise<void> {
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    const known = this.knownStates.get(fullId);
    const sig = metaSignature(t.common, { bshKey, bshValues: t.bshValues });
    if (!known) {
      await this.port.extendObject(`${deviceId}.${t.channel}`, {
        type: "channel",
        common: { name: t.channel },
        native: {},
      });
      await this.port.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey, bshValues: t.bshValues },
      });
      this.knownStates.set(fullId, { bshKey, bshValues: t.bshValues, metaSig: sig });
    } else if (source === "sync" && known.metaSig !== sig) {
      await this.replaceStateObject(fullId, t.common, { bshKey, bshValues: t.bshValues });
      this.knownStates.set(fullId, { bshKey, bshValues: t.bshValues, metaSig: sig });
    }
    await this.port.setStateChanged(fullId, { val: t.value, ack: true });
  }

  /**
   * Replace a state object whose owned metadata changed. `extendObject` cannot
   * remove keys (its deep merge keeps them — a vanished `states` entry or a
   * dropped `min` would survive), so this is a full replace via delObject →
   * setObjectNotExists, preserving what the user owns (a rename, history
   * settings). Runs inside the per-device sync serialisation and only when the
   * signature actually changed, so the delete/create window is rare and tiny;
   * the caller re-sets the state value right afterwards.
   *
   * @param fullId the namespace-relative state id
   * @param common the fresh `common` from the transformer
   * @param native the fresh BSH native data
   * @param native.bshKey the fully-qualified BSH key
   * @param native.bshValues the full BSH candidate values of a writable enum
   */
  private async replaceStateObject(
    fullId: string,
    common: ioBroker.StateCommon,
    native: { bshKey?: string; bshValues?: string[] },
  ): Promise<void> {
    const fresh: ioBroker.StateCommon = { ...common };
    try {
      const existing = await this.port.getObject(fullId);
      if (existing?.common) {
        if (existing.common.name !== undefined) {
          fresh.name = existing.common.name;
        }
        if ((existing.common as { custom?: Record<string, unknown> }).custom) {
          (fresh as { custom?: Record<string, unknown> }).custom = (
            existing.common as { custom?: Record<string, unknown> }
          ).custom;
        }
      }
      // delObject also drops the state value — capture and restore it, so a
      // metadata refresh never resets what the user (or the appliance) set.
      const previous = await this.port.getState(fullId);
      await this.port.delObject(fullId);
      await this.port.setObjectNotExists(fullId, { type: "state", common: fresh, native });
      if (previous && previous.val !== null && previous.val !== undefined) {
        await this.port.setState(fullId, { val: previous.val, ack: true });
      }
      this.port.log.debug(`refreshed object metadata of ${fullId}`);
    } catch (e) {
      this.port.log.warn(`refreshing object metadata of ${fullId} failed: ${errMessage(e)}`);
    }
  }

  /**
   * Read active + selected + available programs into the tree, and load any
   * not-yet-cached program option definitions (union of ALL programs → every
   * option datapoint exists upfront, none appears only when its program is used).
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  private async syncPrograms(deviceId: string, haId: string): Promise<void> {
    // Appliance types without programs (refrigeration family, air conditioner)
    // get no programs channel at all.
    if (PROGRAMLESS_TYPES.has(this.typeByDeviceId.get(deviceId) ?? "")) {
      return;
    }
    const avail = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available`);
    const fetchedKeys =
      isRecord(avail) && Array.isArray(avail.programs)
        ? avail.programs
            .filter(isRecord)
            .map(p => p.key)
            .filter((k): k is string => typeof k === "string")
        : undefined;
    if (fetchedKeys) {
      await this.syncProgramDefs(deviceId, haId, fetchedKeys);
    }
    // Flicker guard: a failed/refused list (the API answers "wrong operation
    // state" while a program runs) must not shrink the program list — fall back
    // to every program the definition cache knows.
    const knownKeys =
      fetchedKeys && fetchedKeys.length > 0 ? fetchedKeys : Object.keys(this.programDefs.get(deviceId) ?? {});

    const selected = await this.port.apiGet(`/api/homeappliances/${haId}/programs/selected`);
    const selectedKey = isRecord(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || knownKeys.length > 0) {
      // Without a usable program list the item runs as value-only, so the
      // existing allowed-values metadata survives untouched.
      await this.applyBshItem(
        deviceId,
        {
          key: "BSH.Common.Root.SelectedProgram",
          value: selectedKey,
          ...(knownKeys.length > 0 ? { constraints: { allowedvalues: knownKeys } } : {}),
        },
        knownKeys.length > 0 ? "sync" : "values",
      );
    }
    // Arm the write gate for the selected program BEFORE any value touches options.*.
    if (selectedKey.length > 0) {
      await this.activateProgramOptions(deviceId, haId, selectedKey);
    }
    if (isRecord(selected)) {
      await this.applyProgramOptions(deviceId, selected.options);
    }

    const active = await this.port.apiGet(`/api/homeappliances/${haId}/programs/active`);
    const activeKey = isRecord(active) && typeof active.key === "string" ? active.key : "";
    if (activeKey.length > 0 || knownKeys.length > 0 || this.knownStates.has(`${deviceId}.programs.activeProgram`)) {
      await this.applyBshItem(deviceId, { key: "BSH.Common.Root.ActiveProgram", value: activeKey }, "sync");
    }
    if (isRecord(active)) {
      await this.applyProgramOptions(deviceId, active.options);
    }

    // Start/stop only make sense for an appliance that actually has programs.
    if (knownKeys.length > 0) {
      await this.ensureButton(deviceId, "programs", "start", "Start selected program");
      await this.ensureButton(deviceId, "programs", "stop", "Stop active program");
    }
  }

  /**
   * Apply a program's `options[]` array under `options.*`. Value-only: the
   * object shape of a writable option is owned by its *definition*
   * ({@link applyOptionDefinition}) — a value item must not overwrite it.
   *
   * @param deviceId the id-safe device path segment
   * @param options the options array from a program response
   */
  private async applyProgramOptions(deviceId: string, options: unknown): Promise<void> {
    if (!Array.isArray(options)) {
      return;
    }
    for (const raw of options) {
      if (isRecord(raw)) {
        await this.applyBshItem(deviceId, raw, "values");
      }
    }
  }

  /**
   * Fetch the option definitions of programs the cache does not know yet —
   * each program is fetched ONCE, ever (the cache persists in the device
   * object's native and is restored at start). A failed fetch is simply
   * retried on a later sync; nothing is removed.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param programKeys the full program keys that should be cached
   */
  private async syncProgramDefs(deviceId: string, haId: string, programKeys: readonly string[]): Promise<void> {
    const cached = this.programDefs.get(deviceId) ?? {};
    this.programDefs.set(deviceId, cached);
    let changed = false;
    for (const programKey of programKeys) {
      if (cached[programKey]) {
        continue;
      }
      const def = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available/${programKey}`);
      if (!isRecord(def)) {
        continue;
      }
      const options = Array.isArray(def.options) ? def.options : [];
      const ids: string[] = [];
      for (const raw of options) {
        if (isRecord(raw)) {
          const id = await this.applyOptionDefinition(deviceId, raw);
          if (id) {
            ids.push(id);
          }
        }
      }
      cached[programKey] = ids;
      changed = true;
    }
    if (changed) {
      try {
        // Internal attribute on the device object (not a datapoint): survives restarts.
        await this.port.extendObject(deviceId, { native: { programOptions: cached } });
      } catch (e) {
        this.port.log.debug(`persisting the program definition cache of ${deviceId} failed: ${errMessage(e)}`);
      }
    }
  }

  /**
   * Arm the write gate with the selected program's option ids — from the cache;
   * only a program the cache has never seen costs a definition request.
   * Option states of other programs stay untouched (their objects are the
   * union across all programs and never disappear).
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param programKey the full key of the now-selected program
   */
  async activateProgramOptions(deviceId: string, haId: string, programKey: string): Promise<void> {
    let cached = this.programDefs.get(deviceId);
    if (!cached?.[programKey]) {
      await this.syncProgramDefs(deviceId, haId, [programKey]);
      cached = this.programDefs.get(deviceId);
    }
    this.optionKeys.set(deviceId, new Set(cached?.[programKey] ?? []));
  }

  /**
   * Create one writable option state from its definition — or, if it already
   * exists (from another program of the same appliance), merge the definitions
   * into a UNION: allowed values united, numeric bounds widened. The union keeps
   * the object stable across program switches (no rewrite ping-pong); which
   * values the currently selected program really accepts is the write gate's
   * business, not the object's.
   *
   * @param deviceId the id-safe device path segment
   * @param raw the raw option definition
   * @returns the option's state id, or undefined if it had no key
   */
  private async applyOptionDefinition(deviceId: string, raw: Record<string, unknown>): Promise<string | undefined> {
    if (typeof raw.key !== "string") {
      return undefined;
    }
    const opt: BshOptionDefinition = {
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : undefined,
      type: typeof raw.type === "string" ? raw.type : undefined,
      unit: typeof raw.unit === "string" ? raw.unit : undefined,
      constraints: parseConstraints(raw.constraints),
    };
    const t = transformOptionDefinition(opt);
    const fullId = `${deviceId}.options.${t.id}`;
    const known = this.knownStates.get(fullId);
    if (!known) {
      const sig = metaSignature(t.common, { bshKey: opt.key, bshValues: t.bshValues });
      await this.port.extendObject(`${deviceId}.options`, {
        type: "channel",
        common: { name: "options" },
        native: {},
      });
      await this.port.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: opt.key, bshValues: t.bshValues },
      });
      // The definition's default only seeds a brand-new state; a known one keeps
      // its value (the `known` check above is what does that — setStateChanged is
      // used for consistency with the rest of the value path, not as the gate).
      await this.port.setStateChanged(fullId, { val: t.value, ack: true });
      this.knownStates.set(fullId, { bshKey: opt.key, bshValues: t.bshValues, metaSig: sig });
      return t.id;
    }
    const merged = await this.mergeOptionDefinition(fullId, known, t);
    const sig = metaSignature(merged.common, { bshKey: opt.key, bshValues: merged.bshValues });
    if (known.metaSig !== sig) {
      await this.replaceStateObject(fullId, merged.common, { bshKey: opt.key, bshValues: merged.bshValues });
    }
    this.knownStates.set(fullId, { bshKey: opt.key, bshValues: merged.bshValues, metaSig: sig });
    return t.id;
  }

  /**
   * The union of an existing option state and a fresh definition of the same
   * option (from another program): allowed values united (existing display
   * labels win), numeric bounds widened, unit/step kept when the fresh
   * definition lacks them.
   *
   * @param fullId the option's namespace-relative state id
   * @param known its in-memory entry (accumulated allowed values)
   * @param t the freshly transformed definition
   * @returns the merged common + allowed values
   */
  private async mergeOptionDefinition(
    fullId: string,
    known: KnownState,
    t: TransformedState,
  ): Promise<{ common: ioBroker.StateCommon; bshValues?: string[] }> {
    const common: ioBroker.StateCommon = { ...t.common };
    let exCommon: Partial<ioBroker.StateCommon> = {};
    try {
      exCommon = ((await this.port.getObject(fullId))?.common ?? {}) as Partial<ioBroker.StateCommon>;
    } catch (e) {
      this.port.log.debug(`reading ${fullId} for the definition merge failed: ${errMessage(e)}`);
    }
    let bshValues = t.bshValues;
    if ((known.bshValues?.length ?? 0) > 0 || (t.bshValues?.length ?? 0) > 0) {
      const union = [...(known.bshValues ?? [])];
      for (const v of t.bshValues ?? []) {
        if (!union.includes(v)) {
          union.push(v);
        }
      }
      bshValues = union;
      const exStates = isRecord(exCommon.states) ? exCommon.states : {};
      const newStates = isRecord(common.states) ? common.states : {};
      const states: Record<string, string> = {};
      for (const v of union) {
        const short = shortEnum(v);
        states[short] = exStates[short] ?? newStates[short] ?? short;
      }
      common.states = states;
    }
    if (typeof exCommon.min === "number") {
      common.min = typeof common.min === "number" ? Math.min(common.min, exCommon.min) : exCommon.min;
    }
    if (typeof exCommon.max === "number") {
      common.max = typeof common.max === "number" ? Math.max(common.max, exCommon.max) : exCommon.max;
    }
    if (common.step === undefined && typeof exCommon.step === "number") {
      common.step = exCommon.step;
    }
    if (common.unit === undefined && typeof exCommon.unit === "string") {
      common.unit = exCommon.unit;
    }
    return { common, bshValues };
  }

  /**
   * Create the available commands as momentary buttons under `commands.*`.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  private async ensureCommands(deviceId: string, haId: string): Promise<void> {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}/commands`);
    const commands = isRecord(data) && Array.isArray(data.commands) ? data.commands : [];
    for (const raw of commands) {
      if (isRecord(raw) && typeof raw.key === "string") {
        const id = stateIdForKey(raw.key).id;
        const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id;
        await this.ensureButton(deviceId, "commands", id, name, raw.key);
      }
    }
  }

  /**
   * Create a momentary button state (boolean, role "button", write-only) once.
   *
   * @param deviceId the id-safe device path segment
   * @param channel the channel the button lives under (programs / commands)
   * @param id the button's state id
   * @param name the human-readable name
   * @param bshKey the BSH command key, for command buttons (omitted for start/stop)
   */
  private async ensureButton(
    deviceId: string,
    channel: string,
    id: string,
    name: string,
    bshKey?: string,
  ): Promise<void> {
    const fullId = `${deviceId}.${channel}.${id}`;
    if (this.knownStates.has(fullId)) {
      return;
    }
    await this.port.extendObject(`${deviceId}.${channel}`, { type: "channel", common: { name: channel }, native: {} });
    await this.port.extendObject(fullId, {
      type: "state",
      common: { name, type: "boolean", role: "button", read: false, write: true },
      native: bshKey ? { bshKey } : {},
    });
    this.knownStates.set(fullId, { bshKey });
  }

  /**
   * Handle a user write (ack:false already filtered by main): resolve it into a
   * Home Connect request and send it, with a top-level catch (fire-and-forget safe).
   *
   * @param id the full (namespace-qualified) state id
   * @param value the written value
   */
  async handleWrite(id: string, value: ioBroker.StateValue): Promise<void> {
    try {
      const prefix = `${this.port.namespace}.`;
      const rel = id.startsWith(prefix) ? id.slice(prefix.length) : id;
      const parts = rel.split(".");
      const deviceId = parts[0];
      const channel = parts[1];
      const stateId = parts.slice(2).join(".");
      if (!deviceId || !channel || stateId.length === 0) {
        return;
      }
      const haId = this.haIdByDeviceId.get(deviceId);
      if (!haId) {
        return;
      }
      // Only options from the selected program's definition are writable — a
      // script write to a read-only display option (RemainingProgramTime, …)
      // would only produce a server-side error, so it is not sent at all.
      if (channel === "options" && !this.optionKeys.get(deviceId)?.has(stateId)) {
        this.port.log.debug(`Write to ${rel} ignored (not a writable option of the selected program).`);
        return;
      }
      const meta = this.knownStates.get(rel);
      const ctx: WriteContext = {
        haId,
        channel,
        id: stateId,
        bshKey: meta?.bshKey,
        bshValues: meta?.bshValues,
        value,
      };
      if (channel === "programs" && stateId === "start") {
        ctx.selectedProgramKey = await this.resolveSelectedProgramKey(deviceId);
        ctx.selectedOptions = await this.collectSelectedOptions(deviceId);
      }
      const req = resolveWrite(ctx);
      if (req) {
        const res = await this.port.apiWrite(req);
        await this.postWrite(channel, stateId, deviceId, haId, req, res);
        if (res?.ok && !this.isMomentaryButton(channel, stateId)) {
          await this.port.setState(rel, { val: value, ack: true });
        }
      } else {
        this.port.log.debug(`Write to ${rel} ignored (no matching Home Connect command).`);
      }
      if (this.isMomentaryButton(channel, stateId)) {
        await this.port.setStateChanged(rel, { val: false, ack: true });
      }
    } catch (e) {
      this.port.log.warn(`handling write to ${id} failed: ${errMessage(e)}`);
    }
  }

  /**
   * Whether a state is a momentary button (a press carrying no lasting value).
   *
   * @param channel the state's channel
   * @param stateId the within-channel id
   * @returns whether it is a command / program-start / program-stop button
   */
  private isMomentaryButton(channel: string, stateId: string): boolean {
    return channel === "commands" || (channel === "programs" && (stateId === "start" || stateId === "stop"));
  }

  /**
   * Resolve the full BSH key of the currently selected program.
   *
   * @param deviceId the id-safe device path segment
   * @returns the full program key, or undefined
   */
  private async resolveSelectedProgramKey(deviceId: string): Promise<string | undefined> {
    const st = await this.port.getState(`${deviceId}.programs.selectedProgram`);
    const short = typeof st?.val === "string" ? st.val : "";
    if (short.length === 0) {
      return undefined;
    }
    return this.knownStates.get(`${deviceId}.programs.selectedProgram`)?.bshValues?.find(v => shortEnum(v) === short);
  }

  /**
   * Follow-up after a write was sent: a program change reloads its option
   * definitions; a program start the appliance rejected (409) is retried once
   * with defaults.
   *
   * @param channel the written state's channel
   * @param stateId the within-channel id
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param req the request that was sent
   * @param res the result, or undefined if nothing was sent
   */
  private async postWrite(
    channel: string,
    stateId: string,
    deviceId: string,
    haId: string,
    req: WriteRequest,
    res: JsonResult | undefined,
  ): Promise<void> {
    if (!res) {
      return;
    }
    // `req.body?.key` is a type guard: resolveWrite only returns a selectedProgram
    // request WITH a key, so it never actually filters at runtime.
    if (channel === "programs" && stateId === "selectedProgram" && res.ok && req.body?.key) {
      // Re-arm the write gate for the new program — from the cache, so a program
      // change normally costs no definition request at all.
      await this.activateProgramOptions(deviceId, haId, req.body.key);
      return;
    }
    if (channel === "programs" && stateId === "start" && res.status === 409 && req.body?.options) {
      this.port.log.info("Program did not start with the selected options — retrying with defaults.");
      await this.port.apiWrite({ method: "PUT", path: req.path, body: { key: req.body.key } });
    }
  }

  /**
   * Collect the selected program's option values, resolved back to their BSH
   * values, to send with a program start.
   *
   * @param deviceId the id-safe device path segment
   * @returns the option key/value pairs for the start body
   */
  private async collectSelectedOptions(deviceId: string): Promise<Array<{ key: string; value: ioBroker.StateValue }>> {
    const result: Array<{ key: string; value: ioBroker.StateValue }> = [];
    const ids = this.optionKeys.get(deviceId);
    if (!ids) {
      return result;
    }
    for (const id of ids) {
      const relId = `${deviceId}.options.${id}`;
      const meta = this.knownStates.get(relId);
      if (!meta?.bshKey) {
        continue;
      }
      const st = await this.port.getState(relId);
      if (!st || st.val === null || st.val === undefined) {
        continue;
      }
      const value =
        meta.bshValues && meta.bshValues.length > 0 ? meta.bshValues.find(v => shortEnum(v) === st.val) : st.val;
      if (value !== undefined && value !== null) {
        result.push({ key: meta.bshKey, value });
      }
    }
    return result;
  }
}
