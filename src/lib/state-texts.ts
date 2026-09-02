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
  /** Translation key for `common.desc`. */
  desc: I18nKey;
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
  "BSH.Common.Command.AcknowledgeEvent": { name: "acknowledgeEvent", desc: "acknowledgeEventDesc" },
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
