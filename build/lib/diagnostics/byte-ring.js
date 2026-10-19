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
var byte_ring_exports = {};
__export(byte_ring_exports, {
  ByteRing: () => ByteRing,
  sizeOf: () => sizeOf
});
module.exports = __toCommonJS(byte_ring_exports);
function sizeOf(value) {
  var _a;
  return Buffer.byteLength((_a = JSON.stringify(value)) != null ? _a : "", "utf8");
}
class ByteRing {
  /**
   * @param limit the ring's byte limit (R2)
   * @param entryLimit the largest entry kept with its content (R3)
   * @param now the clock (injectable for tests)
   */
  constructor(limit, entryLimit, now = Date.now) {
    this.limit = limit;
    this.entryLimit = entryLimit;
    this.now = now;
  }
  limit;
  entryLimit;
  now;
  entries = /* @__PURE__ */ new Map();
  bytes = 0;
  /**
   * Record one entry under its fold key (R1), then drop whole entries from the oldest end until the ring fits (R3).
   *
   * @param key what makes two entries the same
   * @param content what was seen
   */
  add(key, content) {
    var _a, _b;
    const at = new Date(this.now()).toISOString();
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.bytes -= known.bytes;
    }
    const size = sizeOf(content);
    const entry = {
      first: (_a = known == null ? void 0 : known.entry.first) != null ? _a : at,
      last: at,
      count: ((_b = known == null ? void 0 : known.entry.count) != null ? _b : 0) + 1,
      ...size > this.entryLimit ? { omittedBytes: size } : { content }
    };
    const bytes = sizeOf(entry);
    this.entries.set(key, { entry, bytes });
    this.bytes += bytes;
    for (const [oldest, kept] of this.entries) {
      if (this.bytes <= this.limit || oldest === key) {
        break;
      }
      this.entries.delete(oldest);
      this.bytes -= kept.bytes;
    }
  }
  /**
   * What the ring holds, oldest first — a copy, so the report never changes the ring.
   *
   * @returns the entries
   */
  snapshot() {
    return [...this.entries.values()].map(({ entry }) => ({ ...entry }));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ByteRing,
  sizeOf
});
//# sourceMappingURL=byte-ring.js.map
