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
  "BSH.Common.Option.RemainingProgramTime": {
    fallbackName: "optRemainingProgramTime",
    desc: "remainingProgramTimeDesc"
  },
  "BSH.Common.Option.RemainingProgramTimeIsEstimated": {
    fallbackName: "optRemainingProgramTimeIsEstimated",
    desc: "remainingProgramTimeIsEstimatedDesc"
  },
  "BSH.Common.Option.EstimatedTotalProgramTime": {
    fallbackName: "optEstimatedTotalProgramTime",
    desc: "estimatedTotalProgramTimeDesc"
  },
  "BSH.Common.Option.ProgramProgress": { fallbackName: "optProgramProgress", desc: "programProgressDesc" },
  "BSH.Common.Option.StartInRelative": { fallbackName: "optStartInRelative", desc: "startInRelativeDesc" },
  "BSH.Common.Option.FinishInRelative": { fallbackName: "optFinishInRelative", desc: "finishInRelativeDesc" },
  "BSH.Common.Root.SelectedProgram": { desc: "selectedProgramDesc" },
  "BSH.Common.Root.ActiveProgram": { desc: "activeProgramDesc" },
  "BSH.Common.Command.AcknowledgeEvent": { name: "acknowledgeEvent", desc: "acknowledgeEventDesc" },
  // ─── program options: our own name where the cloud sends none ──────────────
  // The cloud names an option only in a program definition, and those are only
  // fetchable while the appliance is ON. A dishwasher that spends the day
  // switched off would otherwise carry English auto-labels forever.
  // Every appliance type is first-class here, not only the ones we can test with.
  "BSH.Common.Option.BaseProgram": { fallbackName: "optBaseProgram" },
  "BSH.Common.Option.CurrentStepRemainingTime": { fallbackName: "optCurrentStepRemainingTime" },
  "BSH.Common.Option.Duration": { fallbackName: "optDuration" },
  "BSH.Common.Option.ElapsedProgramTime": { fallbackName: "optElapsedProgramTime" },
  "BSH.Common.Option.EnergyForecast": { fallbackName: "optEnergyForecast" },
  "BSH.Common.Option.ProgramName": { fallbackName: "optProgramName" },
  "BSH.Common.Option.RemainingProgramTimeEstimationState": { fallbackName: "optRemainingProgramTimeEstimationState" },
  "BSH.Common.Option.SmartEnergyService.SmartStartEnabled": { fallbackName: "optSmartStartEnabled" },
  "BSH.Common.Option.WaterForecast": { fallbackName: "optWaterForecast" },
  "Dishcare.Dishwasher.Option.BrillianceDry": { fallbackName: "optBrillianceDry" },
  "Dishcare.Dishwasher.Option.DelicateBasket": { fallbackName: "optDelicateBasket" },
  "Dishcare.Dishwasher.Option.EcoDry": { fallbackName: "optEcoDry" },
  "Dishcare.Dishwasher.Option.EnergySafe": { fallbackName: "optEnergySafe" },
  "Dishcare.Dishwasher.Option.ExtraDry": { fallbackName: "optExtraDry" },
  "Dishcare.Dishwasher.Option.ExtraRinse": { fallbackName: "optExtraRinse" },
  "Dishcare.Dishwasher.Option.FixedZone": { fallbackName: "optFixedZone" },
  "Dishcare.Dishwasher.Option.FlexSpray.BackLeft": { fallbackName: "optFlexSprayBackLeft" },
  "Dishcare.Dishwasher.Option.FlexSpray.BackRight": { fallbackName: "optFlexSprayBackRight" },
  "Dishcare.Dishwasher.Option.FlexSpray.FrontLeft": { fallbackName: "optFlexSprayFrontLeft" },
  "Dishcare.Dishwasher.Option.FlexSpray.FrontRight": { fallbackName: "optFlexSprayFrontRight" },
  "Dishcare.Dishwasher.Option.FlexSpray.Type": { fallbackName: "optFlexSprayType" },
  "Dishcare.Dishwasher.Option.HalfLoad": { fallbackName: "optHalfLoad" },
  "Dishcare.Dishwasher.Option.HolidayMode": { fallbackName: "optHolidayMode" },
  "Dishcare.Dishwasher.Option.HygienePlus": { fallbackName: "optHygienePlus" },
  "Dishcare.Dishwasher.Option.IntensivZone": { fallbackName: "optIntensivZone" },
  "Dishcare.Dishwasher.Option.LearningDishwasher.CleaningLevel": { fallbackName: "optLearningCleaningLevel" },
  "Dishcare.Dishwasher.Option.LearningDishwasher.DryingLevel": { fallbackName: "optLearningDryingLevel" },
  "Dishcare.Dishwasher.Option.LearningDishwasher.DurationLevel": { fallbackName: "optLearningDurationLevel" },
  "Dishcare.Dishwasher.Option.Pretreatment": { fallbackName: "optPretreatment" },
  "Dishcare.Dishwasher.Option.SanitationUC": { fallbackName: "optSanitationUC" },
  "Dishcare.Dishwasher.Option.SilenceOnDemand": { fallbackName: "optSilenceOnDemand" },
  "Dishcare.Dishwasher.Option.StorageFunction": { fallbackName: "optStorageFunction" },
  "Dishcare.Dishwasher.Option.Turbo": { fallbackName: "optTurbo" },
  "Dishcare.Dishwasher.Option.VarioSpeed": { fallbackName: "optVarioSpeed" },
  "Dishcare.Dishwasher.Option.VarioSpeedPlus": { fallbackName: "optVarioSpeedPlus" },
  "Dishcare.Dishwasher.Option.ZeoliteDry": { fallbackName: "optZeoliteDry" },
  "LaundryCare.Common.Option.LoadRecommendation": { fallbackName: "optLoadRecommendation" },
  "LaundryCare.Common.Option.LowTemperatureHygiene": { fallbackName: "optLowTemperatureHygiene" },
  "LaundryCare.Common.Option.ProcessPhase": { fallbackName: "optProcessPhase" },
  "LaundryCare.Common.Option.ReferToProgram": { fallbackName: "optReferToProgram" },
  "LaundryCare.Common.Option.SilentMode": { fallbackName: "optSilentMode" },
  "LaundryCare.Common.Option.SpeedPerfect": { fallbackName: "optSpeedPerfect" },
  "LaundryCare.Common.Option.VarioPerfect": { fallbackName: "optVarioPerfect" },
  "LaundryCare.Dryer.Option.ConnectedDry.OriginalProgramTime": { fallbackName: "optOriginalProgramTime" },
  "LaundryCare.Dryer.Option.DryingTarget": { fallbackName: "optDryingTarget" },
  "LaundryCare.Dryer.Option.DryingTargetAdjustment": { fallbackName: "optDryingTargetAdjustment" },
  "LaundryCare.Dryer.Option.Gentle": { fallbackName: "optGentle" },
  "LaundryCare.Dryer.Option.HalfLoad": { fallbackName: "optDryerHalfLoad" },
  "LaundryCare.Dryer.Option.ProcessPhase": { fallbackName: "optDryerProcessPhase" },
  "LaundryCare.Dryer.Option.Refresher": { fallbackName: "optRefresher" },
  "LaundryCare.Dryer.Option.WrinkleGuard": { fallbackName: "optWrinkleGuard" },
  "LaundryCare.Washer.Option.EISA": { fallbackName: "optEisa" },
  "LaundryCare.Washer.Option.IDos1.Active": { fallbackName: "optIDos1ActiveDotted" },
  "LaundryCare.Washer.Option.IDos1Active": { fallbackName: "optIDos1Active" },
  "LaundryCare.Washer.Option.IDos1DosingLevel": { fallbackName: "optIDos1DosingLevel" },
  "LaundryCare.Washer.Option.IDos2.Active": { fallbackName: "optIDos2ActiveDotted" },
  "LaundryCare.Washer.Option.IDos2Active": { fallbackName: "optIDos2Active" },
  "LaundryCare.Washer.Option.IDos2DosingLevel": { fallbackName: "optIDos2DosingLevel" },
  "LaundryCare.Washer.Option.IntensivePlus": { fallbackName: "optIntensivePlus" },
  "LaundryCare.Washer.Option.LessIroning": { fallbackName: "optLessIroning" },
  "LaundryCare.Washer.Option.MiniLoad": { fallbackName: "optMiniLoad" },
  "LaundryCare.Washer.Option.MultipleSoak": { fallbackName: "optMultipleSoak" },
  "LaundryCare.Washer.Option.Prewash": { fallbackName: "optPrewash" },
  "LaundryCare.Washer.Option.ProcessPhase": { fallbackName: "optWasherProcessPhase" },
  "LaundryCare.Washer.Option.RinseHold": { fallbackName: "optRinseHold" },
  "LaundryCare.Washer.Option.RinsePlus": { fallbackName: "optRinsePlus" },
  "LaundryCare.Washer.Option.RinsePlus1": { fallbackName: "optRinsePlus1" },
  "LaundryCare.Washer.Option.SilentWash": { fallbackName: "optSilentWash" },
  "LaundryCare.Washer.Option.Soak": { fallbackName: "optSoak" },
  "LaundryCare.Washer.Option.SpeedPerfect": { fallbackName: "optWasherSpeedPerfect" },
  "LaundryCare.Washer.Option.SpinSpeed": { fallbackName: "optSpinSpeed" },
  "LaundryCare.Washer.Option.Stains": { fallbackName: "optStains" },
  "LaundryCare.Washer.Option.Temperature": { fallbackName: "optWasherTemperature" },
  "LaundryCare.Washer.Option.WaterAndRinsePlus1": { fallbackName: "optWaterAndRinsePlus1" },
  "LaundryCare.Washer.Option.WaterPlus": { fallbackName: "optWaterPlus" },
  "LaundryCare.WasherDryer.Option.DryingTarget": { fallbackName: "optWdDryingTarget" },
  "LaundryCare.WasherDryer.Option.LowTemperatureHygiene": { fallbackName: "optWdLowTemperatureHygiene" },
  "LaundryCare.WasherDryer.Option.ProgramMode": { fallbackName: "optProgramMode" },
  "LaundryCare.WasherDryer.Option.WrinkleGuardBoost": { fallbackName: "optWrinkleGuardBoost" },
  "Cooking.Common.Option.Hood.Boost": { fallbackName: "optHoodBoost" },
  "Cooking.Common.Option.Hood.IntensiveLevel": { fallbackName: "optHoodIntensiveLevel" },
  "Cooking.Common.Option.Hood.VentingLevel": { fallbackName: "optHoodVentingLevel" },
  "Cooking.Oven.Option.AirExchange": { fallbackName: "optAirExchange" },
  "Cooking.Oven.Option.CavitySelector": { fallbackName: "optCavitySelector" },
  "Cooking.Oven.Option.FastPreHeat": { fallbackName: "optFastPreHeat" },
  "Cooking.Oven.Option.HeatupProgress": { fallbackName: "optHeatupProgress" },
  "Cooking.Oven.Option.Level": { fallbackName: "optOvenLevel" },
  "Cooking.Oven.Option.MeatProbeTemperatureV2": { fallbackName: "optMeatProbeTemperature" },
  "Cooking.Oven.Option.MicrowavePower": { fallbackName: "optMicrowavePower" },
  "Cooking.Oven.Option.PyrolysisLevel": { fallbackName: "optPyrolysisLevel" },
  "Cooking.Oven.Option.SetpointTemperature": { fallbackName: "optOvenSetpointTemperature" },
  "Cooking.Oven.Option.SteamAssistLevel": { fallbackName: "optSteamAssistLevel" },
  "Cooking.Oven.Option.SteamBoost": { fallbackName: "optSteamBoost" },
  "Cooking.Oven.Option.WarmingLevel": { fallbackName: "optWarmingLevel" },
  "ConsumerProducts.CoffeeMaker.Option.AromaSelect": { fallbackName: "optAromaSelect" },
  "ConsumerProducts.CoffeeMaker.Option.BeanAmount": { fallbackName: "optBeanAmount" },
  "ConsumerProducts.CoffeeMaker.Option.BeanContainerSelection": { fallbackName: "optBeanContainerSelection" },
  "ConsumerProducts.CoffeeMaker.Option.BeverageSize": { fallbackName: "optBeverageSize" },
  "ConsumerProducts.CoffeeMaker.Option.BeveragesRemaining": { fallbackName: "optBeveragesRemaining" },
  "ConsumerProducts.CoffeeMaker.Option.Coarsness": { fallbackName: "optCoarseness" },
  "ConsumerProducts.CoffeeMaker.Option.Coarsness.Recommendation": { fallbackName: "optCoarsenessRecommendation" },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeMilkRatio": { fallbackName: "optCoffeeMilkRatio" },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength": { fallbackName: "optCoffeeStrength" },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength.Recommendation": {
    fallbackName: "optCoffeeStrengthRecommendation"
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeTemperature": { fallbackName: "optCoffeeTemperature" },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeTemperature.Recommendation": {
    fallbackName: "optCoffeeTemperatureRecommendation"
  },
  "ConsumerProducts.CoffeeMaker.Option.FillQuantity": { fallbackName: "optFillQuantity" },
  "ConsumerProducts.CoffeeMaker.Option.FillQuantity.Recommendation": { fallbackName: "optFillQuantityRecommendation" },
  "ConsumerProducts.CoffeeMaker.Option.FlowRate": { fallbackName: "optFlowRate" },
  "ConsumerProducts.CoffeeMaker.Option.FlowRate.Recommendation": { fallbackName: "optFlowRateRecommendation" },
  "ConsumerProducts.CoffeeMaker.Option.HotWaterTemperature": { fallbackName: "optHotWaterTemperature" },
  "ConsumerProducts.CoffeeMaker.Option.MultipleBeverages": { fallbackName: "optMultipleBeverages" },
  "ConsumerProducts.CoffeeMaker.Option.Shot.Count": { fallbackName: "optShotCount" },
  "ConsumerProducts.CleaningRobot.Option.CarpetBoostEnabled": { fallbackName: "optCarpetBoost" },
  "ConsumerProducts.CleaningRobot.Option.CleaningMode": { fallbackName: "optCleaningMode" },
  "ConsumerProducts.CleaningRobot.Option.CleaningPasses": { fallbackName: "optCleaningPasses" },
  "ConsumerProducts.CleaningRobot.Option.CleaningSpeed": { fallbackName: "optCleaningSpeed" },
  "ConsumerProducts.CleaningRobot.Option.MopExtensionEnabled": { fallbackName: "optMopExtension" },
  "ConsumerProducts.CleaningRobot.Option.ProcessPhase": { fallbackName: "optRobotProcessPhase" },
  "ConsumerProducts.CleaningRobot.Option.ReferenceMapId": { fallbackName: "optReferenceMapId" },
  "ConsumerProducts.CleaningRobot.Option.SuctionPower": { fallbackName: "optSuctionPower" },
  "ConsumerProducts.CleaningRobot.Option.WaterFlowRate": { fallbackName: "optWaterFlowRate" },
  "HeatingVentilationAirConditioning.AirConditioner.Option.FanSpeedMode": { fallbackName: "optFanSpeedMode" },
  "HeatingVentilationAirConditioning.AirConditioner.Option.FanSpeedPercentage": {
    fallbackName: "optFanSpeedPercentage"
  },
  "HeatingVentilationAirConditioning.AirConditioner.Option.SetpointTemperature": {
    fallbackName: "optAcSetpointTemperature"
  }
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
