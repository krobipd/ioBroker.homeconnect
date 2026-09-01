"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var appliance_sync_exports = {};
__export(appliance_sync_exports, {
  ApplianceSync: () => ApplianceSync,
  metaSignature: () => metaSignature
});
module.exports = __toCommonJS(appliance_sync_exports);
var import_value_transformer = require("./value-transformer");
var import_device_catalog = require("./device-catalog");
var import_command_dispatch = require("./command-dispatch");
var import_pure_helpers = require("./pure-helpers");
const OWNED_COMMON_KEYS = ["type", "role", "read", "write", "unit", "min", "max", "step", "states", "def"];
function metaSignature(common, native) {
  const c = common;
  const picked = {};
  for (const key of OWNED_COMMON_KEYS) {
    const v = key === "states" && c[key] !== null && typeof c[key] === "object" ? sortedRecord(c[key]) : c[key];
    if (v !== void 0) {
      picked[key] = v;
    }
  }
  return JSON.stringify({ c: picked, k: native.bshKey, v: native.bshValues });
}
function sortedRecord(v) {
  const rec = v;
  return Object.fromEntries(
    Object.keys(rec).sort().map((k) => [k, rec[k]])
  );
}
function appliancePath(haId, subpath = "") {
  return `/api/homeappliances/${encodeURIComponent(haId)}${subpath}`;
}
function applianceIdSource(a) {
  for (const field of [a.enumber, a.vib, a.haId]) {
    if (typeof field === "string" && field.trim().length > 0) {
      return field;
    }
  }
  return void 0;
}
class ApplianceSync {
  /**
   * @param port the injected adapter capabilities
   */
  constructor(port) {
    this.port = port;
  }
  port;
  /** haId → device id (type-plate based), for routing stream events. */
  deviceIdByHaId = /* @__PURE__ */ new Map();
  /** device id → haId, for routing writes back to the appliance. */
  haIdByDeviceId = /* @__PURE__ */ new Map();
  /** Namespace-relative state id → its BSH key + candidate values; also gates object creation. */
  knownStates = /* @__PURE__ */ new Map();
  /** device id → the option ids from the selected program's definition (writable, sent on start). */
  optionKeys = /* @__PURE__ */ new Map();
  /** device ids with an in-flight data sync — serialises concurrent CONNECTED/re-sync events. */
  syncing = /* @__PURE__ */ new Set();
  /** device id → its last written reachable value, the single source for the instance summary. */
  reachableByDeviceId = /* @__PURE__ */ new Map();
  /** device id → its appliance type ("WasherDryer", …) — drives the catalog (events, door form, programs). */
  typeByDeviceId = /* @__PURE__ */ new Map();
  /** device id → the appliance's display name (from the app) — for readable log lines. */
  nameByDeviceId = /* @__PURE__ */ new Map();
  /**
   * device id → program key → its option state ids. The definition cache: each
   * program definition is fetched ONCE, then remembered here and persisted in the
   * device object's native (an internal attribute, not a datapoint) — so a program
   * change or re-sync costs no definition request at all, which keeps the daily
   * request budget untouched and sidesteps the "wrong operation state" refusal
   * while a program runs.
   */
  programDefs = /* @__PURE__ */ new Map();
  /**
   * The log label for a device: `Name (id)` — the name for the human, the id to
   * find the folder in the tree (fleet convention, mirrors govee's deviceLabel).
   *
   * @param deviceId the id-safe device path segment
   * @returns the label, or just the id when no distinct name is known
   */
  label(deviceId) {
    var _a, _b;
    const name = (_b = (_a = this.nameByDeviceId.get(deviceId)) == null ? void 0 : _a.trim()) != null ? _b : "";
    return name.length > 0 && name !== deviceId ? `${name} (${deviceId})` : deviceId;
  }
  /**
   * Prime the in-memory maps from the objects already in the DB, so writes work
   * for an appliance that is offline at start (its objects exist from a previous
   * run but no REST re-sync populated the maps this run). Covers all four write
   * readers: knownStates + optionKeys + the deviceId↔haId maps.
   */
  async primeFromObjects() {
    var _a, _b, _c, _d, _e, _f;
    const prefix = `${this.port.namespace}.`;
    try {
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      for (const [fullId, obj] of Object.entries(devices)) {
        const deviceId = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (_a = obj.native) != null ? _a : {};
        if (deviceId.length > 0 && !deviceId.includes(".") && typeof native.haId === "string") {
          this.deviceIdByHaId.set(native.haId, deviceId);
          this.haIdByDeviceId.set(deviceId, native.haId);
          if (typeof native.type === "string") {
            this.typeByDeviceId.set(deviceId, native.type);
          }
          if (typeof ((_b = obj.common) == null ? void 0 : _b.name) === "string") {
            this.nameByDeviceId.set(deviceId, obj.common.name);
          }
          if ((0, import_pure_helpers.isRecord)(native.programOptions)) {
            const defs = {};
            for (const [program, ids] of Object.entries(native.programOptions)) {
              if (Array.isArray(ids)) {
                defs[program] = ids.filter((v) => typeof v === "string");
              }
            }
            this.programDefs.set(deviceId, defs);
          }
        }
      }
    } catch (e) {
      this.port.log.debug(`priming devices from objects failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
    try {
      const objects = await this.port.getForeignObjects(`${this.port.namespace}.*`, "state");
      for (const [fullId, obj] of Object.entries(objects)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (_c = obj.native) != null ? _c : {};
        const bshKey = typeof native.bshKey === "string" ? native.bshKey : void 0;
        const bshValues = Array.isArray(native.bshValues) ? native.bshValues.filter((v) => typeof v === "string") : void 0;
        this.knownStates.set(rel, {
          bshKey,
          bshValues,
          // The pattern is type-filtered to states, so common is a StateCommon.
          metaSig: metaSignature((_d = obj.common) != null ? _d : {}, { bshKey, bshValues })
        });
        const parts = rel.split(".");
        if (parts.length === 3 && parts[1] === "options" && ((_e = obj.common) == null ? void 0 : _e.write) === true) {
          const deviceId = parts[0];
          const set = (_f = this.optionKeys.get(deviceId)) != null ? _f : /* @__PURE__ */ new Set();
          set.add(parts[2]);
          this.optionKeys.set(deviceId, set);
        }
      }
    } catch (e) {
      this.port.log.debug(`priming known states from objects failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * One-time move of device trees to the type-plate id scheme (the folder id is
   * the E-number, the display name stays the appliance's app name). Legacy
   * name-based trees are moved wholesale — device object, channels, states,
   * their values and the user's custom/history settings — because the folder id
   * is what scripts and charts point at, and the update must do the move, not
   * the user. Runs BEFORE the state migration and priming, so the maps only
   * ever see current ids.
   *
   * A device whose stored native carries no E-number/model code yet keeps its
   * id this run; the next sync persists those fields and the next start moves
   * it. Ids already on the scheme are claimed first, so a legacy tree's move
   * can never bump an already-migrated sibling onto a new suffix.
   */
  async migrateDeviceIds() {
    var _a;
    const prefix = `${this.port.namespace}.`;
    try {
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      const entries = [];
      const occupied = /* @__PURE__ */ new Set();
      for (const [fullId, obj] of Object.entries(devices)) {
        const id = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (_a = obj.native) != null ? _a : {};
        if (id.length === 0 || id.includes(".") || typeof native.haId !== "string") {
          continue;
        }
        occupied.add(id);
        const source = [native.enumber, native.vib].find(
          (v) => typeof v === "string" && v.trim().length > 0
        );
        if (!source) {
          continue;
        }
        entries.push({ id, obj, base: (0, import_pure_helpers.slugify)(source), haId: native.haId });
      }
      entries.sort((a, b) => a.haId < b.haId ? -1 : a.haId > b.haId ? 1 : 0);
      const taken = /* @__PURE__ */ new Set();
      for (const e of entries) {
        if (e.id === e.base || e.id.startsWith(`${e.base}-`)) {
          taken.add(e.id);
        }
      }
      for (const e of entries) {
        if (taken.has(e.id)) {
          continue;
        }
        const blocked = new Set([...taken, ...occupied].filter((x) => x !== e.id));
        const to = (0, import_pure_helpers.disambiguateSlug)(e.base, e.haId, blocked);
        taken.add(to);
        await this.moveApplianceTree(e.id, to, e.obj);
      }
    } catch (e) {
      this.port.log.warn(`migrating device ids failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * Move one appliance's whole object tree to a new device id: device object
   * (with the online-marker link rewritten), channel objects, state objects with
   * their `common` (a user rename, history settings) and `native`, and the
   * current state values. The old tree is deleted afterwards.
   *
   * @param from the current (legacy) device id
   * @param to the new type-plate device id
   * @param device the device object as read from the DB
   */
  async moveApplianceTree(from, to, device) {
    var _a, _b, _c, _d, _e;
    const prefix = `${this.port.namespace}.`;
    const name = typeof ((_a = device.common) == null ? void 0 : _a.name) === "string" ? device.common.name : from;
    const common = {
      ...(_b = device.common) != null ? _b : {},
      // The marker link carries the FULL path — pointing at the old folder would
      // leave the green/grey dot reading a state that no longer updates.
      statusStates: { onlineId: `${prefix}${to}.info.reachable` }
    };
    await this.port.setObjectNotExists(to, { type: "device", common, native: (_c = device.native) != null ? _c : {} });
    for (const type of ["channel", "state"]) {
      const objects = await this.port.getForeignObjects(`${prefix}${from}.*`, type);
      for (const [fullId, obj] of Object.entries(objects)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        if (!rel.startsWith(`${from}.`)) {
          continue;
        }
        const target = `${to}.${rel.slice(from.length + 1)}`;
        await this.port.setObjectNotExists(target, {
          type,
          common: (_d = obj.common) != null ? _d : {},
          native: (_e = obj.native) != null ? _e : {}
        });
        if (type === "state") {
          const previous = await this.port.getState(rel);
          if (previous && previous.val !== null && previous.val !== void 0) {
            await this.port.setState(target, { val: previous.val, ack: true });
          }
        }
      }
    }
    await this.port.delObjectRecursive(from);
    this.port.log.info(
      `Appliance "${name}" moved to ${to} \u2014 device folders are now named by the type plate's E-number.`
    );
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
  async migrateRenamedStates() {
    var _a, _b, _c, _d, _e, _f, _g;
    const prefix = `${this.port.namespace}.`;
    try {
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      const typeByDevice = /* @__PURE__ */ new Map();
      for (const [fullId, obj] of Object.entries(devices)) {
        const deviceId = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const type = (_a = obj.native) == null ? void 0 : _a.type;
        if (!deviceId.includes(".") && typeof type === "string") {
          typeByDevice.set(deviceId, type);
        }
      }
      const states = await this.port.getForeignObjects(`${this.port.namespace}.*`, "state");
      const remaining = /* @__PURE__ */ new Map();
      for (const fullId of Object.keys(states)) {
        const parts = (fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId).split(".");
        if (parts.length >= 3) {
          const channelPath = `${parts[0]}.${parts[1]}`;
          remaining.set(channelPath, ((_b = remaining.get(channelPath)) != null ? _b : 0) + 1);
        }
      }
      const drainedCandidates = /* @__PURE__ */ new Set();
      let migrated = 0;
      for (const [fullId, obj] of Object.entries(states)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const parts = rel.split(".");
        if (parts.length < 3) {
          continue;
        }
        const deviceId = (_c = parts[0]) != null ? _c : "";
        const channelPath = `${deviceId}.${parts[1]}`;
        const type = typeByDevice.get(deviceId);
        if (type && import_device_catalog.PROGRAMLESS_TYPES.has(type) && parts[1] === "programs") {
          await this.deleteMigratedState(rel, channelPath, remaining, drainedCandidates);
          migrated++;
          continue;
        }
        const native = (_d = obj.native) != null ? _d : {};
        if (typeof native.bshKey !== "string") {
          continue;
        }
        const lockable = import_device_catalog.LOCKABLE_DOOR_TYPES.has(type != null ? type : "");
        const oldValue = (_e = await this.port.getState(rel)) == null ? void 0 : _e.val;
        const value = (0, import_value_transformer.isDoorStatusKey)(native.bshKey) && typeof oldValue === "string" ? `BSH.Common.EnumType.DoorState.${oldValue.charAt(0).toUpperCase()}${oldValue.slice(1)}` : oldValue;
        const expanded = (0, import_value_transformer.expandBshItem)({ key: native.bshKey, value }, lockable);
        if (expanded.some((t) => `${t.channel}.${t.id}` === parts.slice(1).join("."))) {
          continue;
        }
        const oneToOne = expanded.length === 1;
        for (const t of expanded) {
          const newRel = `${deviceId}.${t.channel}.${t.id}`;
          const common = { ...t.common };
          const oldCommon = (_f = obj.common) != null ? _f : {};
          if (oneToOne && t.common.type === oldCommon.type) {
            Object.assign(common, oldCommon);
            if (t.channel === "settings") {
              common.write = true;
            }
          }
          if (typeof oldCommon.name === "string" && oldCommon.name !== parts[parts.length - 1]) {
            common.name = oldCommon.name;
          } else {
            common.name = t.id;
          }
          await this.port.extendObject(`${deviceId}.${t.channel}`, {
            type: "channel",
            common: { name: t.channel },
            native: {}
          });
          await this.port.extendObject(newRel, {
            type: "state",
            common,
            native: { bshKey: native.bshKey, bshValues: t.bshValues }
          });
          const newValue = oneToOne && t.common.type === oldCommon.type ? oldValue : t.value;
          if (newValue !== null && newValue !== void 0) {
            await this.port.setState(newRel, { val: newValue, ack: true });
          }
          this.port.log.debug(`migrated ${rel} \u2192 ${newRel}`);
        }
        await this.deleteMigratedState(rel, channelPath, remaining, drainedCandidates);
        migrated++;
      }
      for (const channelPath of drainedCandidates) {
        if (((_g = remaining.get(channelPath)) != null ? _g : 0) === 0) {
          await this.port.delObject(channelPath).catch(() => void 0);
        }
      }
      if (migrated > 0) {
        this.port.log.info(`Migrated ${migrated} datapoint(s) to the corrected tree layout.`);
      }
    } catch (e) {
      this.port.log.warn(`migrating renamed datapoints failed: ${(0, import_pure_helpers.errMessage)(e)}`);
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
  async deleteMigratedState(rel, channelPath, remaining, drained) {
    var _a;
    try {
      await this.port.delObject(rel);
    } catch (e) {
      this.port.log.debug(`removing ${rel} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
    remaining.set(channelPath, ((_a = remaining.get(channelPath)) != null ? _a : 1) - 1);
    drained.add(channelPath);
  }
  /**
   * Route a stream event to its device's states.
   *
   * @param event the parsed SSE event
   */
  handleStreamEvent(event) {
    try {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!(0, import_pure_helpers.isRecord)(payload)) {
        return;
      }
      const payloadHaId = typeof payload.haId === "string" && payload.haId.length > 0 ? payload.haId : void 0;
      const haId = payloadHaId != null ? payloadHaId : event.id || void 0;
      if (!haId) {
        return;
      }
      const deviceId = this.deviceIdByHaId.get(haId);
      if (event.event === "CONNECTED" || event.event === "PAIRED") {
        if (deviceId) {
          void this.guarded(async () => {
            await this.setReachable(deviceId, true);
            await this.syncApplianceData(deviceId, haId);
          });
        } else if (event.event === "PAIRED") {
          void this.guarded(() => this.syncAppliances());
        } else {
          void this.guarded(() => this.syncSingleAppliance(haId));
        }
        return;
      }
      if (!deviceId) {
        return;
      }
      if (event.event === "DISCONNECTED") {
        void this.guarded(() => this.setReachable(deviceId, false));
        return;
      }
      if (event.event === "DEPAIRED") {
        this.port.log.info(
          `Appliance ${this.label(deviceId)} was removed from the Home Connect account \u2014 removing its objects.`
        );
        void this.guarded(() => this.removeAppliance(deviceId, haId));
        return;
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const raw of items) {
        if ((0, import_pure_helpers.isRecord)(raw)) {
          void this.guarded(() => this.applyBshItem(deviceId, raw, "values"));
        }
      }
    } catch (e) {
      this.port.log.warn(`handling stream event failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * Run a fire-and-forget async unit with a top-level catch (no unhandled rejection).
   *
   * @param fn the async unit to run
   */
  async guarded(fn) {
    try {
      await fn();
    } catch (e) {
      this.port.log.warn(`appliance sync task failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /** Fetch the paired appliances and build/update their object tree. */
  async syncAppliances() {
    const data = await this.port.apiGet("/api/homeappliances");
    if (!(0, import_pure_helpers.isRecord)(data) || !Array.isArray(data.homeappliances)) {
      this.port.log.debug("appliance list not available \u2014 keeping the current tree.");
      return;
    }
    const list = data.homeappliances;
    this.port.log.info(`Setting up ${list.length} appliance(s) from the Home Connect account...`);
    const seen = /* @__PURE__ */ new Set();
    for (const raw of list) {
      if ((0, import_pure_helpers.isRecord)(raw)) {
        if (typeof raw.haId === "string") {
          seen.add(raw.haId);
        }
        await this.syncAppliance(raw);
      }
    }
    for (const [haId, deviceId] of [...this.deviceIdByHaId]) {
      if (!seen.has(haId)) {
        this.port.log.info(
          `Appliance ${this.label(deviceId)} is no longer on the Home Connect account \u2014 removing its objects.`
        );
        await this.removeAppliance(deviceId, haId);
      }
    }
  }
  /**
   * Fetch a single appliance (used for a CONNECTED event whose haId we don't know yet).
   *
   * @param haId the appliance's haId
   */
  async syncSingleAppliance(haId) {
    const data = await this.port.apiGet(appliancePath(haId));
    if ((0, import_pure_helpers.isRecord)(data)) {
      await this.syncAppliance(data);
    }
  }
  /**
   * Build the object tree for one appliance under its type-plate id and sync its data
   * (only when currently connected).
   *
   * @param a the appliance record from /api/homeappliances
   */
  async syncAppliance(a) {
    var _a, _b, _c;
    const haId = typeof a.haId === "string" ? a.haId : void 0;
    if (!haId) {
      return;
    }
    const name = typeof a.name === "string" && a.name.length > 0 ? a.name : (_a = applianceIdSource(a)) != null ? _a : haId;
    const deviceId = (_c = this.deviceIdByHaId.get(haId)) != null ? _c : this.assignDeviceId(haId, (_b = applianceIdSource(a)) != null ? _b : haId, name);
    this.nameByDeviceId.set(deviceId, name);
    await this.port.extendObject(deviceId, {
      type: "device",
      // statusStates is what puts the green/grey dot on the device node — the
      // `info.reachable` state alone is just a value nobody links to the icon.
      // The id has to be the full path, not the device-relative one.
      common: { name, statusStates: { onlineId: `${this.port.namespace}.${deviceId}.info.reachable` } },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber }
    });
    if (typeof a.type === "string") {
      this.typeByDeviceId.set(deviceId, a.type);
    }
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
  async ensureEventStates(deviceId) {
    for (const key of (0, import_device_catalog.eventKeysForType)(this.typeByDeviceId.get(deviceId))) {
      const t = (0, import_value_transformer.transformItem)({ key, value: void 0 });
      const fullId = `${deviceId}.${t.channel}.${t.id}`;
      if (this.knownStates.has(fullId)) {
        continue;
      }
      await this.createState(deviceId, t.channel, t.id, t.common, { bshKey: key });
      await this.port.setStateChanged(fullId, { val: false, ack: true });
    }
  }
  /**
   * Create one state object (with its channel) and register it in the in-memory
   * map — the one shared shape behind every state-creating path (items, events,
   * options, buttons, the reachable marker).
   *
   * @param deviceId the id-safe device path segment
   * @param channel the channel the state lives under
   * @param id the within-channel state id
   * @param common the state's `common`
   * @param native the BSH parts for the state's `native`
   * @param native.bshKey the fully-qualified BSH key, when there is one
   * @param native.bshValues the full BSH candidate values of a writable enum
   * @returns the namespace-relative state id
   */
  async createState(deviceId, channel, id, common, native) {
    const fullId = `${deviceId}.${channel}.${id}`;
    await this.port.extendObject(`${deviceId}.${channel}`, { type: "channel", common: { name: channel }, native: {} });
    await this.port.extendObject(fullId, { type: "state", common, native });
    this.knownStates.set(fullId, {
      bshKey: native.bshKey,
      bshValues: native.bshValues,
      metaSig: metaSignature(common, native)
    });
    return fullId;
  }
  /**
   * Create (once) and set the per-device online indicator, fed by the appliance
   * list's `connected` flag and the CONNECTED / DISCONNECTED / DEPAIRED stream
   * events — so stale values are distinguishable from live ones.
   *
   * @param deviceId the id-safe device path segment
   * @param reachable whether the appliance is currently connected to Home Connect
   */
  async setReachable(deviceId, reachable) {
    const fullId = `${deviceId}.info.reachable`;
    if (!this.knownStates.has(fullId)) {
      await this.createState(
        deviceId,
        "info",
        "reachable",
        { name: "reachable", type: "boolean", role: "indicator.reachable", read: true, write: false, def: false },
        {}
      );
    }
    const previous = this.reachableByDeviceId.get(deviceId);
    if (previous !== void 0 && previous !== reachable) {
      this.port.log.debug(`Appliance ${this.label(deviceId)} is now ${reachable ? "online" : "offline"}.`);
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
  async writeDeviceRollup() {
    const values = [...this.reachableByDeviceId.values()];
    const online = values.filter(Boolean).length;
    await this.port.setStateChanged("info.devicesTotal", { val: values.length, ack: true });
    await this.port.setStateChanged("info.devicesOnline", { val: online, ack: true });
    await this.port.setStateChanged("info.devicesAllOnline", {
      val: values.length > 0 && online === values.length,
      ack: true
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
  async markAllUnreachable() {
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
   * @param deviceId the device id to remove
   * @param haId its Home Connect appliance id
   */
  async removeAppliance(deviceId, haId) {
    try {
      await this.port.delObjectRecursive(deviceId);
    } catch (e) {
      this.port.log.debug(`removing the object tree of ${deviceId} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
    this.deviceIdByHaId.delete(haId);
    this.haIdByDeviceId.delete(deviceId);
    this.optionKeys.delete(deviceId);
    this.reachableByDeviceId.delete(deviceId);
    this.typeByDeviceId.delete(deviceId);
    this.nameByDeviceId.delete(deviceId);
    this.programDefs.delete(deviceId);
    for (const rel of [...this.knownStates.keys()]) {
      if (rel === deviceId || rel.startsWith(`${deviceId}.`)) {
        this.knownStates.delete(rel);
      }
    }
    await this.writeDeviceRollup();
  }
  /**
   * Assign a stable, collision-free device id to an haId (first time seen).
   * The id comes from the type plate ({@link applianceIdSource}); two identical
   * models on one account get the haId suffix from {@link disambiguateSlug}.
   * Once assigned, the id is pinned (via the DB and priming) — a later rename
   * in the app changes only the display name, never the folder.
   *
   * @param haId the appliance's haId
   * @param idSource the raw id source (E-number, model code, or haId)
   * @param name its friendly display name (for the one-time log line)
   * @returns the assigned device id
   */
  assignDeviceId(haId, idSource, name) {
    const deviceId = (0, import_pure_helpers.disambiguateSlug)((0, import_pure_helpers.slugify)(idSource), haId, new Set(this.haIdByDeviceId.keys()));
    this.deviceIdByHaId.set(haId, deviceId);
    this.haIdByDeviceId.set(deviceId, haId);
    this.nameByDeviceId.set(deviceId, name);
    this.port.log.info(`New appliance ${this.label(deviceId)} \u2014 creating its tree.`);
    return deviceId;
  }
  /**
   * Sync a connected appliance's full data tree. Serialised per device so
   * overlapping CONNECTED / re-sync events don't double-fetch or race the maps.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async syncApplianceData(deviceId, haId) {
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
  async syncItems(deviceId, haId, subpath, arrayKey) {
    const data = await this.port.apiGet(appliancePath(haId, subpath));
    if (!(0, import_pure_helpers.isRecord)(data) || !Array.isArray(data[arrayKey])) {
      return;
    }
    for (const raw of data[arrayKey]) {
      if ((0, import_pure_helpers.isRecord)(raw)) {
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
  async applyBshItem(deviceId, raw, source) {
    var _a;
    if (typeof raw.key !== "string") {
      return;
    }
    const lockableDoor = import_device_catalog.LOCKABLE_DOOR_TYPES.has((_a = this.typeByDeviceId.get(deviceId)) != null ? _a : "");
    const states = (0, import_value_transformer.expandBshItem)(
      {
        key: raw.key,
        value: raw.value,
        unit: typeof raw.unit === "string" ? raw.unit : void 0,
        constraints: (0, import_value_transformer.parseConstraints)(raw.constraints)
      },
      lockableDoor
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
  async applyTransformedState(deviceId, bshKey, t, source) {
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    const known = this.knownStates.get(fullId);
    if (!known) {
      await this.createState(deviceId, t.channel, t.id, t.common, { bshKey, bshValues: t.bshValues });
    } else if (source === "sync") {
      const sig = metaSignature(t.common, { bshKey, bshValues: t.bshValues });
      if (known.metaSig !== sig) {
        await this.replaceStateObject(fullId, t.common, { bshKey, bshValues: t.bshValues });
        this.knownStates.set(fullId, { bshKey, bshValues: t.bshValues, metaSig: sig });
      }
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
  async replaceStateObject(fullId, common, native) {
    const fresh = { ...common };
    try {
      const existing = await this.port.getObject(fullId);
      if (existing == null ? void 0 : existing.common) {
        if (existing.common.name !== void 0) {
          fresh.name = existing.common.name;
        }
        if (existing.common.custom) {
          fresh.custom = existing.common.custom;
        }
      }
      const previous = await this.port.getState(fullId);
      await this.port.delObject(fullId);
      await this.port.setObjectNotExists(fullId, { type: "state", common: fresh, native });
      if (previous && previous.val !== null && previous.val !== void 0) {
        await this.port.setState(fullId, { val: previous.val, ack: true });
      }
      this.port.log.debug(`refreshed object metadata of ${fullId}`);
    } catch (e) {
      this.port.log.warn(`refreshing object metadata of ${fullId} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
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
  async syncPrograms(deviceId, haId) {
    var _a, _b;
    if (import_device_catalog.PROGRAMLESS_TYPES.has((_a = this.typeByDeviceId.get(deviceId)) != null ? _a : "")) {
      return;
    }
    const avail = await this.port.apiGet(appliancePath(haId, "/programs/available"));
    const fetchedKeys = (0, import_pure_helpers.isRecord)(avail) && Array.isArray(avail.programs) ? avail.programs.filter(import_pure_helpers.isRecord).map((p) => p.key).filter((k) => typeof k === "string") : void 0;
    if (fetchedKeys) {
      await this.syncProgramDefs(deviceId, haId, fetchedKeys);
    }
    const knownKeys = fetchedKeys && fetchedKeys.length > 0 ? fetchedKeys : Object.keys((_b = this.programDefs.get(deviceId)) != null ? _b : {});
    const selected = await this.port.apiGet(appliancePath(haId, "/programs/selected"));
    const selectedKey = (0, import_pure_helpers.isRecord)(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || knownKeys.length > 0) {
      await this.applyBshItem(
        deviceId,
        {
          key: "BSH.Common.Root.SelectedProgram",
          value: selectedKey,
          ...knownKeys.length > 0 ? { constraints: { allowedvalues: knownKeys } } : {}
        },
        knownKeys.length > 0 ? "sync" : "values"
      );
    }
    if (selectedKey.length > 0) {
      await this.activateProgramOptions(deviceId, haId, selectedKey);
    }
    if ((0, import_pure_helpers.isRecord)(selected)) {
      await this.applyProgramOptions(deviceId, selected.options);
    }
    const active = await this.port.apiGet(appliancePath(haId, "/programs/active"));
    const activeKey = (0, import_pure_helpers.isRecord)(active) && typeof active.key === "string" ? active.key : "";
    if (activeKey.length > 0 || knownKeys.length > 0 || this.knownStates.has(`${deviceId}.programs.activeProgram`)) {
      await this.applyBshItem(deviceId, { key: "BSH.Common.Root.ActiveProgram", value: activeKey }, "sync");
    }
    if ((0, import_pure_helpers.isRecord)(active)) {
      await this.applyProgramOptions(deviceId, active.options);
    }
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
  async applyProgramOptions(deviceId, options) {
    if (!Array.isArray(options)) {
      return;
    }
    for (const raw of options) {
      if ((0, import_pure_helpers.isRecord)(raw)) {
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
  async syncProgramDefs(deviceId, haId, programKeys) {
    var _a;
    const cached = (_a = this.programDefs.get(deviceId)) != null ? _a : {};
    this.programDefs.set(deviceId, cached);
    let changed = false;
    for (const programKey of programKeys) {
      if (cached[programKey]) {
        continue;
      }
      const def = await this.port.apiGet(appliancePath(haId, `/programs/available/${encodeURIComponent(programKey)}`));
      if (!(0, import_pure_helpers.isRecord)(def) || !Array.isArray(def.options) && typeof def.key !== "string") {
        continue;
      }
      const options = Array.isArray(def.options) ? def.options : [];
      const ids = [];
      for (const raw of options) {
        if ((0, import_pure_helpers.isRecord)(raw)) {
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
        await this.port.extendObject(deviceId, { native: { programOptions: cached } });
      } catch (e) {
        this.port.log.debug(`persisting the program definition cache of ${deviceId} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
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
  async activateProgramOptions(deviceId, haId, programKey) {
    var _a;
    let cached = this.programDefs.get(deviceId);
    if (!(cached == null ? void 0 : cached[programKey])) {
      await this.syncProgramDefs(deviceId, haId, [programKey]);
      cached = this.programDefs.get(deviceId);
    }
    this.optionKeys.set(deviceId, new Set((_a = cached == null ? void 0 : cached[programKey]) != null ? _a : []));
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
  async applyOptionDefinition(deviceId, raw) {
    if (typeof raw.key !== "string") {
      return void 0;
    }
    const opt = {
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : void 0,
      type: typeof raw.type === "string" ? raw.type : void 0,
      unit: typeof raw.unit === "string" ? raw.unit : void 0,
      constraints: (0, import_value_transformer.parseConstraints)(raw.constraints)
    };
    const t = (0, import_value_transformer.transformOptionDefinition)(opt);
    const fullId = `${deviceId}.options.${t.id}`;
    const known = this.knownStates.get(fullId);
    if (!known) {
      await this.createState(deviceId, "options", t.id, t.common, { bshKey: opt.key, bshValues: t.bshValues });
      await this.port.setStateChanged(fullId, { val: t.value, ack: true });
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
  async mergeOptionDefinition(fullId, known, t) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const common = { ...t.common };
    let exCommon = {};
    try {
      exCommon = (_b = (_a = await this.port.getObject(fullId)) == null ? void 0 : _a.common) != null ? _b : {};
    } catch (e) {
      this.port.log.debug(`reading ${fullId} for the definition merge failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
    let bshValues = t.bshValues;
    if (((_d = (_c = known.bshValues) == null ? void 0 : _c.length) != null ? _d : 0) > 0 || ((_f = (_e = t.bshValues) == null ? void 0 : _e.length) != null ? _f : 0) > 0) {
      const union = [...(_g = known.bshValues) != null ? _g : []];
      for (const v of (_h = t.bshValues) != null ? _h : []) {
        if (!union.includes(v)) {
          union.push(v);
        }
      }
      bshValues = union;
      const exStates = (0, import_pure_helpers.isRecord)(exCommon.states) ? exCommon.states : {};
      const newStates = (0, import_pure_helpers.isRecord)(common.states) ? common.states : {};
      const states = {};
      for (const v of union) {
        const short = (0, import_value_transformer.shortEnum)(v);
        states[short] = (_j = (_i = exStates[short]) != null ? _i : newStates[short]) != null ? _j : short;
      }
      common.states = states;
    }
    if (typeof exCommon.min === "number") {
      common.min = typeof common.min === "number" ? Math.min(common.min, exCommon.min) : exCommon.min;
    }
    if (typeof exCommon.max === "number") {
      common.max = typeof common.max === "number" ? Math.max(common.max, exCommon.max) : exCommon.max;
    }
    if (common.step === void 0 && typeof exCommon.step === "number") {
      common.step = exCommon.step;
    }
    if (common.unit === void 0 && typeof exCommon.unit === "string") {
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
  async ensureCommands(deviceId, haId) {
    const data = await this.port.apiGet(appliancePath(haId, "/commands"));
    const commands = (0, import_pure_helpers.isRecord)(data) && Array.isArray(data.commands) ? data.commands : [];
    for (const raw of commands) {
      if ((0, import_pure_helpers.isRecord)(raw) && typeof raw.key === "string") {
        const id = (0, import_value_transformer.stateIdForKey)(raw.key).id;
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
  async ensureButton(deviceId, channel, id, name, bshKey) {
    if (this.knownStates.has(`${deviceId}.${channel}.${id}`)) {
      return;
    }
    await this.createState(
      deviceId,
      channel,
      id,
      { name, type: "boolean", role: "button", read: false, write: true },
      { bshKey }
    );
  }
  /**
   * Handle a user write (ack:false already filtered by main): resolve it into a
   * Home Connect request and send it, with a top-level catch (fire-and-forget safe).
   *
   * @param id the full (namespace-qualified) state id
   * @param value the written value
   */
  async handleWrite(id, value) {
    var _a;
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
      if (channel === "options" && !((_a = this.optionKeys.get(deviceId)) == null ? void 0 : _a.has(stateId))) {
        this.port.log.debug(`Write to ${rel} ignored (not a writable option of the selected program).`);
        return;
      }
      const meta = this.knownStates.get(rel);
      const ctx = {
        haId,
        channel,
        id: stateId,
        bshKey: meta == null ? void 0 : meta.bshKey,
        bshValues: meta == null ? void 0 : meta.bshValues,
        value
      };
      if (channel === "programs" && stateId === "start") {
        ctx.selectedProgramKey = await this.resolveSelectedProgramKey(deviceId);
        ctx.selectedOptions = await this.collectSelectedOptions(deviceId);
      }
      const req = (0, import_command_dispatch.resolveWrite)(ctx);
      if (req) {
        const res = await this.port.apiWrite(req);
        await this.postWrite(channel, stateId, deviceId, haId, req, res);
        if ((res == null ? void 0 : res.ok) && !this.isMomentaryButton(channel, stateId)) {
          await this.port.setState(rel, { val: value, ack: true });
        }
      } else {
        this.port.log.debug(`Write to ${rel} ignored (no matching Home Connect command).`);
      }
      if (this.isMomentaryButton(channel, stateId)) {
        await this.port.setStateChanged(rel, { val: false, ack: true });
      }
    } catch (e) {
      this.port.log.warn(`handling write to ${id} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * Whether a state is a momentary button (a press carrying no lasting value).
   *
   * @param channel the state's channel
   * @param stateId the within-channel id
   * @returns whether it is a command / program-start / program-stop button
   */
  isMomentaryButton(channel, stateId) {
    return channel === "commands" || channel === "programs" && (stateId === "start" || stateId === "stop");
  }
  /**
   * Resolve the full BSH key of the currently selected program.
   *
   * @param deviceId the id-safe device path segment
   * @returns the full program key, or undefined
   */
  async resolveSelectedProgramKey(deviceId) {
    var _a, _b;
    const st = await this.port.getState(`${deviceId}.programs.selectedProgram`);
    const short = typeof (st == null ? void 0 : st.val) === "string" ? st.val : "";
    if (short.length === 0) {
      return void 0;
    }
    return (_b = (_a = this.knownStates.get(`${deviceId}.programs.selectedProgram`)) == null ? void 0 : _a.bshValues) == null ? void 0 : _b.find((v) => (0, import_value_transformer.shortEnum)(v) === short);
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
  async postWrite(channel, stateId, deviceId, haId, req, res) {
    var _a, _b;
    if (!res) {
      return;
    }
    if (channel === "programs" && stateId === "selectedProgram" && res.ok && ((_a = req.body) == null ? void 0 : _a.key)) {
      await this.activateProgramOptions(deviceId, haId, req.body.key);
      return;
    }
    if (channel === "programs" && stateId === "start" && res.status === 409 && ((_b = req.body) == null ? void 0 : _b.options)) {
      this.port.log.info("Program did not start with the selected options \u2014 retrying with defaults.");
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
  async collectSelectedOptions(deviceId) {
    const result = [];
    const ids = this.optionKeys.get(deviceId);
    if (!ids) {
      return result;
    }
    for (const id of ids) {
      const relId = `${deviceId}.options.${id}`;
      const meta = this.knownStates.get(relId);
      if (!(meta == null ? void 0 : meta.bshKey)) {
        continue;
      }
      const st = await this.port.getState(relId);
      if (!st || st.val === null || st.val === void 0) {
        continue;
      }
      const value = meta.bshValues && meta.bshValues.length > 0 ? meta.bshValues.find((v) => (0, import_value_transformer.shortEnum)(v) === st.val) : st.val;
      if (value !== void 0 && value !== null) {
        result.push({ key: meta.bshKey, value });
      }
    }
    return result;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApplianceSync,
  metaSignature
});
//# sourceMappingURL=appliance-sync.js.map
