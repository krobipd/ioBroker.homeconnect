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
var report_source_exports = {};
__export(report_source_exports, {
  HomeConnectReportSource: () => HomeConnectReportSource,
  LIVE_PATHS: () => LIVE_PATHS,
  SECRET_MARK: () => SECRET_MARK,
  blankSecrets: () => blankSecrets
});
module.exports = __toCommonJS(report_source_exports);
var import_placeholders = require("./placeholders");
var import_device_catalog = require("../device-catalog");
var import_device_id = require("../device-id");
const LIVE_PATHS = ["", "/status", "/programs/selected", "/settings", "/programs/active", "/programs/available"];
const MIN_SERIAL_LENGTH = 8;
const SECRET_MARK = "<secret>";
class HomeConnectReportSource {
  /**
   * @param host the running adapter
   */
  constructor(host) {
    this.host = host;
  }
  host;
  adapter = "homeconnect";
  /** The recorded traffic per appliance, taken at the start of its live read and used by its body. */
  trails = /* @__PURE__ */ new Map();
  /** @returns the adapter version */
  get version() {
    return this.host.version;
  }
  /** @returns the adapter log */
  get log() {
    return this.host.log;
  }
  /** @returns every appliance, connected or not — a report is wanted exactly when one misbehaves */
  devices() {
    return this.host.appliances().map((a) => ({ id: a.id, label: a.name, connected: a.connected }));
  }
  /**
   * Read one connected appliance live: the fixed resources in order, until the first one nobody answers.
   *
   * @param id the device id
   * @returns the answers
   */
  async readLive(id) {
    var _a, _b;
    const appliance = this.appliance(id);
    this.trails.set(id, this.host.recorder.snapshot(appliance.haId));
    const blocked = this.host.liveReadBlocked();
    if (blocked !== void 0) {
      throw new Error(blocked);
    }
    const base = `/api/homeappliances/${encodeURIComponent(appliance.haId)}`;
    const type = this.host.applianceState(id).type;
    const paths = typeof type === "string" && import_device_catalog.PROGRAMLESS_TYPES.has(type) ? LIVE_PATHS.filter((path) => !path.startsWith("/programs")) : LIVE_PATHS;
    const answers = [];
    for (const path of paths) {
      const answer = await this.host.readRaw(`${base}${path}`);
      answers.push({ ...answer, path: path || "/" });
      if (answer.status === 0) {
        break;
      }
    }
    if (!answers.some((answer) => answer.status > 0)) {
      throw new Error(`Home Connect answered nothing (${(_b = (_a = answers[0]) == null ? void 0 : _a.error) != null ? _b : "no request went out"})`);
    }
    return answers;
  }
  /**
   * Build one appliance's report body.
   *
   * @param id the device id
   * @param live what the live read returned (undefined when not connected or it failed)
   * @param liveError why the live read failed
   * @returns the body and the device id as the report shows it
   */
  async build(id, live, liveError) {
    var _a, _b, _c, _d;
    const appliances = this.host.appliances();
    const appliance = this.appliance(id);
    const traffic = (_a = this.trails.get(id)) != null ? _a : this.host.recorder.snapshot(appliance.haId);
    this.trails.delete(id);
    const prefix = `${this.host.namespace}.${id}`;
    const [hostObject, deviceObject, tree] = await Promise.all([
      this.host.getForeignObjectAsync(`system.host.${this.host.hostName}`).catch(() => null),
      this.host.getForeignObjectAsync(prefix).catch(() => null),
      this.tree(prefix)
    ]);
    const others = appliances.filter((a) => a.id !== id).flatMap((a) => {
      var _a2;
      return [a.id, a.haId, (_a2 = a.name) != null ? _a2 : ""];
    });
    const content = {
      environment: {
        jsController: (_b = hostObject == null ? void 0 : hostObject.common) == null ? void 0 : _b.installedVersion,
        systemLanguage: this.host.systemLanguage,
        startedAt: new Date(this.host.startedAt).toISOString(),
        appliances: { total: appliances.length, connected: appliances.filter((a) => a.connected).length },
        config: this.host.config()
      },
      adapterState: this.host.adapterState(),
      appliance: {
        id,
        haId: appliance.haId,
        name: appliance.name,
        connected: appliance.connected,
        native: (_c = deviceObject == null ? void 0 : deviceObject.native) != null ? _c : {},
        sync: this.host.applianceState(id)
      },
      live: live ? { answers: live } : liveError !== void 0 ? { error: liveError } : void 0,
      traffic,
      account: this.host.recorder.account(),
      objectTree: tree,
      logs: this.host.logRing.about([id, appliance.haId, (_d = appliance.name) != null ? _d : ""], others)
    };
    const places = this.placeholders(appliances, tree);
    const blanked = blankSecrets(content, this.host.secrets());
    return { fileId: places.text(id), content: places.deep(blanked) };
  }
  /**
   * The placeholders of one report: every appliance's haId and serial, every name a user gave (the appliances' names and
   * the favourites' program names in the tree).
   *
   * @param appliances all appliances
   * @param tree the reported appliance's tree
   * @returns the placeholders
   */
  placeholders(appliances, tree) {
    const places = new import_placeholders.Placeholders();
    for (const appliance of appliances) {
      places.name(appliance.haId, "serial");
      const piece = (0, import_device_id.pieceNumber)(appliance.haId);
      if (piece !== void 0 && piece.length >= MIN_SERIAL_LENGTH) {
        places.name(piece, "serial");
      }
      if (appliance.name) {
        places.name(appliance.name);
      }
    }
    for (const entry of tree) {
      if (/(?:^|\.)programName$/.test(entry.id) && typeof entry.val === "string") {
        places.name(entry.val);
      }
    }
    return places;
  }
  /**
   * The appliance's datapoints as they really exist — type, role, unit, limits, value list and value. ONE appliance's
   * subtree, its values in ONE read.
   *
   * @param prefix the appliance's full id
   * @returns one entry per datapoint
   */
  async tree(prefix) {
    var _a;
    const start = `${prefix}.`;
    const [view, states] = await Promise.all([
      this.host.getObjectViewAsync("system", "state", { startkey: start, endkey: `${start}\u9999` }).catch(() => null),
      this.host.getForeignStatesAsync(`${start}*`).catch(() => null)
    ]);
    return ((_a = view == null ? void 0 : view.rows) != null ? _a : []).map((row) => {
      var _a2, _b;
      const common = (_b = (_a2 = row.value) == null ? void 0 : _a2.common) != null ? _b : {};
      const state = states == null ? void 0 : states[row.id];
      return {
        id: row.id.slice(start.length),
        type: common.type,
        role: common.role,
        unit: common.unit,
        write: common.write,
        min: common.min,
        max: common.max,
        step: common.step,
        states: common.states,
        val: state == null ? void 0 : state.val,
        ack: state == null ? void 0 : state.ack,
        ts: typeof (state == null ? void 0 : state.ts) === "number" ? new Date(state.ts).toISOString() : void 0
      };
    });
  }
  /**
   * One appliance.
   *
   * @param id the device id
   * @returns the appliance
   */
  appliance(id) {
    const appliance = this.host.appliances().find((a) => a.id === id);
    if (!appliance) {
      throw new Error(`unknown device '${id}'`);
    }
    return appliance;
  }
}
function blankSecrets(value, secrets) {
  const real = secrets.filter((secret) => secret.trim().length > 0).sort((a, b) => b.length - a.length);
  const blank = (text) => real.reduce((out, secret) => out.split(secret).join(SECRET_MARK), text);
  const walk = (item) => {
    if (typeof item === "string") {
      return blank(item);
    }
    if (Array.isArray(item)) {
      return item.map(walk);
    }
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, inner]) => [blank(key), walk(inner)]));
    }
    return item;
  };
  return walk(value);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HomeConnectReportSource,
  LIVE_PATHS,
  SECRET_MARK,
  blankSecrets
});
//# sourceMappingURL=report-source.js.map
