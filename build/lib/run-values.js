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
var run_values_exports = {};
__export(run_values_exports, {
  isRunValueKey: () => isRunValueKey,
  runValueChannel: () => runValueChannel
});
module.exports = __toCommonJS(run_values_exports);
const STATUS_RUN_VALUES = /* @__PURE__ */ new Set([
  "BSH.Common.Option.CurrentStepRemainingTime",
  "BSH.Common.Option.ElapsedProgramTime",
  "BSH.Common.Option.ElapsedProgramTime.AutoCounting",
  "BSH.Common.Option.EnergyForecast",
  "BSH.Common.Option.EstimatedTotalProgramTime",
  "BSH.Common.Option.ProgramProgress",
  "BSH.Common.Option.RemainingProgramTime",
  "BSH.Common.Option.RemainingProgramTime.AutoCounting",
  "BSH.Common.Option.RemainingProgramTimeEstimationState",
  "BSH.Common.Option.RemainingProgramTimeIsEstimated",
  "BSH.Common.Option.SmartEnergyService.SmartStartEnabled",
  "BSH.Common.Option.WaterForecast",
  "ConsumerProducts.CleaningRobot.Option.ProcessPhase",
  "ConsumerProducts.CoffeeMaker.Option.BeveragesRemaining",
  "ConsumerProducts.CoffeeMaker.Option.Coarsness.Recommendation",
  "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength.Recommendation",
  "ConsumerProducts.CoffeeMaker.Option.CoffeeTemperature.Recommendation",
  "ConsumerProducts.CoffeeMaker.Option.FillQuantity.Recommendation",
  "ConsumerProducts.CoffeeMaker.Option.FlowRate.Recommendation",
  "Cooking.Oven.Option.HeatupProgress",
  "LaundryCare.Common.Option.LoadRecommendation",
  "LaundryCare.Common.Option.ProcessPhase",
  "LaundryCare.Dryer.Option.ConnectedDry.OriginalProgramTime",
  "LaundryCare.Dryer.Option.ProcessPhase",
  "LaundryCare.Washer.Option.ProcessPhase"
]);
const PROGRAM_RUN_VALUES = /* @__PURE__ */ new Set([
  "BSH.Common.Option.BaseProgram",
  "BSH.Common.Option.ProgramName"
]);
function runValueChannel(key) {
  if (STATUS_RUN_VALUES.has(key)) {
    return "status";
  }
  return PROGRAM_RUN_VALUES.has(key) ? "programs" : void 0;
}
function isRunValueKey(key) {
  return runValueChannel(key) !== void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isRunValueKey,
  runValueChannel
});
//# sourceMappingURL=run-values.js.map
