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
  transformItem: () => transformItem,
  transformOptionDefinition: () => transformOptionDefinition
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
  const { common, value, bshValues } = transformValue(item);
  return { channel, id, common, value, bshValues };
}
function transformOptionDefinition(opt) {
  var _a;
  const { channel, id } = stateIdForKey(opt.key);
  const name = opt.name && opt.name.length > 0 ? opt.name : id;
  const c = opt.constraints;
  if (opt.type === "Boolean") {
    const common2 = { name, type: "boolean", role: "switch", read: true, write: true, def: false };
    return { channel, id, common: common2, value: (c == null ? void 0 : c.default) === true };
  }
  if (opt.type === "Int" || opt.type === "Double") {
    const common2 = { name, type: "number", role: "level", read: true, write: true };
    if (opt.unit) {
      common2.unit = opt.unit;
    }
    if (typeof (c == null ? void 0 : c.min) === "number") {
      common2.min = c.min;
    }
    if (typeof (c == null ? void 0 : c.max) === "number") {
      common2.max = c.max;
    }
    const value2 = typeof (c == null ? void 0 : c.default) === "number" ? c.default : typeof (c == null ? void 0 : c.min) === "number" ? c.min : 0;
    return { channel, id, common: common2, value: value2 };
  }
  const allowed = (_a = c == null ? void 0 : c.allowedvalues) == null ? void 0 : _a.filter((v) => v.length > 0);
  const common = { name, type: "string", role: "text", read: true, write: true };
  let bshValues;
  if (allowed && allowed.length > 0) {
    common.states = allowedStates(allowed, c == null ? void 0 : c.displayvalues);
    bshValues = allowed;
  }
  const value = typeof (c == null ? void 0 : c.default) === "string" ? shortEnum(c.default) : "";
  return { channel, id, common, value, bshValues };
}
function allowedStates(allowed, displayvalues) {
  const states = {};
  allowed.forEach((v, i) => {
    const label = displayvalues == null ? void 0 : displayvalues[i];
    states[shortEnum(v)] = typeof label === "string" && label.length > 0 ? label : shortEnum(v);
  });
  return states;
}
function isWritable(key) {
  const { channel, id } = stateIdForKey(key);
  return channel === "settings" || channel === "programs" && id === "selectedProgram";
}
function transformValue(item) {
  var _a, _b, _c, _d, _e;
  const { key, value } = item;
  const name = stateIdForKey(key).id;
  const writable = isWritable(key);
  const allowed = (_b = (_a = item.constraints) == null ? void 0 : _a.allowedvalues) == null ? void 0 : _b.filter((v) => v.length > 0);
  if (key.includes(".Event.")) {
    return { common: booleanCommon(name, "indicator.alarm", false), value: value === EVENT_PRESENT };
  }
  if (typeof value === "number") {
    const common = {
      name,
      type: "number",
      role: writable ? "level" : "value",
      read: true,
      write: writable
    };
    if (item.unit) {
      common.unit = item.unit;
    }
    if (typeof ((_c = item.constraints) == null ? void 0 : _c.min) === "number") {
      common.min = item.constraints.min;
    }
    if (typeof ((_d = item.constraints) == null ? void 0 : _d.max) === "number") {
      common.max = item.constraints.max;
    }
    return { common, value };
  }
  if (typeof value === "boolean") {
    return { common: booleanCommon(name, writable ? "switch" : "indicator", writable), value };
  }
  const isEnumString = typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."));
  if (isEnumString || allowed && allowed.length > 0) {
    const short = typeof value === "string" && value.length > 0 ? shortEnum(value) : "";
    const common = { name, type: "string", role: "text", read: true, write: writable };
    const enumType = typeof value === "string" ? (_e = value.split(".EnumType.")[1]) == null ? void 0 : _e.split(".")[0] : void 0;
    if (enumType && ENUM_STATES[enumType]) {
      common.states = ENUM_STATES[enumType];
    } else if (allowed && allowed.length > 0) {
      common.states = Object.fromEntries(allowed.map((v) => [shortEnum(v), shortEnum(v)]));
    }
    const bshValues = writable ? allowed && allowed.length > 0 ? allowed : short.length > 0 ? [value] : void 0 : void 0;
    return { common, value: short, bshValues };
  }
  return {
    common: { name, type: "string", role: "text", read: true, write: writable },
    value: typeof value === "string" ? value : JSON.stringify(value)
  };
}
function booleanCommon(name, role, writable) {
  return { name, type: "boolean", role, read: true, write: writable, def: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  shortEnum,
  stateIdForKey,
  transformItem,
  transformOptionDefinition
});
//# sourceMappingURL=value-transformer.js.map
