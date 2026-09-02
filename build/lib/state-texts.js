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
var state_texts_exports = {};
__export(state_texts_exports, {
  STATE_TEXTS: () => STATE_TEXTS,
  stateText: () => stateText
});
module.exports = __toCommonJS(state_texts_exports);
const DESCALING_ADVANCE = "evDescalingAdvanceDesc";
const CALC_N_CLEAN_ADVANCE = "evCalcNCleanAdvanceDesc";
const STATE_TEXTS = {
  // ─── events: common ────────────────────────────────────────────────────────
  "BSH.Common.Event.ProgramFinished": { name: "evProgramFinished", desc: "evProgramFinishedDesc" },
  "BSH.Common.Event.ProgramAborted": { name: "evProgramAborted", desc: "evProgramAbortedDesc" },
  "BSH.Common.Event.AlarmClockElapsed": { name: "evAlarmClockElapsed", desc: "evAlarmClockElapsedDesc" },
  "BSH.Common.Event.Favorite.001.ExternalTrigger": { name: "evFavorite1", desc: "evFavorite1Desc" },
  "BSH.Common.Event.Favorite.002.ExternalTrigger": { name: "evFavorite2", desc: "evFavorite1Desc" },
  // ─── events: dishwasher ────────────────────────────────────────────────────
  "Dishcare.Dishwasher.Event.SaltNearlyEmpty": { name: "evSaltNearlyEmpty", desc: "evSaltNearlyEmptyDesc" },
  "Dishcare.Dishwasher.Event.SaltLack": { name: "evSaltLack", desc: "evSaltLackDesc" },
  "Dishcare.Dishwasher.Event.ProgramBlockedSaltLack": {
    name: "evProgramBlockedSaltLack",
    desc: "evProgramBlockedSaltLackDesc"
  },
  "Dishcare.Dishwasher.Event.RinseAidNearlyEmpty": {
    name: "evRinseAidNearlyEmpty",
    desc: "evRinseAidNearlyEmptyDesc"
  },
  "Dishcare.Dishwasher.Event.RinseAidLack": { name: "evRinseAidLack", desc: "evRinseAidLackDesc" },
  "Dishcare.Dishwasher.Event.MachineCareReminder": {
    name: "evMachineCareReminder",
    desc: "evMachineCareReminderDesc"
  },
  "Dishcare.Dishwasher.Event.MachineCareAndFilterCleaningReminder": {
    name: "evMachineCareAndFilterCleaningReminder",
    desc: "evMachineCareAndFilterCleaningReminderDesc"
  },
  "Dishcare.Dishwasher.Event.MachineCareAndLowMaintenanceFilterCleaningReminder": {
    name: "evMachineCareAndLowMaintenanceFilterCleaningReminder",
    desc: "evMachineCareAndLowMaintenanceFilterCleaningReminderDesc"
  },
  "Dishcare.Dishwasher.Event.SmartFilterCleaningReminder": {
    name: "evSmartFilterCleaningReminder",
    desc: "evSmartFilterCleaningReminderDesc"
  },
  // ─── events: laundry ───────────────────────────────────────────────────────
  "LaundryCare.Washer.Event.IDos1FillLevelPoor": { name: "evIDos1FillLevelPoor", desc: "evIDos1FillLevelPoorDesc" },
  "LaundryCare.Washer.Event.IDos2FillLevelPoor": { name: "evIDos2FillLevelPoor", desc: "evIDos2FillLevelPoorDesc" },
  "LaundryCare.Dryer.Event.DryingProcessFinished": {
    name: "evDryingProcessFinished",
    desc: "evDryingProcessFinishedDesc"
  },
  // ─── events: cleaning robot ────────────────────────────────────────────────
  "ConsumerProducts.CleaningRobot.Event.EmptyDustBoxAndCleanFilter": {
    name: "evEmptyDustBoxAndCleanFilter",
    desc: "evEmptyDustBoxAndCleanFilterDesc"
  },
  "ConsumerProducts.CleaningRobot.Event.RobotIsStuck": { name: "evRobotIsStuck", desc: "evRobotIsStuckDesc" },
  "ConsumerProducts.CleaningRobot.Event.DockingStationNotFound": {
    name: "evDockingStationNotFound",
    desc: "evDockingStationNotFoundDesc"
  },
  "ConsumerProducts.CleaningRobot.Event.DustBin.NotInstalled": {
    name: "evDustBinNotInstalled",
    desc: "evDustBinNotInstalledDesc"
  },
  "ConsumerProducts.CleaningRobot.Event.Robot.Lifted": { name: "evRobotLifted", desc: "evRobotLiftedDesc" },
  // ─── events: coffee maker ──────────────────────────────────────────────────
  "ConsumerProducts.CoffeeMaker.Event.BeanContainerEmpty": {
    name: "evBeanContainerEmpty",
    desc: "evBeanContainerEmptyDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.WaterTankEmpty": { name: "evWaterTankEmpty", desc: "evWaterTankEmptyDesc" },
  "ConsumerProducts.CoffeeMaker.Event.DripTrayFull": { name: "evDripTrayFull", desc: "evDripTrayFullDesc" },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn20Cups": { name: "evDescalingIn20Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn15Cups": { name: "evDescalingIn15Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn10Cups": { name: "evDescalingIn10Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn5Cups": { name: "evDescalingIn5Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeDescaled": {
    name: "evDeviceShouldBeDescaled",
    desc: "evDeviceShouldBeDescaledDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingOverdue": {
    name: "evDeviceDescalingOverdue",
    desc: "evDeviceDescalingOverdueDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingBlockage": {
    name: "evDeviceDescalingBlockage",
    desc: "evDeviceDescalingBlockageDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCleaned": {
    name: "evDeviceShouldBeCleaned",
    desc: "evDeviceShouldBeCleanedDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCleaningOverdue": {
    name: "evDeviceCleaningOverdue",
    desc: "evDeviceCleaningOverdueDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn20Cups": {
    name: "evCalcNCleanIn20Cups",
    desc: CALC_N_CLEAN_ADVANCE
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn15Cups": {
    name: "evCalcNCleanIn15Cups",
    desc: CALC_N_CLEAN_ADVANCE
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn10Cups": {
    name: "evCalcNCleanIn10Cups",
    desc: CALC_N_CLEAN_ADVANCE
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn5Cups": { name: "evCalcNCleanIn5Cups", desc: CALC_N_CLEAN_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCalcNCleaned": {
    name: "evDeviceShouldBeCalcNCleaned",
    desc: "evDeviceShouldBeCalcNCleanedDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanOverdue": {
    name: "evDeviceCalcNCleanOverdue",
    desc: "evDeviceCalcNCleanOverdueDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanBlockage": {
    name: "evDeviceCalcNCleanBlockage",
    desc: "evDeviceCalcNCleanBlockageDesc"
  },
  "ConsumerProducts.CoffeeMaker.Event.KeepMilkTankCool": { name: "evKeepMilkTankCool", desc: "evKeepMilkTankCoolDesc" },
  // ─── events: cooking ───────────────────────────────────────────────────────
  "Cooking.Oven.Event.PreheatFinished": { name: "evPreheatFinished", desc: "evPreheatFinishedDesc" },
  "Cooking.Oven.Event.RegularPreheatFinished": {
    name: "evRegularPreheatFinished",
    desc: "evRegularPreheatFinishedDesc"
  },
  "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationNearlyReached": {
    name: "evGreaseFilterNearlySaturated",
    desc: "evGreaseFilterNearlySaturatedDesc"
  },
  "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationReached": {
    name: "evGreaseFilterSaturated",
    desc: "evGreaseFilterSaturatedDesc"
  },
  // ─── events: refrigeration ─────────────────────────────────────────────────
  "Refrigeration.FridgeFreezer.Event.DoorAlarmFreezer": { name: "evDoorAlarmFreezer", desc: "evDoorAlarmFreezerDesc" },
  "Refrigeration.FridgeFreezer.Event.DoorAlarmRefrigerator": {
    name: "evDoorAlarmRefrigerator",
    desc: "evDoorAlarmRefrigeratorDesc"
  },
  "Refrigeration.FridgeFreezer.Event.TemperatureAlarmFreezer": {
    name: "evTemperatureAlarmFreezer",
    desc: "evTemperatureAlarmFreezerDesc"
  },
  // ─── explanations only: the cloud names these itself ───────────────────────
  "BSH.Common.Status.OperationState": { desc: "operationStateDesc" },
  "BSH.Common.Status.RemoteControlActive": { desc: "remoteControlActiveDesc" },
  "BSH.Common.Status.RemoteControlStartAllowed": { desc: "remoteControlStartAllowedDesc" },
  "BSH.Common.Status.LocalControlActive": { desc: "localControlActiveDesc" },
  "BSH.Common.Status.InteriorIlluminationActive": { desc: "interiorIlluminationActiveDesc" },
  "BSH.Common.Setting.PowerState": { desc: "powerStateDesc" },
  "BSH.Common.Setting.ChildLock": { desc: "childLockDesc" },
  "BSH.Common.Option.RemainingProgramTime": { desc: "remainingProgramTimeDesc" },
  "BSH.Common.Option.RemainingProgramTimeIsEstimated": { desc: "remainingProgramTimeIsEstimatedDesc" },
  "BSH.Common.Option.EstimatedTotalProgramTime": { desc: "estimatedTotalProgramTimeDesc" },
  "BSH.Common.Option.ProgramProgress": { desc: "programProgressDesc" },
  "BSH.Common.Option.StartInRelative": { desc: "startInRelativeDesc" },
  "BSH.Common.Option.FinishInRelative": { desc: "finishInRelativeDesc" },
  "BSH.Common.Root.SelectedProgram": { desc: "selectedProgramDesc" },
  "BSH.Common.Root.ActiveProgram": { desc: "activeProgramDesc" },
  "BSH.Common.Command.AcknowledgeEvent": { name: "acknowledgeEvent", desc: "acknowledgeEventDesc" }
};
function stateText(key) {
  return STATE_TEXTS[key];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  STATE_TEXTS,
  stateText
});
//# sourceMappingURL=state-texts.js.map
