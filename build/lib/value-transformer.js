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
var value_transformer_exports = {};
__export(value_transformer_exports, {
  shortEnum: () => shortEnum,
  stateIdForKey: () => stateIdForKey,
  transformItem: () => transformItem
});
module.exports = __toCommonJS(value_transformer_exports);
const EVENT_PRESENT = "BSH.Common.EnumType.EventPresentState.Present";
const KIND_TO_CHANNEL = {
  Status: "status",
  Setting: "settings",
  Event: "events",
  Option: "options",
  Command: "commands",
  Root: "programs"
};
const ENUM_STATES = {
  OperationState: {
    inactive: "Inactive",
    ready: "Ready",
    delayedstart: "Delayed start",
    run: "Running",
    pause: "Paused",
    actionrequired: "Action required",
    finished: "Finished",
    error: "Error",
    aborting: "Aborting"
  },
  PowerState: { mainsoff: "Mains off", off: "Off", on: "On", standby: "Standby", undefined: "Undefined" }
};
function shortEnum(bshValue) {
  var _a;
  const parts = bshValue.split(".");
  const tail = (_a = parts[parts.length - 1]) != null ? _a : bshValue;
  return tail.toLowerCase();
}
function lowerFirst(s) {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function stateIdForKey(key) {
  var _a, _b, _c;
  const parts = key.split(".");
  const name = (_a = parts[parts.length - 1]) != null ? _a : key;
  const kind = parts.length >= 2 ? (_b = parts[parts.length - 2]) != null ? _b : "" : "";
  const channel = (_c = KIND_TO_CHANNEL[kind]) != null ? _c : "misc";
  return { channel, id: lowerFirst(name) };
}
function transformItem(item) {
  const { channel, id } = stateIdForKey(item.key);
  const { common, value } = transformValue(item);
  return { channel, id, common, value };
}
function transformValue(item) {
  var _a, _b, _c;
  const { key, value } = item;
  const name = stateIdForKey(key).id;
  if (key.includes(".Event.")) {
    return { common: booleanCommon(name, "indicator.alarm"), value: value === EVENT_PRESENT };
  }
  if (typeof value === "number") {
    const common = { name, type: "number", role: "value", read: true, write: false };
    if (item.unit) {
      common.unit = item.unit;
    }
    if (typeof ((_a = item.constraints) == null ? void 0 : _a.min) === "number") {
      common.min = item.constraints.min;
    }
    if (typeof ((_b = item.constraints) == null ? void 0 : _b.max) === "number") {
      common.max = item.constraints.max;
    }
    return { common, value };
  }
  if (typeof value === "boolean") {
    return { common: booleanCommon(name, "indicator"), value };
  }
  if (typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."))) {
    const short = shortEnum(value);
    const enumType = (_c = value.split(".EnumType.")[1]) == null ? void 0 : _c.split(".")[0];
    const common = { name, type: "string", role: "text", read: true, write: false };
    if (enumType && ENUM_STATES[enumType]) {
      common.states = ENUM_STATES[enumType];
    }
    return { common, value: short };
  }
  return {
    common: { name, type: "string", role: "text", read: true, write: false },
    value: typeof value === "string" ? value : JSON.stringify(value)
  };
}
function booleanCommon(name, role) {
  return { name, type: "boolean", role, read: true, write: false, def: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  shortEnum,
  stateIdForKey,
  transformItem
});
//# sourceMappingURL=value-transformer.js.map
