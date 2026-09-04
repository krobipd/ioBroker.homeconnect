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
  expandBshItem: () => expandBshItem,
  isDoorStatusKey: () => isDoorStatusKey,
  parseConstraints: () => parseConstraints,
  shortEnum: () => shortEnum,
  stateIdForKey: () => stateIdForKey,
  transformItem: () => transformItem,
  transformOptionDefinition: () => transformOptionDefinition
});
module.exports = __toCommonJS(value_transformer_exports);
var import_pure_helpers = require("./pure-helpers");
var import_i18n = require("./i18n");
var import_state_texts = require("./state-texts");
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
function parseConstraints(rawConstraints) {
  if (!(0, import_pure_helpers.isRecord)(rawConstraints)) {
    return void 0;
  }
  return {
    min: (0, import_pure_helpers.numberOrUndef)(rawConstraints.min),
    max: (0, import_pure_helpers.numberOrUndef)(rawConstraints.max),
    stepsize: (0, import_pure_helpers.numberOrUndef)(rawConstraints.stepsize),
    allowedvalues: (0, import_pure_helpers.stringArrayOrUndef)(rawConstraints.allowedvalues),
    displayvalues: (0, import_pure_helpers.stringArrayOrUndef)(rawConstraints.displayvalues),
    default: rawConstraints.default,
    access: typeof rawConstraints.access === "string" ? rawConstraints.access : void 0
  };
}
function lowerFirst(s) {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function stateIdForKey(key) {
  var _a, _b;
  const parts = key.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const channel = KIND_TO_CHANNEL[(_a = parts[i]) != null ? _a : ""];
    if (channel) {
      return { channel, id: camelJoin(parts.slice(i + 1)) };
    }
  }
  return { channel: "misc", id: lowerFirst((_b = parts[parts.length - 1]) != null ? _b : key) };
}
function camelJoin(segments) {
  return segments.map((s, i) => i === 0 ? lowerFirst(s) : s.charAt(0).toUpperCase() + s.slice(1)).join("");
}
function transformItem(item) {
  const { channel, id } = stateIdForKey(item.key);
  const { common, value, bshValues, nameSource } = transformValue(item);
  return { channel, id, common, nameSource, value, bshValues };
}
const PROGRAM_ITEM_NAMES = {
  "BSH.Common.Root.SelectedProgram": "selectedProgram",
  "BSH.Common.Root.ActiveProgram": "activeProgram"
};
function itemLabel(key, apiName, id) {
  const texts = (0, import_state_texts.stateText)(key);
  const desc = (texts == null ? void 0 : texts.desc) ? (0, import_i18n.tName)(texts.desc) : void 0;
  if (texts == null ? void 0 : texts.name) {
    return { name: (0, import_i18n.tName)(texts.name), nameSource: "i18n", desc };
  }
  const own = PROGRAM_ITEM_NAMES[key];
  if (own) {
    return { name: (0, import_i18n.tName)(own), nameSource: "i18n", desc };
  }
  const cleaned = (0, import_pure_helpers.cleanLabel)(apiName);
  if (cleaned.length > 0) {
    return { name: cleaned, nameSource: "api", desc };
  }
  if (texts == null ? void 0 : texts.fallbackName) {
    return { name: (0, import_i18n.tName)(texts.fallbackName), nameSource: "derived", desc };
  }
  return { name: (0, import_pure_helpers.humanizeId)(id), nameSource: "derived", desc };
}
const DOOR_STATE_KEY = "BSH.Common.Status.DoorState";
const OPERATION_STATE_KEY = "BSH.Common.Status.OperationState";
function isDoorStatusKey(key) {
  return key === DOOR_STATE_KEY || key.includes(".Status.Door.");
}
function expandBshItem(item, lockableDoor) {
  var _a;
  if (isDoorStatusKey(item.key)) {
    const short = typeof item.value === "string" ? shortEnum(item.value) : "";
    if (item.key === DOOR_STATE_KEY) {
      const states = [
        {
          channel: "status",
          id: "doorOpen",
          common: { ...booleanCommon((0, import_i18n.tName)("doorOpen"), "sensor.door", false), desc: (0, import_i18n.tName)("doorOpenDesc") },
          nameSource: "i18n",
          value: short === "open"
        }
      ];
      if (lockableDoor) {
        states.push({
          channel: "status",
          id: "doorLocked",
          common: { ...booleanCommon((0, import_i18n.tName)("doorLocked"), "indicator", false), desc: (0, import_i18n.tName)("doorLockedDesc") },
          nameSource: "i18n",
          value: short === "locked"
        });
      }
      return states;
    }
    const id = `${stateIdForKey(item.key).id}Open`;
    const compartment = (_a = item.key.split(".").at(-1)) != null ? _a : "";
    return [
      {
        channel: "status",
        id,
        common: {
          ...booleanCommon((0, import_i18n.tName)("doorCompartmentOpen", compartment), "sensor.door", false),
          desc: (0, import_i18n.tName)("doorCompartmentOpenDesc")
        },
        nameSource: "i18n",
        value: short === "open"
      }
    ];
  }
  const t = transformItem(item);
  if (item.key === OPERATION_STATE_KEY) {
    return [
      t,
      {
        channel: "status",
        id: "programRunning",
        common: {
          ...booleanCommon((0, import_i18n.tName)("programRunning"), "indicator.working", false),
          desc: (0, import_i18n.tName)("programRunningDesc")
        },
        nameSource: "i18n",
        value: t.value === "run"
      }
    ];
  }
  return [t];
}
function transformOptionDefinition(opt) {
  var _a;
  const { channel, id } = stateIdForKey(opt.key);
  const { name, nameSource, desc } = itemLabel(opt.key, opt.name, id);
  const c = opt.constraints;
  if (opt.type === "Boolean") {
    const common2 = {
      name,
      desc,
      type: "boolean",
      role: "switch",
      read: true,
      write: true,
      def: false
    };
    return { channel, id, common: common2, nameSource, value: (c == null ? void 0 : c.default) === true };
  }
  if (opt.type === "Int" || opt.type === "Double") {
    const common2 = { name, desc, type: "number", role: "level", read: true, write: true };
    if (opt.unit) {
      common2.unit = opt.unit;
    }
    if (typeof (c == null ? void 0 : c.min) === "number") {
      common2.min = c.min;
    }
    if (typeof (c == null ? void 0 : c.max) === "number") {
      common2.max = c.max;
    }
    if (typeof (c == null ? void 0 : c.stepsize) === "number") {
      common2.step = c.stepsize;
    }
    const value2 = typeof (c == null ? void 0 : c.default) === "number" ? c.default : typeof (c == null ? void 0 : c.min) === "number" ? c.min : 0;
    return { channel, id, common: common2, nameSource, value: value2 };
  }
  const allowed = (_a = c == null ? void 0 : c.allowedvalues) == null ? void 0 : _a.filter((v) => v.length > 0);
  const common = { name, desc, type: "string", role: "text", read: true, write: true };
  let bshValues;
  if (allowed && allowed.length > 0) {
    common.states = allowedStates(allowed, c == null ? void 0 : c.displayvalues);
    bshValues = allowed;
  }
  const value = typeof (c == null ? void 0 : c.default) === "string" ? shortEnum(c.default) : "";
  return { channel, id, common, nameSource, value, bshValues };
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
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const { key, value } = item;
  const { name, nameSource, desc } = itemLabel(key, item.name, stateIdForKey(key).id);
  const writable = isWritable(key) && ((_a = item.constraints) == null ? void 0 : _a.access) !== "read";
  const allowed = (_c = (_b = item.constraints) == null ? void 0 : _b.allowedvalues) == null ? void 0 : _c.filter((v) => v.length > 0);
  if (key.includes(".Event.")) {
    return {
      common: { ...booleanCommon(name, "indicator.alarm", false), desc },
      nameSource,
      value: value === EVENT_PRESENT
    };
  }
  if (typeof value === "number") {
    const common = {
      name,
      desc,
      type: "number",
      role: writable ? "level" : "value",
      read: true,
      write: writable
    };
    if (item.unit) {
      common.unit = item.unit;
    }
    if (typeof ((_d = item.constraints) == null ? void 0 : _d.min) === "number") {
      common.min = item.constraints.min;
    }
    if (typeof ((_e = item.constraints) == null ? void 0 : _e.max) === "number") {
      common.max = item.constraints.max;
    }
    if (typeof ((_f = item.constraints) == null ? void 0 : _f.stepsize) === "number") {
      common.step = item.constraints.stepsize;
    }
    return { common, nameSource, value };
  }
  if (typeof value === "boolean") {
    return {
      common: { ...booleanCommon(name, writable ? "switch" : "indicator", writable), desc },
      nameSource,
      value
    };
  }
  const isEnumString = typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."));
  if (isEnumString || allowed && allowed.length > 0) {
    const short = typeof value === "string" && value.length > 0 ? shortEnum(value) : "";
    const common = { name, desc, type: "string", role: "text", read: true, write: writable };
    const enumType = typeof value === "string" ? (_g = value.split(".EnumType.")[1]) == null ? void 0 : _g.split(".")[0] : void 0;
    const display = (_h = item.constraints) == null ? void 0 : _h.displayvalues;
    if (allowed && allowed.length > 0 && display && display.length === allowed.length) {
      common.states = allowedStates(allowed, display);
    } else if (enumType && ENUM_STATES[enumType]) {
      common.states = ENUM_STATES[enumType];
    } else if (allowed && allowed.length > 0) {
      common.states = Object.fromEntries(allowed.map((v) => [shortEnum(v), shortEnum(v)]));
    }
    const bshValues = writable ? allowed && allowed.length > 0 ? allowed : short.length > 0 ? [value] : void 0 : void 0;
    return { common, nameSource, value: short, bshValues };
  }
  return {
    common: { name, desc, type: "string", role: "text", read: true, write: writable },
    nameSource,
    value: typeof value === "string" ? value : JSON.stringify(value)
  };
}
function booleanCommon(name, role, writable) {
  return { name, type: "boolean", role, read: true, write: writable, def: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  expandBshItem,
  isDoorStatusKey,
  parseConstraints,
  shortEnum,
  stateIdForKey,
  transformItem,
  transformOptionDefinition
});
//# sourceMappingURL=value-transformer.js.map
