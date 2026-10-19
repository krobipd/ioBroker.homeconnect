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
var traffic_recorder_exports = {};
__export(traffic_recorder_exports, {
  CONNECTION_HISTORY: () => CONNECTION_HISTORY,
  RING_LIMITS: () => RING_LIMITS,
  TrafficRecorder: () => TrafficRecorder,
  haIdOfPath: () => haIdOfPath
});
module.exports = __toCommonJS(traffic_recorder_exports);
var import_byte_ring = require("./byte-ring");
const RING_LIMITS = {
  rest: { ring: 256 * 1024, entry: 64 * 1024 },
  writes: { ring: 32 * 1024, entry: 8 * 1024 },
  stream: { ring: 128 * 1024, entry: 16 * 1024 },
  account: { ring: 32 * 1024, entry: 8 * 1024 }
};
const CONNECTION_HISTORY = 50;
const CONNECTION_EVENTS = /* @__PURE__ */ new Set(["CONNECTED", "PAIRED", "DISCONNECTED"]);
function haIdOfPath(path) {
  const match = /^\/api\/homeappliances\/([^/?]+)/.exec(path);
  if (!match) {
    return void 0;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
function parsedData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
function itemKeys(data) {
  const items = data == null ? void 0 : data.items;
  if (!Array.isArray(items)) {
    return "";
  }
  return items.map((item) => typeof item === "object" && item !== null ? item.key : void 0).filter((key) => typeof key === "string").join(",");
}
class TrafficRecorder {
  /**
   * @param now the clock (injectable for tests)
   */
  constructor(now = Date.now) {
    this.now = now;
    this.accountRest = new import_byte_ring.ByteRing(RING_LIMITS.account.ring, RING_LIMITS.account.entry, now);
    this.accountStream = new import_byte_ring.ByteRing(RING_LIMITS.account.ring, RING_LIMITS.account.entry, now);
  }
  now;
  appliances = /* @__PURE__ */ new Map();
  accountRest;
  accountStream;
  /**
   * Record one REST answer: a GET under its appliance's `rest`, a write under its `writes`, a path without appliance
   * under the account.
   *
   * @param record the answer
   */
  rest(record) {
    const haId = haIdOfPath(record.path);
    const key = `${record.method} ${record.path} ${record.status}`;
    if (haId === void 0) {
      this.accountRest.add(key, record);
      return;
    }
    const rings = this.rings(haId);
    (record.method === "GET" ? rings.rest : rings.writes).add(key, record);
  }
  /**
   * Record a sign-in endpoint's answer (device authorization, token) — its status and OAuth code only, never its body.
   *
   * @param path the endpoint path
   * @param status the HTTP status
   * @param code the OAuth error code, when it refused
   */
  token(path, status, code) {
    this.accountRest.add(`POST ${path} ${status} ${code != null ? code : ""}`, {
      method: "POST",
      path,
      status,
      ...code !== void 0 ? { error: code } : {}
    });
  }
  /**
   * Record one stream event under its appliance (the event's `id` is its haId) or under the account.
   *
   * @param event the event as the parser gave it
   */
  stream(event) {
    const data = parsedData(event.data);
    const fromData = typeof data === "object" && data !== null && typeof data.haId === "string" ? data.haId : void 0;
    const haId = fromData != null ? fromData : event.id !== void 0 && event.id.length > 0 ? event.id : void 0;
    const record = { event: event.event, data };
    if (haId === void 0) {
      this.accountStream.add(event.event, record);
      return;
    }
    if (event.event === "DEPAIRED") {
      this.forget(haId);
      return;
    }
    const rings = this.rings(haId);
    rings.stream.add(`${event.event} ${itemKeys(data)}`, record);
    if (CONNECTION_EVENTS.has(event.event)) {
      rings.connection.push({ at: new Date(this.now()).toISOString(), event: event.event });
      if (rings.connection.length > CONNECTION_HISTORY) {
        rings.connection.splice(0, rings.connection.length - CONNECTION_HISTORY);
      }
    }
  }
  /**
   * Record what the event stream itself did — connected, refused, lost.
   *
   * @param what one word (`opened`, `refused`, `lost`)
   * @param detail the reason, when there is one
   */
  streamState(what, detail) {
    this.accountStream.add(`stream ${what} ${detail != null ? detail : ""}`, { event: `stream ${what}`, data: detail != null ? detail : "" });
  }
  /**
   * Forget an appliance that left the account.
   *
   * @param haId the appliance
   */
  forget(haId) {
    this.appliances.delete(haId);
  }
  /**
   * What the rings hold for one appliance — copies, so the report never changes them.
   *
   * @param haId the appliance
   * @returns its trail (empty when nothing was recorded)
   */
  snapshot(haId) {
    var _a, _b, _c;
    const rings = this.appliances.get(haId);
    return {
      rest: (_a = rings == null ? void 0 : rings.rest.snapshot()) != null ? _a : [],
      writes: (_b = rings == null ? void 0 : rings.writes.snapshot()) != null ? _b : [],
      stream: (_c = rings == null ? void 0 : rings.stream.snapshot()) != null ? _c : [],
      connection: rings ? rings.connection.map((change) => ({ ...change })) : []
    };
  }
  /**
   * What the account rings hold.
   *
   * @returns the account trail
   */
  account() {
    return { rest: this.accountRest.snapshot(), stream: this.accountStream.snapshot() };
  }
  /**
   * One appliance's rings, made on first use.
   *
   * @param haId the appliance
   * @returns its rings
   */
  rings(haId) {
    let rings = this.appliances.get(haId);
    if (!rings) {
      rings = {
        rest: new import_byte_ring.ByteRing(RING_LIMITS.rest.ring, RING_LIMITS.rest.entry, this.now),
        writes: new import_byte_ring.ByteRing(RING_LIMITS.writes.ring, RING_LIMITS.writes.entry, this.now),
        stream: new import_byte_ring.ByteRing(RING_LIMITS.stream.ring, RING_LIMITS.stream.entry, this.now),
        connection: []
      };
      this.appliances.set(haId, rings);
    }
    return rings;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CONNECTION_HISTORY,
  RING_LIMITS,
  TrafficRecorder,
  haIdOfPath
});
//# sourceMappingURL=traffic-recorder.js.map
