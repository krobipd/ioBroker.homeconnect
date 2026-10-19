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
var log_ring_exports = {};
__export(log_ring_exports, {
  LOG_RING_SIZE: () => LOG_RING_SIZE,
  LogRing: () => LogRing
});
module.exports = __toCommonJS(log_ring_exports);
const LEVELS = ["silly", "debug", "info", "warn", "error"];
const LOG_RING_SIZE = 2e3;
class LogRing {
  /**
   * @param size how many lines to keep
   * @param now the clock (injectable for tests)
   */
  constructor(size = LOG_RING_SIZE, now = Date.now) {
    this.size = size;
    this.now = now;
  }
  size;
  now;
  lines = [];
  /**
   * Record every line the logger is given, then let it log as before. The logger's own level filter
   * stays untouched — the ring only listens.
   *
   * @param log the adapter logger
   */
  hook(log) {
    for (const level of LEVELS) {
      const original = log[level].bind(log);
      log[level] = (message) => {
        this.add(level, message);
        original(message);
      };
    }
  }
  /**
   * Keep one line.
   *
   * @param level the level
   * @param message the message
   */
  add(level, message) {
    this.lines.push({ ts: new Date(this.now()).toISOString(), level, msg: String(message) });
    if (this.lines.length > this.size) {
      this.lines.splice(0, this.lines.length - this.size);
    }
  }
  /**
   * The lines about one device: those naming it (its id or address) and those naming no other
   * device (adapter-wide lines — discovery, the push receiver, the start).
   *
   * A name counts only as a whole token: `lamp` is not named by `lamp-2: ready`, nor `10.0.0.5`
   * by `10.0.0.50 answered` — a substring match gave a device the lines of every device whose id or
   * address merely starts like its own (review 2026-10-05, B4).
   *
   * @param mentions the strings that name this device (its id, its address)
   * @param others the strings that name the OTHER devices
   * @returns the lines, oldest first
   */
  about(mentions, others) {
    const mine = tokenPattern(mentions);
    const theirs = tokenPattern(others);
    return this.lines.filter((line) => (mine == null ? void 0 : mine.test(line.msg)) === true || (theirs == null ? void 0 : theirs.test(line.msg)) !== true);
  }
}
function tokenPattern(names) {
  const alternatives = names.filter((name) => name.length > 0).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return alternatives.length > 0 ? new RegExp(`(?<![A-Za-z0-9_-])(?:${alternatives.join("|")})(?![A-Za-z0-9_-])`) : void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LOG_RING_SIZE,
  LogRing
});
//# sourceMappingURL=log-ring.js.map
