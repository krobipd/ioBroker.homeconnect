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
var tree_layout_exports = {};
__export(tree_layout_exports, {
  layoutChannel: () => layoutChannel
});
module.exports = __toCommonJS(tree_layout_exports);
const RUN_IDS = /* @__PURE__ */ new Set([
  "remainingProgramTime",
  "remainingProgramTimeAutoCounting",
  "remainingProgramTimeIsEstimated",
  "remainingProgramTimeEstimationState",
  "elapsedProgramTime",
  "elapsedProgramTimeAutoCounting",
  "estimatedTotalProgramTime",
  "currentStepRemainingTime",
  "programProgress",
  "processPhase",
  "programPhase",
  "heatupProgress",
  "energyForecast",
  "waterForecast",
  "loadRecommendation",
  "fillQuantityRecommendation",
  "flowRateRecommendation",
  "coarsnessRecommendation",
  "coffeeStrengthRecommendation",
  "coffeeTemperatureRecommendation",
  "connectedDryOriginalProgramTime",
  "ecoDryActive"
]);
const COUNTER_IDS = /* @__PURE__ */ new Set(["detergentAllConsumed", "softenerAllConsumed"]);
function layoutChannel(channel, id) {
  if (channel !== "status") {
    return channel;
  }
  if (RUN_IDS.has(id)) {
    return "run";
  }
  if (COUNTER_IDS.has(id) || id.startsWith("programAll") || id.startsWith("beverageCounter")) {
    return "counters";
  }
  return channel;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  layoutChannel
});
//# sourceMappingURL=tree-layout.js.map
