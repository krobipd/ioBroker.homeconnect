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
class ApplianceSync {
  /**
   * @param port the injected adapter capabilities
   */
  constructor(port) {
    this.port = port;
  }
  port;
  /** haId → speaking device id, for routing stream events. */
  deviceIdByHaId = /* @__PURE__ */ new Map();
  /** speaking device id → haId, for routing writes back to the appliance. */
  haIdByDeviceId = /* @__PURE__ */ new Map();
  /** Namespace-relative state id → its BSH key + candidate values; also gates object creation. */
  knownStates = /* @__PURE__ */ new Map();
  /** device id → the option ids from the selected program's definition (writable, sent on start). */
  optionKeys = /* @__PURE__ */ new Map();
  /** device ids with an in-flight data sync — serialises concurrent CONNECTED/re-sync events. */
  syncing = /* @__PURE__ */ new Set();
  /** device id → its last written reachable value, the single source for the instance summary. */
  reachableByDeviceId = /* @__PURE__ */ new Map();
  /**
   * Prime the in-memory maps from the objects already in the DB, so writes work
   * for an appliance that is offline at start (its objects exist from a previous
   * run but no REST re-sync populated the maps this run). Covers all four write
   * readers: knownStates + optionKeys + the deviceId↔haId maps.
   */
  async primeFromObjects() {
    var _a, _b, _c, _d, _e;
    const prefix = `${this.port.namespace}.`;
    try {
      const devices = await this.port.getForeignObjects(`${this.port.namespace}.*`, "device");
      for (const [fullId, obj] of Object.entries(devices)) {
        const deviceId = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const haId = (_a = obj.native) == null ? void 0 : _a.haId;
        if (deviceId.length > 0 && !deviceId.includes(".") && typeof haId === "string") {
          this.deviceIdByHaId.set(haId, deviceId);
          this.haIdByDeviceId.set(deviceId, haId);
        }
      }
    } catch (e) {
      this.port.log.debug(`priming devices from objects failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
    try {
      const objects = await this.port.getForeignObjects(`${this.port.namespace}.*`, "state");
      for (const [fullId, obj] of Object.entries(objects)) {
        const rel = fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
        const native = (_b = obj.native) != null ? _b : {};
        const bshKey = typeof native.bshKey === "string" ? native.bshKey : void 0;
        const bshValues = Array.isArray(native.bshValues) ? native.bshValues.filter((v) => typeof v === "string") : void 0;
        this.knownStates.set(rel, {
          bshKey,
          bshValues,
          // The pattern is type-filtered to states, so common is a StateCommon.
          metaSig: metaSignature((_c = obj.common) != null ? _c : {}, { bshKey, bshValues })
        });
        const parts = rel.split(".");
        if (parts.length === 3 && parts[1] === "options" && ((_d = obj.common) == null ? void 0 : _d.write) === true) {
          const deviceId = parts[0];
          const set = (_e = this.optionKeys.get(deviceId)) != null ? _e : /* @__PURE__ */ new Set();
          set.add(parts[2]);
          this.optionKeys.set(deviceId, set);
        }
      }
    } catch (e) {
      this.port.log.debug(`priming known states from objects failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
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
        this.port.log.info(`Appliance ${deviceId} was removed from the Home Connect account \u2014 removing its objects.`);
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
        this.port.log.info(`Appliance ${deviceId} is no longer on the Home Connect account \u2014 removing its objects.`);
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
  async syncSingleAppliance(haId) {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}`);
    if ((0, import_pure_helpers.isRecord)(data)) {
      await this.syncAppliance(data);
    }
  }
  /**
   * Build the object tree for one appliance under a speaking id and sync its data
   * (only when currently connected).
   *
   * @param a the appliance record from /api/homeappliances
   */
  async syncAppliance(a) {
    var _a;
    const haId = typeof a.haId === "string" ? a.haId : void 0;
    if (!haId) {
      return;
    }
    const name = typeof a.name === "string" && a.name.length > 0 ? a.name : haId;
    const deviceId = (_a = this.deviceIdByHaId.get(haId)) != null ? _a : this.assignDeviceId(haId, name);
    await this.port.extendObject(deviceId, {
      type: "device",
      // statusStates is what puts the green/grey dot on the device node — the
      // `info.reachable` state alone is just a value nobody links to the icon.
      // The id has to be the full path, not the device-relative one.
      common: { name, statusStates: { onlineId: `${this.port.namespace}.${deviceId}.info.reachable` } },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber }
    });
    await this.setReachable(deviceId, a.connected === true);
    if (a.connected === true) {
      await this.syncApplianceData(deviceId, haId);
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
  async setReachable(deviceId, reachable) {
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
          def: false
        },
        native: {}
      });
      this.knownStates.set(fullId, {});
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
   * @param deviceId the speaking device id to remove
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
  assignDeviceId(haId, name) {
    const deviceId = (0, import_pure_helpers.disambiguateSlug)((0, import_pure_helpers.slugify)(name), haId, new Set(this.haIdByDeviceId.keys()));
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
  async syncApplianceData(deviceId, haId) {
    if (this.syncing.has(deviceId)) {
      return;
    }
    this.syncing.add(deviceId);
    try {
      await this.syncItems(deviceId, haId, "/status", "status", "status");
      await this.syncItems(deviceId, haId, "/settings", "settings", "settings");
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
   * @param channel the channel the fetched items live under (and get pruned in)
   */
  async syncItems(deviceId, haId, subpath, arrayKey, channel) {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}${subpath}`);
    if (!(0, import_pure_helpers.isRecord)(data) || !Array.isArray(data[arrayKey])) {
      return;
    }
    const seen = /* @__PURE__ */ new Set();
    for (const raw of data[arrayKey]) {
      if ((0, import_pure_helpers.isRecord)(raw)) {
        const rel = await this.applyBshItem(deviceId, raw, "sync");
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
  async pruneChannel(deviceId, channel, seen) {
    const channelPrefix = `${deviceId}.${channel}.`;
    const devicePrefix = `${deviceId}.`;
    for (const rel of [...this.knownStates.keys()]) {
      if (rel.startsWith(channelPrefix) && !seen.has(rel.slice(devicePrefix.length))) {
        try {
          await this.port.delObject(rel);
        } catch (e) {
          this.port.log.debug(`pruning ${rel} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
        }
        this.knownStates.delete(rel);
      }
    }
  }
  /**
   * Transform one raw BSH item and write it under the device's speaking tree.
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
   * @returns the within-channel state id (`channel.id`), or undefined if it had no key
   */
  async applyBshItem(deviceId, raw, source) {
    if (typeof raw.key !== "string") {
      return void 0;
    }
    const t = (0, import_value_transformer.transformItem)({
      key: raw.key,
      value: raw.value,
      unit: typeof raw.unit === "string" ? raw.unit : void 0,
      constraints: (0, import_value_transformer.parseConstraints)(raw.constraints)
    });
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    const known = this.knownStates.get(fullId);
    const sig = metaSignature(t.common, { bshKey: raw.key, bshValues: t.bshValues });
    if (!known) {
      await this.port.extendObject(`${deviceId}.${t.channel}`, {
        type: "channel",
        common: { name: t.channel },
        native: {}
      });
      await this.port.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: raw.key, bshValues: t.bshValues }
      });
      this.knownStates.set(fullId, { bshKey: raw.key, bshValues: t.bshValues, metaSig: sig });
    } else if (source === "sync" && known.metaSig !== sig) {
      await this.replaceStateObject(fullId, t.common, { bshKey: raw.key, bshValues: t.bshValues });
      this.knownStates.set(fullId, { bshKey: raw.key, bshValues: t.bshValues, metaSig: sig });
    }
    await this.port.setStateChanged(fullId, { val: t.value, ack: true });
    return `${t.channel}.${t.id}`;
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
   * Read active + selected + available programs into the tree.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async syncPrograms(deviceId, haId) {
    const avail = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available`);
    const availableKeys = (0, import_pure_helpers.isRecord)(avail) && Array.isArray(avail.programs) ? avail.programs.filter(import_pure_helpers.isRecord).map((p) => p.key).filter((k) => typeof k === "string") : [];
    const selected = await this.port.apiGet(`/api/homeappliances/${haId}/programs/selected`);
    const selectedKey = (0, import_pure_helpers.isRecord)(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || availableKeys.length > 0) {
      await this.applyBshItem(
        deviceId,
        {
          key: "BSH.Common.Root.SelectedProgram",
          value: selectedKey,
          constraints: { allowedvalues: availableKeys }
        },
        "sync"
      );
    }
    if (selectedKey.length > 0) {
      await this.loadProgramOptions(deviceId, haId, selectedKey);
    }
    if ((0, import_pure_helpers.isRecord)(selected)) {
      await this.applyProgramOptions(deviceId, selected.options);
    }
    const active = await this.port.apiGet(`/api/homeappliances/${haId}/programs/active`);
    const activeKey = (0, import_pure_helpers.isRecord)(active) && typeof active.key === "string" ? active.key : "";
    await this.applyBshItem(deviceId, { key: "BSH.Common.Root.ActiveProgram", value: activeKey }, "sync");
    if ((0, import_pure_helpers.isRecord)(active)) {
      await this.applyProgramOptions(deviceId, active.options);
    }
    if (availableKeys.length > 0) {
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
   * Load a program's option definitions and create them as writable option
   * states; remove option definitions the new program no longer has.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param programKey the full program key to load definitions for
   */
  async loadProgramOptions(deviceId, haId, programKey) {
    const def = await this.port.apiGet(`/api/homeappliances/${haId}/programs/available/${programKey}`);
    const options = (0, import_pure_helpers.isRecord)(def) && Array.isArray(def.options) ? def.options : [];
    const fresh = /* @__PURE__ */ new Set();
    for (const raw of options) {
      if ((0, import_pure_helpers.isRecord)(raw)) {
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
            this.port.log.debug(`removing stale option ${relId} failed: ${(0, import_pure_helpers.errMessage)(e)}`);
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
    const sig = metaSignature(t.common, { bshKey: opt.key, bshValues: t.bshValues });
    if (!known) {
      await this.port.extendObject(`${deviceId}.options`, {
        type: "channel",
        common: { name: "options" },
        native: {}
      });
      await this.port.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: opt.key, bshValues: t.bshValues }
      });
      await this.port.setStateChanged(fullId, { val: t.value, ack: true });
    } else if (known.metaSig !== sig) {
      await this.replaceStateObject(fullId, t.common, { bshKey: opt.key, bshValues: t.bshValues });
    }
    this.knownStates.set(fullId, { bshKey: opt.key, bshValues: t.bshValues, metaSig: sig });
    return t.id;
  }
  /**
   * Create the available commands as momentary buttons under `commands.*`.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async ensureCommands(deviceId, haId) {
    const data = await this.port.apiGet(`/api/homeappliances/${haId}/commands`);
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
    const fullId = `${deviceId}.${channel}.${id}`;
    if (this.knownStates.has(fullId)) {
      return;
    }
    await this.port.extendObject(`${deviceId}.${channel}`, { type: "channel", common: { name: channel }, native: {} });
    await this.port.extendObject(fullId, {
      type: "state",
      common: { name, type: "boolean", role: "button", read: false, write: true },
      native: bshKey ? { bshKey } : {}
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
      await this.loadProgramOptions(deviceId, haId, req.body.key);
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
