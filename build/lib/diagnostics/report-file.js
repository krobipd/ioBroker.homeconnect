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
var report_file_exports = {};
__export(report_file_exports, {
  REPORT_README: () => REPORT_README,
  reportFileName: () => reportFileName,
  reportFrame: () => reportFrame
});
module.exports = __toCommonJS(report_file_exports);
const REPORT_README = "Diagnostics report for a GitHub issue. Placeholders (address-1, name-1, \u2026) are stable inside this file only.";
function reportFileName(adapter, deviceId, version, now) {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "");
  const id = deviceId.replace(/…/g, "").replace(/[^a-z0-9-]+/gi, "_") || "device";
  return `${adapter}_${id}_v${version}_${day}_${time}.json`;
}
function reportFrame(adapter, version, now, connected) {
  return {
    readMe: REPORT_README,
    adapter: `iobroker.${adapter}`,
    version,
    exportedAt: now.toISOString(),
    runtime: { node: process.version, platform: `${process.platform} ${process.arch}` },
    connected
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  REPORT_README,
  reportFileName,
  reportFrame
});
//# sourceMappingURL=report-file.js.map
