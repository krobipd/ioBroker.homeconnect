// The adapter's own texts for the datapoints it knows: a readable name where
// Home Connect delivers none (the catalog events never appear in a REST answer),
// and a short plain-language description for every datapoint whose meaning is
// the same on every appliance.
//
// Fleet rule (krobi 2026-09-02): the description is an explanation a user can
// read, never the manufacturer's key. A datapoint the adapter cannot explain —
// an option only one appliance family has — keeps its cloud name and gets no
// description at all; an invented sentence would be worse than none.
//
// Every appliance type is first-class here, not only the ones we can test with.

import type { I18nKey } from "./i18n";

/** The texts for one BSH key: our own name (events) and the explanation. */
export interface StateText {
  /** Translation key for `common.name` — set where the cloud never sends a name. */
  name?: I18nKey;
  /**
   * Translation key for `common.name` used ONLY when the cloud sent no name of
   * its own. Unlike {@link name} it never overrides the cloud: the localized
   * text of the appliance stays first choice. It replaces the English label
   * `humanizeId` would derive from the key — which is what an appliance that
   * has been switched off since the tree was built ends up with, because its
   * program definitions (and with them the option names) were never fetched.
   */
  fallbackName?: I18nKey;
  /** Translation key for `common.desc`. */
  desc?: I18nKey;
}

const DESCALING_ADVANCE: I18nKey = "evDescalingAdvanceDesc";
const CALC_N_CLEAN_ADVANCE: I18nKey = "evCalcNCleanAdvanceDesc";

/**
 * BSH key → the adapter's texts. Events carry a name of their own, everything
 * else only a description (the cloud names those itself, localized).
 */
