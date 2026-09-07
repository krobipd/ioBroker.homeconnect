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
var log_dedup_exports = {};
__export(log_dedup_exports, {
  LogDedup: () => LogDedup,
  categorize: () => categorize
});
module.exports = __toCommonJS(log_dedup_exports);
function categorize(status) {
  if (status === 0) {
    return "net";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    return "rate";
  }
  if (status >= 500) {
    return "http-5xx";
  }
  if (status >= 400) {
    return "http-4xx";
  }
  return "other";
}
class LogDedup {
  last = /* @__PURE__ */ new Map();
  /**
   * Record a failure and get the level to log it at.
   *
   * @param source a stable per-call-site key (e.g. "GET /status")
   * @param category the failure category ({@link categorize})
   * @returns "warn" for a new category at this source, "debug" for a repeat
   */
  note(source, category) {
    const level = this.last.get(source) === category ? "debug" : "warn";
    this.last.set(source, category);
    return level;
  }
  /**
   * Clear a source after a success. The next failure for it warns again.
   *
   * @param source the source key
   * @returns true if the source had been in a failing state (worth a recovery log)
   */
  recovered(source) {
    return this.last.delete(source);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LogDedup,
  categorize
});
//# sourceMappingURL=log-dedup.js.map
