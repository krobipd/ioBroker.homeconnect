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
var device_catalog_exports = {};
__export(device_catalog_exports, {
  EVENT_CATALOG: () => EVENT_CATALOG,
  LOCKABLE_DOOR_TYPES: () => LOCKABLE_DOOR_TYPES,
  PROGRAMLESS_TYPES: () => PROGRAMLESS_TYPES,
  eventKeysForType: () => eventKeysForType
});
module.exports = __toCommonJS(device_catalog_exports);
const PROGRAM_FINISHED = "BSH.Common.Event.ProgramFinished";
const PROGRAM_ABORTED = "BSH.Common.Event.ProgramAborted";
const ALARM_CLOCK_ELAPSED = "BSH.Common.Event.AlarmClockElapsed";
const FAVORITE_1 = "BSH.Common.Event.Favorite.001.ExternalTrigger";
const FAVORITE_2 = "BSH.Common.Event.Favorite.002.ExternalTrigger";
const EVENT_CATALOG = {
  Dishwasher: [
    PROGRAM_FINISHED,
    PROGRAM_ABORTED,
    "Dishcare.Dishwasher.Event.SaltNearlyEmpty",
    "Dishcare.Dishwasher.Event.SaltLack",
    "Dishcare.Dishwasher.Event.ProgramBlockedSaltLack",
    "Dishcare.Dishwasher.Event.RinseAidNearlyEmpty",
    "Dishcare.Dishwasher.Event.RinseAidLack",
    "Dishcare.Dishwasher.Event.MachineCareReminder",
    "Dishcare.Dishwasher.Event.MachineCareAndFilterCleaningReminder",
    "Dishcare.Dishwasher.Event.MachineCareAndLowMaintenanceFilterCleaningReminder",
    "Dishcare.Dishwasher.Event.SmartFilterCleaningReminder"
  ],
  Washer: [
    PROGRAM_FINISHED,
    PROGRAM_ABORTED,
    "LaundryCare.Washer.Event.IDos1FillLevelPoor",
    "LaundryCare.Washer.Event.IDos2FillLevelPoor"
  ],
  Dryer: [PROGRAM_FINISHED, PROGRAM_ABORTED, "LaundryCare.Dryer.Event.DryingProcessFinished"],
  WasherDryer: [
    PROGRAM_FINISHED,
    PROGRAM_ABORTED,
    "LaundryCare.Washer.Event.IDos1FillLevelPoor",
    "LaundryCare.Washer.Event.IDos2FillLevelPoor",
    "LaundryCare.Dryer.Event.DryingProcessFinished"
  ],
  CleaningRobot: [
    PROGRAM_FINISHED,
    PROGRAM_ABORTED,
    "ConsumerProducts.CleaningRobot.Event.EmptyDustBoxAndCleanFilter",
    "ConsumerProducts.CleaningRobot.Event.RobotIsStuck",
    "ConsumerProducts.CleaningRobot.Event.DockingStationNotFound",
    "ConsumerProducts.CleaningRobot.Event.DustBin.NotInstalled",
    "ConsumerProducts.CleaningRobot.Event.Robot.Lifted"
  ],
  CoffeeMaker: [
    "ConsumerProducts.CoffeeMaker.Event.BeanContainerEmpty",
    "ConsumerProducts.CoffeeMaker.Event.WaterTankEmpty",
    "ConsumerProducts.CoffeeMaker.Event.DripTrayFull",
    "ConsumerProducts.CoffeeMaker.Event.DescalingIn20Cups",
    "ConsumerProducts.CoffeeMaker.Event.DescalingIn15Cups",
    "ConsumerProducts.CoffeeMaker.Event.DescalingIn10Cups",
    "ConsumerProducts.CoffeeMaker.Event.DescalingIn5Cups",
    "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeDescaled",
    "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingOverdue",
    "ConsumerProducts.CoffeeMaker.Event.DeviceDescalingBlockage",
    "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCleaned",
    "ConsumerProducts.CoffeeMaker.Event.DeviceCleaningOverdue",
    "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn20Cups",
    "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn15Cups",
    "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn10Cups",
    "ConsumerProducts.CoffeeMaker.Event.CalcNCleanIn5Cups",
    "ConsumerProducts.CoffeeMaker.Event.DeviceShouldBeCalcNCleaned",
    "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanOverdue",
    "ConsumerProducts.CoffeeMaker.Event.DeviceCalcNCleanBlockage",
    "ConsumerProducts.CoffeeMaker.Event.KeepMilkTankCool"
  ],
  Oven: [
    PROGRAM_FINISHED,
    PROGRAM_ABORTED,
    ALARM_CLOCK_ELAPSED,
    "Cooking.Oven.Event.PreheatFinished",
    "Cooking.Oven.Event.RegularPreheatFinished"
  ],
  Microwave: [PROGRAM_FINISHED, PROGRAM_ABORTED],
  // No ProgramAborted on a hob — verified against the class registrations.
  Hob: [PROGRAM_FINISHED, ALARM_CLOCK_ELAPSED, "Cooking.Oven.Event.PreheatFinished", FAVORITE_1, FAVORITE_2],
  Hood: [
    PROGRAM_FINISHED,
    "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationNearlyReached",
    "Cooking.Common.Event.Hood.GreaseFilterMaxSaturationReached",
    FAVORITE_1,
    FAVORITE_2
  ],
  CookProcessor: [PROGRAM_FINISHED, PROGRAM_ABORTED],
  WarmingDrawer: [],
  FridgeFreezer: [
    "Refrigeration.FridgeFreezer.Event.DoorAlarmFreezer",
    "Refrigeration.FridgeFreezer.Event.DoorAlarmRefrigerator",
    "Refrigeration.FridgeFreezer.Event.TemperatureAlarmFreezer"
  ],
  Freezer: [
    "Refrigeration.FridgeFreezer.Event.DoorAlarmFreezer",
    "Refrigeration.FridgeFreezer.Event.TemperatureAlarmFreezer"
  ],
  Refrigerator: ["Refrigeration.FridgeFreezer.Event.DoorAlarmRefrigerator"],
  WineCooler: [],
  AirConditioner: []
};
function eventKeysForType(haType) {
  return haType && EVENT_CATALOG[haType] || [];
}
const LOCKABLE_DOOR_TYPES = /* @__PURE__ */ new Set([
  "Oven",
  "Microwave",
  "Washer",
  "Dryer",
  "WasherDryer"
]);
const PROGRAMLESS_TYPES = /* @__PURE__ */ new Set([
  "Freezer",
  "FridgeFreezer",
  "Refrigerator",
  "WineCooler",
  "AirConditioner"
]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EVENT_CATALOG,
  LOCKABLE_DOOR_TYPES,
  PROGRAMLESS_TYPES,
  eventKeysForType
});
//# sourceMappingURL=device-catalog.js.map
