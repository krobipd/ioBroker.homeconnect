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
var request_budget_exports = {};
__export(request_budget_exports, {
  BUDGET_WINDOW_MS: () => BUDGET_WINDOW_MS,
  readSentTimes: () => readSentTimes,
  writeSentTimes: () => writeSentTimes
});
module.exports = __toCommonJS(request_budget_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_pure_helpers = require("./pure-helpers");
const BUDGET_WINDOW_MS = 6e4;
function readSentTimes(file, now) {
  let data;
  try {
    data = JSON.parse((0, import_node_fs.readFileSync)(file, "utf8"));
  } catch {
    return [];
  }
  const list = (0, import_pure_helpers.isRecord)(data) && Array.isArray(data.sentAt) ? data.sentAt : [];
  return list.filter((t) => typeof t === "number" && Number.isFinite(t) && t <= now && now - t < BUDGET_WINDOW_MS).sort((a, b) => a - b);
}
function writeSentTimes(file, sentAt, now) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(file), { recursive: true });
  (0, import_node_fs.writeFileSync)(file, JSON.stringify({ sentAt: sentAt.filter((t) => now - t < BUDGET_WINDOW_MS) }));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUDGET_WINDOW_MS,
  readSentTimes,
  writeSentTimes
});
//# sourceMappingURL=request-budget.js.map
