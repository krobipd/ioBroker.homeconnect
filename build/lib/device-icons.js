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
var device_icons_exports = {};
__export(device_icons_exports, {
  ICON_BY_TYPE: () => ICON_BY_TYPE,
  deviceIcon: () => deviceIcon
});
module.exports = __toCommonJS(device_icons_exports);
const ICON_BY_TYPE = {
  AirConditioner: "airconditioner.svg",
  CleaningRobot: "cleaningrobot.svg",
  CoffeeMaker: "coffeemaker.svg",
  CookProcessor: "cookprocessor.svg",
  Dishwasher: "dishwasher.svg",
  Dryer: "dryer.svg",
  Freezer: "freezer.svg",
  FridgeFreezer: "fridgefreezer.svg",
  Hob: "hob.svg",
  Hood: "hood.svg",
  Microwave: "microwave.svg",
  Oven: "oven.svg",
  Refrigerator: "refrigerator.svg",
  WarmingDrawer: "warmingdrawer.svg",
  Washer: "washer.svg",
  WasherDryer: "washerdryer.svg",
  WineCooler: "winecooler.svg"
};
function deviceIcon(type) {
  if (type === void 0 || !Object.hasOwn(ICON_BY_TYPE, type)) {
    return void 0;
  }
  return `/icons/${ICON_BY_TYPE[type]}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ICON_BY_TYPE,
  deviceIcon
});
//# sourceMappingURL=device-icons.js.map
