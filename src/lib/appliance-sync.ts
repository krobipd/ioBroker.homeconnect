// Appliance sync + write routing — extracted from main.ts so the device-tree
// building and the write path are a testable unit (a fake AdapterPort stands in
// for the adapter). main.ts keeps the lifecycle, OAuth, event-stream wiring and
// the REST transport (apiGet/apiWrite, which own the token + 401-refresh);
// ApplianceSync holds the object-tree state and turns BSH data ↔ ioBroker states.

import {
  transformItem,
  transformOptionDefinition,
  shortEnum,
  stateIdForKey,
  parseConstraints,
  type BshOptionDefinition,
} from "./value-transformer";
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
  /** Delete an object (leaf state). */
  delObject(id: string): Promise<void>;
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

  /**
   * @param port the injected adapter capabilities
   */
  constructor(private readonly port: AdapterPort) {}

  /**
   * Prime the in-memory maps from the objects already in the DB, so writes work
   * for an appliance that is offline at start (its objects exist from a previous
   * run but no REST re-sync populated the maps this run). Covers all four write
   * readers: knownStates + optionKeys + the slug↔haId maps.
   */
  async primeFromObjects(): Promise<void> {
    const prefix = `${this.port.namespace}.`;
    try {
      // Device objects carry the haId in native — without the slug↔haId maps the
      // write path can't resolve a target, so this must run before the state pass.
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      for (const [fullId, obj] of Object.entries(devices)) {
        const slug = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const haId = (obj.native as { haId?: unknown } | undefined)?.haId;
        if (slug.length > 0 && !slug.includes(".") && typeof haId === "string") {
          this.deviceIdByHaId.set(haId, slug);
          this.haIdByDeviceId.set(slug, haId);
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
        this.knownStates.set(rel, { bshKey, bshValues });
        const parts = rel.split(".");
        // Writable options.* belong to the start-payload set (optionKeys); read-only
        // display options (RemainingProgramTime, …) must not.
        if (parts.length === 3 && parts[1] === "options" && obj.common?.write === true) {
          const slug = parts[0];
          const set = this.optionKeys.get(slug) ?? new Set<string>();
          set.add(parts[2]);
          this.optionKeys.set(slug, set);
        }
      }
    } catch (e) {
      this.port.log.debug(`priming known states from objects failed: ${errMessage(e)}`);
    }
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
      // Home Connect sometimes omits the SSE id; then the haId is in the payload (issue #88).
      const haId = event.id || (typeof payload.haId === "string" ? payload.haId : undefined);
      if (!haId) {
        return;
      }
      const deviceId = this.deviceIdByHaId.get(haId);

      // A device coming (back) online, or a newly paired one: (re)build its data tree.
      if (event.event === "CONNECTED" || event.event === "PAIRED") {
        if (deviceId) {
          void this.guarded(() => this.syncApplianceData(deviceId, haId));
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
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const raw of items) {
        if (isRecord(raw)) {
          void this.guarded(() => this.applyBshItem(deviceId, raw));
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
    const list = isRecord(data) && Array.isArray(data.homeappliances) ? data.homeappliances : [];
    for (const raw of list) {
      if (isRecord(raw)) {
        await this.syncAppliance(raw);
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
      common: { name },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber },
    });
    if (a.connected === true) {
      await this.syncApplianceData(deviceId, haId);
    }
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
   * set the value under the speaking channel/id. Prunes states no longer reported.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param subpath the endpoint sub-path, e.g. "/status"
   * @param arrayKey the array field in the response body, e.g. "status"
   */
  private async syncItems(deviceId: string, haId: string, subpath: string, arrayKey: string): Promise<void> {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}${subpath}`);
    // A transient GET failure (undefined) or an unexpected shape must NOT reach the
    // prune step — an empty `seen` would otherwise wipe the whole channel.
    if (!isRecord(data) || !Array.isArray(data[arrayKey])) {
      return;
    }
    const channel = arrayKey === "status" ? "status" : "settings";
    const seen = new Set<string>();
    for (const raw of data[arrayKey]) {
      if (isRecord(raw)) {
        const rel = await this.applyBshItem(deviceId, raw);
        // Only prune within the fetched channel; an item mapping elsewhere is left alone.
        if (rel && rel.startsWith(`${channel}.`)) {
          seen.add(rel);
        }
      }
    }
    await this.pruneChannel(deviceId, channel, seen);
  }

  /**
   * Remove states of a channel that were not seen in the latest (successful) sync
   * — the appliance no longer reports them. Only called after a valid response.
   *
   * @param deviceId the id-safe device path segment
   * @param channel the channel to prune (status / settings)
   * @param seen the within-device ids (`channel.id`) seen this sync
   */
  private async pruneChannel(deviceId: string, channel: string, seen: Set<string>): Promise<void> {
    const channelPrefix = `${deviceId}.${channel}.`;
    const devicePrefix = `${deviceId}.`;
    for (const rel of [...this.knownStates.keys()]) {
      if (rel.startsWith(channelPrefix) && !seen.has(rel.slice(devicePrefix.length))) {
        try {
          await this.port.delObject(rel);
        } catch (e) {
          this.port.log.debug(`pruning ${rel} failed: ${errMessage(e)}`);
        }
        this.knownStates.delete(rel);
      }
    }
  }

  /**
   * Transform one raw BSH item and write it under the device's speaking tree,
   * creating the channel + state object only once (then only updating the value).
   *
   * @param deviceId the id-safe device path segment
   * @param raw the raw status / setting / event item
   * @returns the within-channel state id (`channel.id`), or undefined if it had no key
   */
  private async applyBshItem(deviceId: string, raw: Record<string, unknown>): Promise<string | undefined> {
    if (typeof raw.key !== "string") {
      return undefined;
    }
    const t = transformItem({
      key: raw.key,
      value: raw.value,
      unit: typeof raw.unit === "string" ? raw.unit : undefined,
      constraints: parseConstraints(raw.constraints),
    });
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    if (!this.knownStates.has(fullId)) {
      await this.port.extendObject(`${deviceId}.${t.channel}`, {
        type: "channel",
        common: { name: t.channel },
        native: {},
      });
      await this.port.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: raw.key, bshValues: t.bshValues },
      });
      this.knownStates.set(fullId, { bshKey: raw.key, bshValues: t.bshValues });
    }
    await this.port.setStateChanged(fullId, { val: t.value, ack: true });
    return `${t.channel}.${t.id}`;
  }

  /**
   * Read active + selected + available programs into the tree.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  private async syncPrograms(deviceId: string, haId: string): Promise<void> {
    const avail = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available`);
    const availableKeys =
      isRecord(avail) && Array.isArray(avail.programs)
        ? avail.programs
            .filter(isRecord)
            .map(p => p.key)
            .filter((k): k is string => typeof k === "string")
        : [];

    const selected = await this.port.apiGet(`/api/homeappliances/${haId}/programs/selected`);
    const selectedKey = isRecord(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || availableKeys.length > 0) {
      await this.applyBshItem(deviceId, {
        key: "BSH.Common.Root.SelectedProgram",
        value: selectedKey,
        constraints: { allowedvalues: availableKeys },
      });
    }
    // Load the selected program's option definitions BEFORE any value touches options.*.
    if (selectedKey.length > 0) {
      await this.loadProgramOptions(deviceId, haId, selectedKey);
    }
    if (isRecord(selected)) {
      await this.applyProgramOptions(deviceId, selected.options);
    }

    const active = await this.port.apiGet(`/api/homeappliances/${haId}/programs/active`);
    const activeKey = isRecord(active) && typeof active.key === "string" ? active.key : "";
    await this.applyBshItem(deviceId, { key: "BSH.Common.Root.ActiveProgram", value: activeKey });
    if (isRecord(active)) {
      await this.applyProgramOptions(deviceId, active.options);
    }

    // Start/stop only make sense for an appliance that actually has programs.
    if (availableKeys.length > 0) {
      await this.ensureButton(deviceId, "programs", "start", "Start selected program");
      await this.ensureButton(deviceId, "programs", "stop", "Stop active program");
    }
  }

  /**
   * Apply a program's `options[]` array under `options.*`.
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
        await this.applyBshItem(deviceId, raw);
      }
    }
  }

  /**
   * Load a program's option definitions and create them as writable option
   * states; remove option definitions the new program no longer has.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param programKey the full program key to load definitions for
   */
  async loadProgramOptions(deviceId: string, haId: string, programKey: string): Promise<void> {
    const def = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available/${programKey}`);
    const options = isRecord(def) && Array.isArray(def.options) ? def.options : [];
    const fresh = new Set<string>();
    for (const raw of options) {
      if (isRecord(raw)) {
        const id = await this.applyOptionDefinition(deviceId, raw);
        if (id) {
          fresh.add(id);
        }
      }
    }
    const previous = this.optionKeys.get(deviceId);
    if (previous) {
      for (const id of previous) {
        if (!fresh.has(id)) {
          const relId = `${deviceId}.options.${id}`;
          try {
            await this.port.delObject(relId);
          } catch (e) {
            this.port.log.debug(`removing stale option ${relId} failed: ${errMessage(e)}`);
          }
          this.knownStates.delete(relId);
        }
      }
    }
    this.optionKeys.set(deviceId, fresh);
  }

  /**
   * Create one writable option state from its definition.
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
    const isNew = !this.knownStates.has(fullId);
    await this.port.extendObject(`${deviceId}.options`, { type: "channel", common: { name: "options" }, native: {} });
    await this.port.extendObject(fullId, {
      type: "state",
      common: t.common,
      native: { bshKey: opt.key, bshValues: t.bshValues },
    });
    this.knownStates.set(fullId, { bshKey: opt.key, bshValues: t.bshValues });
    if (isNew) {
      await this.port.setStateChanged(fullId, { val: t.value, ack: true });
    }
    return t.id;
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
      const slug = parts[0];
      const channel = parts[1];
      const stateId = parts.slice(2).join(".");
      if (!slug || !channel || stateId.length === 0) {
        return;
      }
      const haId = this.haIdByDeviceId.get(slug);
      if (!haId) {
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
        ctx.selectedProgramKey = await this.resolveSelectedProgramKey(slug);
        ctx.selectedOptions = await this.collectSelectedOptions(slug);
      }
      const req = resolveWrite(ctx);
      if (req) {
        const res = await this.port.apiWrite(req);
        await this.postWrite(channel, stateId, slug, haId, req, res);
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
   * @param slug the device id segment
   * @returns the full program key, or undefined
   */
  private async resolveSelectedProgramKey(slug: string): Promise<string | undefined> {
    const st = await this.port.getState(`${slug}.programs.selectedProgram`);
    const short = typeof st?.val === "string" ? st.val : "";
    if (short.length === 0) {
      return undefined;
    }
    return this.knownStates.get(`${slug}.programs.selectedProgram`)?.bshValues?.find(v => shortEnum(v) === short);
  }

  /**
   * Follow-up after a write was sent: a program change reloads its option
   * definitions; a program start the appliance rejected (409) is retried once
   * with defaults.
   *
   * @param channel the written state's channel
   * @param stateId the within-channel id
   * @param slug the device id segment
   * @param haId the appliance's haId
   * @param req the request that was sent
   * @param res the result, or undefined if nothing was sent
   */
  private async postWrite(
    channel: string,
    stateId: string,
    slug: string,
    haId: string,
    req: WriteRequest,
    res: JsonResult | undefined,
  ): Promise<void> {
    if (!res) {
      return;
    }
    if (channel === "programs" && stateId === "selectedProgram" && res.ok && req.body?.key) {
      await this.loadProgramOptions(slug, haId, req.body.key);
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
   * @param slug the device id segment
   * @returns the option key/value pairs for the start body
   */
  private async collectSelectedOptions(slug: string): Promise<Array<{ key: string; value: ioBroker.StateValue }>> {
    const result: Array<{ key: string; value: ioBroker.StateValue }> = [];
    const ids = this.optionKeys.get(slug);
    if (!ids) {
      return result;
    }
    for (const id of ids) {
      const relId = `${slug}.options.${id}`;
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