export const STATE_TEXTS: Readonly<Record<string, StateText>> = {
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
    desc: "evProgramBlockedSaltLackDesc",
  },
  "Dishcare.Dishwasher.Event.RinseAidNearlyEmpty": {
    name: "evRinseAidNearlyEmpty",
    desc: "evRinseAidNearlyEmptyDesc",
  },
  "Dishcare.Dishwasher.Event.RinseAidLack": { name: "evRinseAidLack", desc: "evRinseAidLackDesc" },
  "Dishcare.Dishwasher.Event.MachineCareReminder": {
    name: "evMachineCareReminder",
    desc: "evMachineCareReminderDesc",
  },
  "Dishcare.Dishwasher.Event.MachineCareAndFilterCleaningReminder": {
    name: "evMachineCareAndFilterCleaningReminder",
    desc: "evMachineCareAndFilterCleaningReminderDesc",
  },
  "Dishcare.Dishwasher.Event.MachineCareAndLowMaintenanceFilterCleaningReminder": {
    name: "evMachineCareAndLowMaintenanceFilterCleaningReminder",
    desc: "evMachineCareAndLowMaintenanceFilterCleaningReminderDesc",
  },
  "Dishcare.Dishwasher.Event.SmartFilterCleaningReminder": {
    name: "evSmartFilterCleaningReminder",
    desc: "evSmartFilterCleaningReminderDesc",
  },
  // ─── events: laundry ───────────────────────────────────────────────────────
  "LaundryCare.Washer.Event.IDos1FillLevelPoor": { name: "evIDos1FillLevelPoor", desc: "evIDos1FillLevelPoorDesc" },
  "LaundryCare.Washer.Event.IDos2FillLevelPoor": { name: "evIDos2FillLevelPoor", desc: "evIDos2FillLevelPoorDesc" },
  "LaundryCare.Dryer.Event.DryingProcessFinished": {
    name: "evDryingProcessFinished",
    desc: "evDryingProcessFinishedDesc",
  },
  // ─── events: cleaning robot ────────────────────────────────────────────────
  "ConsumerProducts.CleaningRobot.Event.EmptyDustBoxAndCleanFilter": {
    name: "evEmptyDustBoxAndCleanFilter",
    desc: "evEmptyDustBoxAndCleanFilterDesc",
  },
  "ConsumerProducts.CleaningRobot.Event.RobotIsStuck": { name: "evRobotIsStuck", desc: "evRobotIsStuckDesc" },
  "ConsumerProducts.CleaningRobot.Event.DockingStationNotFound": {
    name: "evDockingStationNotFound",
    desc: "evDockingStationNotFoundDesc",
  },
  "ConsumerProducts.CleaningRobot.Event.DustBin.NotInstalled": {
    name: "evDustBinNotInstalled",
    desc: "evDustBinNotInstalledDesc",
  },
  "ConsumerProducts.CleaningRobot.Event.Robot.Lifted": { name: "evRobotLifted", desc: "evRobotLiftedDesc" },
  // ─── events: coffee maker ──────────────────────────────────────────────────
  "ConsumerProducts.CoffeeMaker.Event.BeanContainerEmpty": {
    name: "evBeanContainerEmpty",
    desc: "evBeanContainerEmptyDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.WaterTankEmpty": { name: "evWaterTankEmpty", desc: "evWaterTankEmptyDesc" },
  "ConsumerProducts.CoffeeMaker.Event.DripTrayFull": { name: "evDripTrayFull", desc: "evDripTrayFullDesc" },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn20Cups": { name: "evDescalingIn20Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn15Cups": { name: "evDescalingIn15Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn10Cups": { name: "evDescalingIn10Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DescalingIn5Cups": { name: "evDescalingIn5Cups", desc: DESCALING_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeDescaled": {
    name: "evDeviceShouldBeDescaled",
    desc: "evDeviceShouldBeDescaledDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingOverdue": {
    name: "evDeviceDescalingOverdue",
    desc: "evDeviceDescalingOverdueDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingBlockage": {
    name: "evDeviceDescalingBlockage",
    desc: "evDeviceDescalingBlockageDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCleaned": {
    name: "evDeviceShouldBeCleaned",
    desc: "evDeviceShouldBeCleanedDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCleaningOverdue": {
    name: "evDeviceCleaningOverdue",
    desc: "evDeviceCleaningOverdueDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn20Cups": {
    name: "evCalcNCleanIn20Cups",
    desc: CALC_N_CLEAN_ADVANCE,
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn15Cups": {
    name: "evCalcNCleanIn15Cups",
    desc: CALC_N_CLEAN_ADVANCE,
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn10Cups": {
    name: "evCalcNCleanIn10Cups",
    desc: CALC_N_CLEAN_ADVANCE,
  },
  "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn5Cups": { name: "evCalcNCleanIn5Cups", desc: CALC_N_CLEAN_ADVANCE },
  "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCalcNCleaned": {
    name: "evDeviceShouldBeCalcNCleaned",
    desc: "evDeviceShouldBeCalcNCleanedDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanOverdue": {
    name: "evDeviceCalcNCleanOverdue",
    desc: "evDeviceCalcNCleanOverdueDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanBlockage": {
    name: "evDeviceCalcNCleanBlockage",
    desc: "evDeviceCalcNCleanBlockageDesc",
  },
  "ConsumerProducts.CoffeeMaker.Event.KeepMilkTankCool": { name: "evKeepMilkTankCool", desc: "evKeepMilkTankCoolDesc" },
  // ─── events: cooking ───────────────────────────────────────────────────────
  "Cooking.Oven.Event.PreheatFinished": { name: "evPreheatFinished", desc: "evPreheatFinishedDesc" },
  "Cooking.Oven.Event.RegularPreheatFinished": {
    name: "evRegularPreheatFinished",
    desc: "evRegularPreheatFinishedDesc",
  },
  "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationNearlyReached": {
    name: "evGreaseFilterNearlySaturated",
    desc: "evGreaseFilterNearlySaturatedDesc",
  },
  "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationReached": {
    name: "evGreaseFilterSaturated",
    desc: "evGreaseFilterSaturatedDesc",
  },
  // ─── events: refrigeration ─────────────────────────────────────────────────
  "Refrigeration.FridgeFreezer.Event.DoorAlarmFreezer": { name: "evDoorAlarmFreezer", desc: "evDoorAlarmFreezerDesc" },
  "Refrigeration.FridgeFreezer.Event.DoorAlarmRefrigerator": {
    name: "evDoorAlarmRefrigerator",
    desc: "evDoorAlarmRefrigeratorDesc",
  },
  "Refrigeration.FridgeFreezer.Event.TemperatureAlarmFreezer": {
    name: "evTemperatureAlarmFreezer",
    desc: "evTemperatureAlarmFreezerDesc",
  },
  // ─── explanations only: the cloud names these itself ───────────────────────
  "BSH.Common.Status.OperationState": { fallbackName: "stOperationState", desc: "operationStateDesc" },
  "BSH.Common.Status.RemoteControlActive": { fallbackName: "stRemoteControlActive", desc: "remoteControlActiveDesc" },
  "BSH.Common.Status.RemoteControlStartAllowed": {
    fallbackName: "stRemoteStartAllowed",
    desc: "remoteControlStartAllowedDesc",
  },
  "BSH.Common.Status.LocalControlActive": { fallbackName: "stLocalControlActive", desc: "localControlActiveDesc" },
  "BSH.Common.Status.InteriorIlluminationActive": {
    fallbackName: "stInteriorIlluminationActive",
    desc: "interiorIlluminationActiveDesc",
  },
  "BSH.Common.Setting.PowerState": { fallbackName: "setPowerState", desc: "powerStateDesc" },
  "BSH.Common.Setting.ChildLock": { fallbackName: "setChildLock", desc: "childLockDesc" },
  "BSH.Common.Option.RemainingProgramTime": {
    fallbackName: "optRemainingProgramTime",
    desc: "remainingProgramTimeDesc",
  },
  "BSH.Common.Option.RemainingProgramTimeIsEstimated": {
    fallbackName: "optRemainingProgramTimeIsEstimated",
    desc: "remainingProgramTimeIsEstimatedDesc",
  },
  "BSH.Common.Option.EstimatedTotalProgramTime": {
    fallbackName: "optEstimatedTotalProgramTime",
    desc: "estimatedTotalProgramTimeDesc",
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
  "BSH.Common.Option.BaseProgram": { fallbackName: "optBaseProgram", desc: "baseProgramDesc" },
  "BSH.Common.Option.CurrentStepRemainingTime": {
    fallbackName: "optCurrentStepRemainingTime",
    desc: "currentStepRemainingTimeDesc",
  },
  "BSH.Common.Option.Duration": { fallbackName: "optDuration", desc: "durationOptionDesc" },
  "BSH.Common.Option.ElapsedProgramTime": { fallbackName: "optElapsedProgramTime", desc: "elapsedProgramTimeDesc" },
  "BSH.Common.Option.EnergyForecast": { fallbackName: "optEnergyForecast", desc: "energyForecastDesc" },
  "BSH.Common.Option.ProgramName": { fallbackName: "optProgramName", desc: "programNameDesc" },
  "BSH.Common.Option.RemainingProgramTimeEstimationState": {
    fallbackName: "optRemainingProgramTimeEstimationState",
    desc: "remainingProgramTimeEstimationStateDesc",
  },
  "BSH.Common.Option.SmartEnergyService.SmartStartEnabled": {
    fallbackName: "optSmartStartEnabled",
    desc: "smartEnergyServiceSmartStartEnabledDesc",
  },
  "BSH.Common.Option.WaterForecast": { fallbackName: "optWaterForecast", desc: "waterForecastDesc" },
  "Dishcare.Dishwasher.Option.BrillianceDry": { fallbackName: "optBrillianceDry", desc: "brillianceDryDesc" },
  "Dishcare.Dishwasher.Option.DelicateBasket": { fallbackName: "optDelicateBasket", desc: "delicateBasketDesc" },
  "Dishcare.Dishwasher.Option.EcoDry": { fallbackName: "optEcoDry", desc: "ecoDryDesc" },
  "Dishcare.Dishwasher.Option.EnergySafe": { fallbackName: "optEnergySafe", desc: "energySafeDesc" },
  "Dishcare.Dishwasher.Option.ExtraDry": { fallbackName: "optExtraDry", desc: "extraDryDesc" },
  "Dishcare.Dishwasher.Option.ExtraRinse": { fallbackName: "optExtraRinse", desc: "extraRinseDesc" },
  "Dishcare.Dishwasher.Option.FixedZone": { fallbackName: "optFixedZone", desc: "fixedZoneDesc" },
  "Dishcare.Dishwasher.Option.FlexSpray.BackLeft": {
    fallbackName: "optFlexSprayBackLeft",
    desc: "flexSprayBackLeftDesc",
  },
  "Dishcare.Dishwasher.Option.FlexSpray.BackRight": {
    fallbackName: "optFlexSprayBackRight",
    desc: "flexSprayBackRightDesc",
  },
  "Dishcare.Dishwasher.Option.FlexSpray.FrontLeft": {
    fallbackName: "optFlexSprayFrontLeft",
    desc: "flexSprayFrontLeftDesc",
  },
  "Dishcare.Dishwasher.Option.FlexSpray.FrontRight": {
    fallbackName: "optFlexSprayFrontRight",
    desc: "flexSprayFrontRightDesc",
  },
  "Dishcare.Dishwasher.Option.FlexSpray.Type": { fallbackName: "optFlexSprayType", desc: "flexSprayTypeDesc" },
  "Dishcare.Dishwasher.Option.HalfLoad": { fallbackName: "optHalfLoad", desc: "halfLoadDesc" },
  "Dishcare.Dishwasher.Option.HolidayMode": { fallbackName: "optHolidayMode", desc: "holidayModeDesc" },
  "Dishcare.Dishwasher.Option.HygienePlus": { fallbackName: "optHygienePlus", desc: "hygienePlusDesc" },
  "Dishcare.Dishwasher.Option.IntensivZone": { fallbackName: "optIntensivZone", desc: "intensivZoneDesc" },
  "Dishcare.Dishwasher.Option.LearningDishwasher.CleaningLevel": {
    fallbackName: "optLearningCleaningLevel",
    desc: "learningDishwasherCleaningLevelDesc",
  },
  "Dishcare.Dishwasher.Option.LearningDishwasher.DryingLevel": {
    fallbackName: "optLearningDryingLevel",
    desc: "learningDishwasherDryingLevelDesc",
  },
  "Dishcare.Dishwasher.Option.LearningDishwasher.DurationLevel": {
    fallbackName: "optLearningDurationLevel",
    desc: "learningDishwasherDurationLevelDesc",
  },
  "Dishcare.Dishwasher.Option.Pretreatment": { fallbackName: "optPretreatment", desc: "pretreatmentDesc" },
  "Dishcare.Dishwasher.Option.SanitationUC": { fallbackName: "optSanitationUC", desc: "sanitationUCDesc" },
  "Dishcare.Dishwasher.Option.SilenceOnDemand": { fallbackName: "optSilenceOnDemand", desc: "silenceOnDemandDesc" },
  "Dishcare.Dishwasher.Option.StorageFunction": { fallbackName: "optStorageFunction", desc: "storageFunctionDesc" },
  "Dishcare.Dishwasher.Option.Turbo": { fallbackName: "optTurbo", desc: "turboDesc" },
  "Dishcare.Dishwasher.Option.VarioSpeed": { fallbackName: "optVarioSpeed", desc: "varioSpeedDesc" },
  "Dishcare.Dishwasher.Option.VarioSpeedPlus": { fallbackName: "optVarioSpeedPlus", desc: "varioSpeedPlusDesc" },
  "Dishcare.Dishwasher.Option.ZeoliteDry": { fallbackName: "optZeoliteDry", desc: "zeoliteDryDesc" },
  "LaundryCare.Common.Option.LoadRecommendation": {
    fallbackName: "optLoadRecommendation",
    desc: "loadRecommendationDesc",
  },
  "LaundryCare.Common.Option.LowTemperatureHygiene": {
    fallbackName: "optLowTemperatureHygiene",
    desc: "lowTemperatureHygieneDesc",
  },
  "LaundryCare.Common.Option.ProcessPhase": { fallbackName: "optProcessPhase" },
  "LaundryCare.Common.Option.ReferToProgram": { fallbackName: "optReferToProgram" },
  "LaundryCare.Common.Option.SilentMode": { fallbackName: "optSilentMode", desc: "silentModeDesc" },
  "LaundryCare.Common.Option.SpeedPerfect": { fallbackName: "optSpeedPerfect", desc: "speedPerfectDesc" },
  "LaundryCare.Common.Option.VarioPerfect": { fallbackName: "optVarioPerfect", desc: "varioPerfectDesc" },
  "LaundryCare.Dryer.Option.ConnectedDry.OriginalProgramTime": {
    fallbackName: "optOriginalProgramTime",
    desc: "connectedDryOriginalProgramTimeDesc",
  },
  "LaundryCare.Dryer.Option.DryingTarget": { fallbackName: "optDryingTarget", desc: "dryingTargetDesc" },
  "LaundryCare.Dryer.Option.DryingTargetAdjustment": {
    fallbackName: "optDryingTargetAdjustment",
    desc: "dryingTargetAdjustmentDesc",
  },
  "LaundryCare.Dryer.Option.Gentle": { fallbackName: "optGentle", desc: "gentleDesc" },
  "LaundryCare.Dryer.Option.HalfLoad": { fallbackName: "optDryerHalfLoad", desc: "dryerHalfLoadDesc" },
  "LaundryCare.Dryer.Option.ProcessPhase": { fallbackName: "optDryerProcessPhase", desc: "processPhaseDesc" },
  "LaundryCare.Dryer.Option.Refresher": { fallbackName: "optRefresher", desc: "refresherDesc" },
  "LaundryCare.Dryer.Option.WrinkleGuard": { fallbackName: "optWrinkleGuard", desc: "wrinkleGuardDesc" },
  "LaundryCare.Washer.Option.EISA": { fallbackName: "optEisa", desc: "eISADesc" },
  "LaundryCare.Washer.Option.IDos1.Active": { fallbackName: "optIDos1ActiveDotted" },
  "LaundryCare.Washer.Option.IDos1Active": { fallbackName: "optIDos1Active", desc: "iDos1ActiveDesc" },
  "LaundryCare.Washer.Option.IDos1DosingLevel": { fallbackName: "optIDos1DosingLevel", desc: "iDos1DosingLevelDesc" },
  "LaundryCare.Washer.Option.IDos2.Active": { fallbackName: "optIDos2ActiveDotted" },
  "LaundryCare.Washer.Option.IDos2Active": { fallbackName: "optIDos2Active", desc: "iDos2ActiveDesc" },
  "LaundryCare.Washer.Option.IDos2DosingLevel": { fallbackName: "optIDos2DosingLevel", desc: "iDos2DosingLevelDesc" },
  "LaundryCare.Washer.Option.IntensivePlus": { fallbackName: "optIntensivePlus", desc: "intensivePlusDesc" },
  "LaundryCare.Washer.Option.LessIroning": { fallbackName: "optLessIroning", desc: "lessIroningDesc" },
  "LaundryCare.Washer.Option.MiniLoad": { fallbackName: "optMiniLoad", desc: "miniLoadDesc" },
  "LaundryCare.Washer.Option.MultipleSoak": { fallbackName: "optMultipleSoak", desc: "multipleSoakDesc" },
  "LaundryCare.Washer.Option.Prewash": { fallbackName: "optPrewash", desc: "prewashDesc" },
  "LaundryCare.Washer.Option.ProcessPhase": { fallbackName: "optWasherProcessPhase", desc: "processPhaseDesc" },
  "LaundryCare.Washer.Option.RinseHold": { fallbackName: "optRinseHold", desc: "rinseHoldDesc" },
  "LaundryCare.Washer.Option.RinsePlus": { fallbackName: "optRinsePlus", desc: "rinsePlusDesc" },
  "LaundryCare.Washer.Option.RinsePlus1": { fallbackName: "optRinsePlus1", desc: "rinsePlus1Desc" },
  "LaundryCare.Washer.Option.SilentWash": { fallbackName: "optSilentWash", desc: "silentWashDesc" },
  "LaundryCare.Washer.Option.Soak": { fallbackName: "optSoak", desc: "soakDesc" },
  "LaundryCare.Washer.Option.SpeedPerfect": { fallbackName: "optWasherSpeedPerfect" },
  "LaundryCare.Washer.Option.SpinSpeed": { fallbackName: "optSpinSpeed", desc: "spinSpeedDesc" },
  "LaundryCare.Washer.Option.Stains": { fallbackName: "optStains", desc: "stainsDesc" },
  "LaundryCare.Washer.Option.Temperature": { fallbackName: "optWasherTemperature", desc: "washerTemperatureDesc" },
  "LaundryCare.Washer.Option.WaterAndRinsePlus1": {
    fallbackName: "optWaterAndRinsePlus1",
    desc: "waterAndRinsePlus1Desc",
  },
  "LaundryCare.Washer.Option.WaterPlus": { fallbackName: "optWaterPlus", desc: "waterPlusDesc" },
  "LaundryCare.WasherDryer.Option.DryingTarget": { fallbackName: "optWdDryingTarget" },
  "LaundryCare.WasherDryer.Option.LowTemperatureHygiene": { fallbackName: "optWdLowTemperatureHygiene" },
  "LaundryCare.WasherDryer.Option.ProgramMode": { fallbackName: "optProgramMode", desc: "programModeDesc" },
  "LaundryCare.WasherDryer.Option.WrinkleGuardBoost": {
    fallbackName: "optWrinkleGuardBoost",
    desc: "wrinkleGuardBoostDesc",
  },
  "Cooking.Common.Option.Hood.Boost": { fallbackName: "optHoodBoost", desc: "hoodBoostDesc" },
  "Cooking.Common.Option.Hood.IntensiveLevel": {
    fallbackName: "optHoodIntensiveLevel",
    desc: "hoodIntensiveLevelDesc",
  },
  "Cooking.Common.Option.Hood.VentingLevel": { fallbackName: "optHoodVentingLevel", desc: "hoodVentingLevelDesc" },
  "Cooking.Oven.Option.AirExchange": { fallbackName: "optAirExchange", desc: "airExchangeDesc" },
  "Cooking.Oven.Option.CavitySelector": { fallbackName: "optCavitySelector", desc: "cavitySelectorDesc" },
  "Cooking.Oven.Option.FastPreHeat": { fallbackName: "optFastPreHeat", desc: "fastPreHeatDesc" },
  "Cooking.Oven.Option.HeatupProgress": { fallbackName: "optHeatupProgress", desc: "heatupProgressDesc" },
  "Cooking.Oven.Option.Level": { fallbackName: "optOvenLevel", desc: "levelDesc" },
  "Cooking.Oven.Option.MeatProbeTemperatureV2": {
    fallbackName: "optMeatProbeTemperature",
    desc: "meatProbeTemperatureV2Desc",
  },
  "Cooking.Oven.Option.MicrowavePower": { fallbackName: "optMicrowavePower", desc: "microwavePowerDesc" },
  "Cooking.Oven.Option.PyrolysisLevel": { fallbackName: "optPyrolysisLevel", desc: "pyrolysisLevelDesc" },
  "Cooking.Oven.Option.SetpointTemperature": {
    fallbackName: "optOvenSetpointTemperature",
    desc: "setpointTemperatureDesc",
  },
  "Cooking.Oven.Option.SteamAssistLevel": { fallbackName: "optSteamAssistLevel", desc: "steamAssistLevelDesc" },
  "Cooking.Oven.Option.SteamBoost": { fallbackName: "optSteamBoost", desc: "steamBoostDesc" },
  "Cooking.Oven.Option.WarmingLevel": { fallbackName: "optWarmingLevel", desc: "warmingLevelDesc" },
  "ConsumerProducts.CoffeeMaker.Option.AromaSelect": { fallbackName: "optAromaSelect", desc: "aromaSelectDesc" },
  "ConsumerProducts.CoffeeMaker.Option.BeanAmount": { fallbackName: "optBeanAmount", desc: "beanAmountDesc" },
  "ConsumerProducts.CoffeeMaker.Option.BeanContainerSelection": {
    fallbackName: "optBeanContainerSelection",
    desc: "beanContainerSelectionDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.BeverageSize": { fallbackName: "optBeverageSize", desc: "beverageSizeDesc" },
  "ConsumerProducts.CoffeeMaker.Option.BeveragesRemaining": {
    fallbackName: "optBeveragesRemaining",
    desc: "beveragesRemainingDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.Coarsness": { fallbackName: "optCoarseness", desc: "coarsnessDesc" },
  "ConsumerProducts.CoffeeMaker.Option.Coarsness.Recommendation": {
    fallbackName: "optCoarsenessRecommendation",
    desc: "coarsnessRecommendationDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeMilkRatio": {
    fallbackName: "optCoffeeMilkRatio",
    desc: "coffeeMilkRatioDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength": {
    fallbackName: "optCoffeeStrength",
    desc: "coffeeStrengthDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength.Recommendation": {
    fallbackName: "optCoffeeStrengthRecommendation",
    desc: "coffeeStrengthRecommendationDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeTemperature": {
    fallbackName: "optCoffeeTemperature",
    desc: "coffeeTemperatureDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.CoffeeTemperature.Recommendation": {
    fallbackName: "optCoffeeTemperatureRecommendation",
    desc: "coffeeTemperatureRecommendationDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.FillQuantity": { fallbackName: "optFillQuantity", desc: "fillQuantityDesc" },
  "ConsumerProducts.CoffeeMaker.Option.FillQuantity.Recommendation": {
    fallbackName: "optFillQuantityRecommendation",
    desc: "fillQuantityRecommendationDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.FlowRate": { fallbackName: "optFlowRate", desc: "flowRateDesc" },
  "ConsumerProducts.CoffeeMaker.Option.FlowRate.Recommendation": {
    fallbackName: "optFlowRateRecommendation",
    desc: "flowRateRecommendationDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.HotWaterTemperature": {
    fallbackName: "optHotWaterTemperature",
    desc: "hotWaterTemperatureDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.MultipleBeverages": {
    fallbackName: "optMultipleBeverages",
    desc: "multipleBeveragesDesc",
  },
  "ConsumerProducts.CoffeeMaker.Option.Shot.Count": { fallbackName: "optShotCount", desc: "shotCountDesc" },
  "ConsumerProducts.CleaningRobot.Option.CarpetBoostEnabled": {
    fallbackName: "optCarpetBoost",
    desc: "carpetBoostEnabledDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.CleaningMode": { fallbackName: "optCleaningMode", desc: "cleaningModeDesc" },
  "ConsumerProducts.CleaningRobot.Option.CleaningPasses": {
    fallbackName: "optCleaningPasses",
    desc: "cleaningPassesDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.CleaningSpeed": {
    fallbackName: "optCleaningSpeed",
    desc: "cleaningSpeedDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.MopExtensionEnabled": {
    fallbackName: "optMopExtension",
    desc: "mopExtensionEnabledDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.ProcessPhase": {
    fallbackName: "optRobotProcessPhase",
    desc: "processPhaseDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.ReferenceMapId": {
    fallbackName: "optReferenceMapId",
    desc: "referenceMapIdDesc",
  },
  "ConsumerProducts.CleaningRobot.Option.SuctionPower": { fallbackName: "optSuctionPower", desc: "suctionPowerDesc" },
  "ConsumerProducts.CleaningRobot.Option.WaterFlowRate": {
    fallbackName: "optWaterFlowRate",
    desc: "waterFlowRateDesc",
  },
  "HeatingVentilationAirConditioning.AirConditioner.Option.FanSpeedMode": { fallbackName: "optFanSpeedMode" },
  "HeatingVentilationAirConditioning.AirConditioner.Option.FanSpeedPercentage": {
    fallbackName: "optFanSpeedPercentage",
  },
  "HeatingVentilationAirConditioning.AirConditioner.Option.SetpointTemperature": {
    fallbackName: "optAcSetpointTemperature",
  },

  // ─── status / settings / commands the cloud never names ───────────────────
  // Home Connect sends a localized `name` with program definitions only, so a
  // status or setting of an appliance that is switched off would end up with the
  // English label humanizeId derives from the key — in every language. These are
  // FALLBACK names: a cloud text still wins whenever the appliance delivers one.
  // Keys taken verbatim from the type source (Ressourcen/homeconnect/upstream-refs).
  "BSH.Common.Command.OpenDoor": { fallbackName: "cmdOpenDoor", desc: "cmdOpenDoorDesc" },
  "BSH.Common.Command.PartlyOpenDoor": { fallbackName: "cmdPartlyOpenDoor", desc: "cmdPartlyOpenDoorDesc" },
  "BSH.Common.Command.PauseProgram": { fallbackName: "cmdPauseProgram", desc: "cmdPauseProgramDesc" },
  "BSH.Common.Command.ResumeProgram": { fallbackName: "cmdResumeProgram", desc: "cmdResumeProgramDesc" },
  "BSH.Common.Option.ElapsedProgramTime.AutoCounting": {
    fallbackName: "optElapsedAutoCounting",
    desc: "optElapsedAutoCountingDesc",
  },
  "BSH.Common.Option.RemainingProgramTime.AutoCounting": {
    fallbackName: "optRemainingAutoCounting",
    desc: "optRemainingAutoCountingDesc",
  },
  "BSH.Common.Setting.AlarmClock": { fallbackName: "setAlarmClock", desc: "setAlarmClockDesc" },
  "BSH.Common.Setting.AmbientLightBrightness": {
    fallbackName: "setAmbientLightBrightness",
    desc: "ambientLightBrightnessDesc",
  },
  "BSH.Common.Setting.AmbientLightColor": { fallbackName: "setAmbientLightColor", desc: "ambientLightColorDesc" },
  "BSH.Common.Setting.AmbientLightCustomColor": {
    fallbackName: "setAmbientLightCustomColor",
    desc: "setAmbientLightCustomColorDesc",
  },
  "BSH.Common.Setting.AmbientLightEnabled": { fallbackName: "setAmbientLightEnabled", desc: "ambientLightEnabledDesc" },
  "BSH.Common.Setting.LiquidVolumeUnit": { fallbackName: "setLiquidVolumeUnit", desc: "setLiquidVolumeUnitDesc" },
  "BSH.Common.Setting.TemperatureUnit": { fallbackName: "setTemperatureUnit", desc: "setTemperatureUnitDesc" },
  "BSH.Common.Status.BatteryChargingState": {
    fallbackName: "stBatteryChargingState",
    desc: "stBatteryChargingStateDesc",
  },
  "BSH.Common.Status.BatteryLevel": { fallbackName: "stBatteryLevel", desc: "batteryLevelDesc" },
  "BSH.Common.Status.ChargingConnection": { fallbackName: "stChargingConnection", desc: "stChargingConnectionDesc" },
  "BSH.Common.Status.Video.CameraState": { fallbackName: "stCameraState", desc: "videoCameraStateDesc" },
  "ConsumerProducts.CleaningRobot.Setting.CurrentMap": { fallbackName: "setCurrentMap", desc: "setCurrentMapDesc" },
  "ConsumerProducts.CleaningRobot.Setting.NameOfMap1": { fallbackName: "setNameOfMap1", desc: "setNameOfMap1Desc" },
  "ConsumerProducts.CleaningRobot.Setting.NameOfMap2": { fallbackName: "setNameOfMap2", desc: "setNameOfMap2Desc" },
  "ConsumerProducts.CleaningRobot.Setting.NameOfMap3": { fallbackName: "setNameOfMap3", desc: "setNameOfMap3Desc" },
  "ConsumerProducts.CleaningRobot.Setting.NameOfMap4": { fallbackName: "setNameOfMap4", desc: "setNameOfMap4Desc" },
  "ConsumerProducts.CleaningRobot.Setting.NameOfMap5": { fallbackName: "setNameOfMap5", desc: "setNameOfMap5Desc" },
  "ConsumerProducts.CleaningRobot.Status.DustBoxInserted": {
    fallbackName: "stDustBoxInserted",
    desc: "dustBoxInsertedDesc",
  },
  "ConsumerProducts.CleaningRobot.Status.LastSelectedMap": {
    fallbackName: "stLastSelectedMap",
    desc: "lastSelectedMapDesc",
  },
  "ConsumerProducts.CleaningRobot.Status.Lifted": { fallbackName: "stRobotLifted", desc: "liftedDesc" },
  "ConsumerProducts.CleaningRobot.Status.Lost": { fallbackName: "stRobotLost", desc: "stRobotLostDesc" },
  "ConsumerProducts.CoffeeMaker.Setting.CupWarmer": { fallbackName: "setCupWarmer", desc: "cupWarmerDesc" },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterCoffee": {
    fallbackName: "stCounterCoffee",
    desc: "stCounterCoffeeDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterCoffeeAndMilk": {
    fallbackName: "stCounterCoffeeAndMilk",
    desc: "stCounterCoffeeAndMilkDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterFrothyMilk": {
    fallbackName: "stCounterFrothyMilk",
    desc: "stCounterFrothyMilkDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterHotMilk": {
    fallbackName: "stCounterHotMilk",
    desc: "stCounterHotMilkDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterHotWater": {
    fallbackName: "stCounterHotWater",
    desc: "stCounterHotWaterDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterHotWaterCups": {
    fallbackName: "stCounterHotWaterCups",
    desc: "stCounterHotWaterCupsDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterMilk": {
    fallbackName: "stCounterMilk",
    desc: "stCounterMilkDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterPowderCoffee": {
    fallbackName: "stCounterPowderCoffee",
    desc: "stCounterPowderCoffeeDesc",
  },
  "ConsumerProducts.CoffeeMaker.Status.BeverageCounterRistrettoEspresso": {
    fallbackName: "stCounterRistrettoEspresso",
    desc: "stCounterRistrettoEspressoDesc",
  },
  "Cooking.Common.Setting.Lighting": { fallbackName: "setCookingLighting", desc: "lightingDesc" },
  "Cooking.Common.Setting.LightingBrightness": {
    fallbackName: "setCookingLightingBrightness",
    desc: "lightingBrightnessDesc",
  },
  "Cooking.Hob.Setting.Ventilation": { fallbackName: "setHobVentilation", desc: "setHobVentilationDesc" },
  "Cooking.Hood.Setting.ColorTemperature": { fallbackName: "setHoodColorTemperature", desc: "colorTemperatureDesc" },
  "Cooking.Hood.Setting.ColorTemperaturePercent": {
    fallbackName: "setHoodColorTemperaturePercent",
    desc: "setHoodColorTemperaturePercentDesc",
  },
  "Cooking.Oven.Setting.SabbathMode": { fallbackName: "setOvenSabbathMode", desc: "setOvenSabbathModeDesc" },
  "Cooking.Oven.Status.CurrentCavityTemperature": {
    fallbackName: "stCavityTemperature",
    desc: "currentCavityTemperatureDesc",
  },
  "LaundryCare.Washer.Setting.IDos1BaseLevel": { fallbackName: "setIDos1BaseLevel", desc: "setIDos1BaseLevelDesc" },
  "LaundryCare.Washer.Setting.IDos2BaseLevel": { fallbackName: "setIDos2BaseLevel", desc: "setIDos2BaseLevelDesc" },
  "Refrigeration.Common.Setting.BottleCooler.SetpointTemperature": {
    fallbackName: "setTempBottleCooler",
    desc: "setTempBottleCoolerDesc",
  },
  "Refrigeration.Common.Setting.ChillerCommon.SetpointTemperature": {
    fallbackName: "setTempChiller",
    desc: "setTempChillerDesc",
  },
  "Refrigeration.Common.Setting.ChillerLeft.SetpointTemperature": {
    fallbackName: "setTempChillerLeft",
    desc: "setTempChillerLeftDesc",
  },
  "Refrigeration.Common.Setting.ChillerRight.SetpointTemperature": {
    fallbackName: "setTempChillerRight",
    desc: "setTempChillerRightDesc",
  },
  "Refrigeration.Common.Setting.Dispenser.Enabled": {
    fallbackName: "setDispenserEnabled",
    desc: "dispenserEnabledDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantForceFreezer": {
    fallbackName: "setDoorAssistantForceFreezer",
    desc: "setDoorAssistantForceFreezerDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantForceFridge": {
    fallbackName: "setDoorAssistantForceFridge",
    desc: "setDoorAssistantForceFridgeDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantFreezer": {
    fallbackName: "setDoorAssistantFreezer",
    desc: "setDoorAssistantFreezerDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantFridge": {
    fallbackName: "setDoorAssistantFridge",
    desc: "setDoorAssistantFridgeDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantTimeoutFreezer": {
    fallbackName: "setDoorAssistantTimeoutFreezer",
    desc: "setDoorAssistantTimeoutFreezerDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantTimeoutFridge": {
    fallbackName: "setDoorAssistantTimeoutFridge",
    desc: "setDoorAssistantTimeoutFridgeDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantTriggerFreezer": {
    fallbackName: "setDoorAssistantTriggerFreezer",
    desc: "setDoorAssistantTriggerFreezerDesc",
  },
  "Refrigeration.Common.Setting.Door.AssistantTriggerFridge": {
    fallbackName: "setDoorAssistantTriggerFridge",
    desc: "setDoorAssistantTriggerFridgeDesc",
  },
  "Refrigeration.Common.Setting.EcoMode": { fallbackName: "setEcoMode", desc: "setEcoModeDesc" },
  "Refrigeration.Common.Setting.FreshMode": { fallbackName: "setFreshMode", desc: "setFreshModeDesc" },
  "Refrigeration.Common.Setting.Light.External.Brightness": {
    fallbackName: "setLightExternalBrightness",
    desc: "lightExternalBrightnessDesc",
  },
  "Refrigeration.Common.Setting.Light.External.Power": {
    fallbackName: "setLightExternalPower",
    desc: "lightExternalPowerDesc",
  },
  "Refrigeration.Common.Setting.Light.Internal.Brightness": {
    fallbackName: "setLightInternalBrightness",
    desc: "lightInternalBrightnessDesc",
  },
  "Refrigeration.Common.Setting.Light.Internal.Power": {
    fallbackName: "setLightInternalPower",
    desc: "lightInternalPowerDesc",
  },
  "Refrigeration.Common.Setting.SabbathMode": {
    fallbackName: "setFridgeSabbathMode",
    desc: "setFridgeSabbathModeDesc",
  },
  "Refrigeration.Common.Setting.VacationMode": { fallbackName: "setVacationMode", desc: "setVacationModeDesc" },
  "Refrigeration.Common.Setting.WineCompartment.SetpointTemperature": {
    fallbackName: "setTempWineCompartment",
    desc: "setTempWineCompartmentDesc",
  },
  "Refrigeration.Common.Setting.WineCompartment2.SetpointTemperature": {
    fallbackName: "setTempWineCompartment2",
    desc: "setTempWineCompartment2Desc",
  },
  "Refrigeration.Common.Setting.WineCompartment3.SetpointTemperature": {
    fallbackName: "setTempWineCompartment3",
    desc: "setTempWineCompartment3Desc",
  },
  "Refrigeration.FridgeFreezer.Setting.SetpointTemperatureFreezer": {
    fallbackName: "setTempFreezer",
    desc: "setTempFreezerDesc",
  },
  "Refrigeration.FridgeFreezer.Setting.SetpointTemperatureRefrigerator": {
    fallbackName: "setTempRefrigerator",
    desc: "setTempRefrigeratorDesc",
  },
  "Refrigeration.FridgeFreezer.Setting.SuperModeFreezer": {
    fallbackName: "setSuperModeFreezer",
    desc: "setSuperModeFreezerDesc",
  },
  "Refrigeration.FridgeFreezer.Setting.SuperModeRefrigerator": {
    fallbackName: "setSuperModeRefrigerator",
    desc: "setSuperModeRefrigeratorDesc",
  },
};

/**
 * The adapter's texts for a BSH key.
 *
 * @param key the fully-qualified BSH key
 * @returns the texts, or undefined when the adapter has nothing to say about it
 */
export function stateText(key: string): StateText | undefined {
  return STATE_TEXTS[key];
}
