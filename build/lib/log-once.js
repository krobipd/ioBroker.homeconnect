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
var log_once_exports = {};
__export(log_once_exports, {
  LogOnce: () => LogOnce
});
module.exports = __toCommonJS(log_once_exports);
class LogOnce {
  /**
   * @param log the adapter logger
   * @param options window, memory cap and clock
   */
  constructor(log, options = {}) {
    this.log = log;
    this.options = options;
  }
  log;
  options;
  seen = /* @__PURE__ */ new Map();
  /**
   * Logs `text` loud the first time `key` reports this kind (or again once the window has passed), on debug otherwise.
   *
   * @param key what the problem belongs to — a device, a channel, an endpoint
   * @param text the line
   * @param report kind and level
   * @returns true when the line went out loud
   */
  report(key, text, report = {}) {
    var _a, _b, _c;
    const now = ((_a = this.options.now) != null ? _a : Date.now)();
    const kind = (_b = report.kind) != null ? _b : text;
    const last = this.seen.get(key);
    const window = this.options.windowMs;
    if (last && last.kind === kind && (window === void 0 || now - last.at < window)) {
      this.log.debug(text);
      return false;
    }
    this.seen.delete(key);
    if (this.options.maxKeys !== void 0 && this.seen.size >= this.options.maxKeys) {
      for (const oldest of this.seen.keys()) {
        this.seen.delete(oldest);
        break;
      }
    }
    this.seen.set(key, { kind, at: now });
    this.log[(_c = report.level) != null ? _c : "warn"](text);
    return true;
  }
  /**
   * The problem of `key` went away: one info line when it was reported loud, debug otherwise; the key starts anew.
   *
   * @param key the key a report used
   * @param text the line
   * @returns true when the info line went out
   */
  recovered(key, text) {
    const last = this.seen.get(key);
    this.seen.delete(key);
    if (last) {
      this.log.info(text);
      return true;
    }
    this.log.debug(text);
    return false;
  }
  /**
   * Drops `key` without a line — the caller logs what happened instead.
   *
   * @param key the key a report used
   */
  forget(key) {
    this.seen.delete(key);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LogOnce
});
//# sourceMappingURL=log-once.js.map
