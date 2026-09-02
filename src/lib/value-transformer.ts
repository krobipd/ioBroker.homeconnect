// Value transformer — the core of the greenfield: turn BSH's raw enum strings
// into idiomatic ioBroker states (boolean / short enum + states / number+unit)
// and derive a speaking state id from the BSH key. Enum catalogue + wire shapes:
// `Ressourcen/homeconnect/bsh-api-research-2026-08-05.md` / reference_bsh_home_connect_api.
//
// Unknown keys/values are NOT dropped: they fall back to the raw value as a
// string, so nothing is lost — the mapping is then extended device by device.

import { cleanLabel, humanizeId, isRecord, numberOrUndef, stringArrayOrUndef } from "./pure-helpers";
import { tName } from "./i18n";

/**
 * Where a state's display name came from — decides whether a later label may
 * replace it: an "api" name (the cloud's localized text) is never downgraded to
 * a "derived" one (English from the key); an "i18n" name is the adapter's own
 * translation object for the states it invents itself.
 */
export type NameSource = "api" | "derived" | "i18n";

/** A single status / setting / option / event item as the BSH API returns it. */
export interface BshItem {
  /** The fully-qualified BSH key, e.g. "BSH.Common.Status.OperationState". */
  key: string;
  /** The localized display name the API sent for this item (Accept-Language), if any. */
  name?: string;
  /** The raw value (enum string, number, boolean). */
  value: unknown;
  /** Optional unit (e.g. "seconds", "°C") from the API. */
  unit?: string;
  /** Optional constraints from the API (numeric bounds, allowed enum values, access rights). */
  constraints?: ParsedConstraints;
}

/** A program option as `GET /programs/available/{programKey}` defines it (type + constraints). */
export interface BshOptionDefinition {
  /** The option key, e.g. "Dishcare.Dishwasher.Option.IntensivZone". */
  key: string;
  /** The localized option name. */
  name?: string;
  /** The BSH data type: "Int" / "Double" / "Boolean" / an enum type. */
  type?: string;
  /** The unit, e.g. "sec", "°C". */
  unit?: string;
  /** Constraints: numeric bounds, allowed enum values + their display labels, default. */
  constraints?: ParsedConstraints;
}

/** The transformed state: the `common` fragment to create it with, and the value. */
export interface TransformedState {
  /** The channel this state lives under (status / settings / events / options / …). */
  channel: string;
  /** The state id within the channel, e.g. "operationState". */
  id: string;
  /** The `common` fragment for the object (name + desc included). */
  common: ioBroker.StateCommon;
  /** Where `common.name` came from (see {@link NameSource}). */
  nameSource: NameSource;
  /** The transformed value. */
  value: ioBroker.StateValue;
  /**
   * For a writable enum: the full BSH candidate values (e.g.
   * `["…PowerState.On", "…PowerState.Off"]`). `shortEnum` is lossy, so these are
   * stored in the state's `native` to resolve a short value back on write.
   */
  bshValues?: string[];
}

const EVENT_PRESENT = "BSH.Common.EnumType.EventPresentState.Present";

/** BSH `<Kind>` segment → the ioBroker channel it maps to. */
const KIND_TO_CHANNEL: Record<string, string> = {
  Status: "status",
  Setting: "settings",
  Event: "events",
  Option: "options",
  Command: "commands",
  Root: "programs",
};

/** Curated `common.states` for the well-known Common enums (short value → label). */
const ENUM_STATES: Record<string, Record<string, string>> = {
  OperationState: {
    inactive: "Inactive",
    ready: "Ready",
    delayedstart: "Delayed start",
    run: "Running",
    pause: "Paused",
    actionrequired: "Action required",
    finished: "Finished",
    error: "Error",
    aborting: "Aborting",
  },
  PowerState: { mainsoff: "Mains off", off: "Off", on: "On", standby: "Standby", undefined: "Undefined" },
};

/**
 * The short, lower-case tail of a dotted BSH value, e.g. "…OperationState.Run" → "run".
 *
 * @param bshValue the dotted BSH enum/program value
 * @returns the lower-case last segment
 */
export function shortEnum(bshValue: string): string {
  const parts = bshValue.split(".");
  const tail = parts[parts.length - 1] ?? bshValue;
  return tail.toLowerCase();
}

/** The constraint fields either a status/setting item or an option definition may carry. */
export interface ParsedConstraints {
  /** Lower numeric bound. */
  min?: number;
  /** Upper numeric bound. */
  max?: number;
  /** Allowed step size between numeric values. */
  stepsize?: number;
  /** The allowed enum values (full BSH values). */
  allowedvalues?: string[];
  /** The parallel human-readable labels for {@link allowedvalues}. */
  displayvalues?: string[];
  /** The default value (an option definition may carry one). */
  default?: unknown;
  /** Access rights of a setting/status: "readWrite" or "read" (absent for options). */
  access?: string;
}

/**
 * Parse the `constraints` field of a raw BSH item/definition into the typed
 * shape both {@link transformItem} and {@link transformOptionDefinition}
 * consume. Superset of both callers' needs (a status item ignores
 * `displayvalues`/`default`); one boundary parser instead of two near-identical
 * inline blocks (the adapter's applyBshItem + applyOptionDefinition).
 *
 * @param rawConstraints the raw `constraints` value off an API record (unknown)
 * @returns the parsed constraints, or undefined when there is no constraints object
 */
export function parseConstraints(rawConstraints: unknown): ParsedConstraints | undefined {
  if (!isRecord(rawConstraints)) {
    return undefined;
  }
  return {
    min: numberOrUndef(rawConstraints.min),
    max: numberOrUndef(rawConstraints.max),
    stepsize: numberOrUndef(rawConstraints.stepsize),
    allowedvalues: stringArrayOrUndef(rawConstraints.allowedvalues),
    displayvalues: stringArrayOrUndef(rawConstraints.displayvalues),
    default: rawConstraints.default,
    access: typeof rawConstraints.access === "string" ? rawConstraints.access : undefined,
  };
}

/**
 * Lower-case the first character, e.g. "OperationState" → "operationState".
 *
 * @param s the string to transform
 * @returns the string with a lower-case first character
 */
function lowerFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * Derive the speaking channel + id from a BSH key. The kind segment is searched
 * anywhere in the key (not just second-to-last), because BSH nests freely:
 * "BSH.Common.Status.OperationState" → { channel: "status", id: "operationState" };
 * "Refrigeration.Common.Status.Door.Freezer" → { channel: "status", id: "doorFreezer" };
 * "Refrigeration.Common.Setting.Light.Internal.Brightness" → { channel: "settings", id: "lightInternalBrightness" };
 * "BSH.Common.Event.Favorite.001.ExternalTrigger" → { channel: "events", id: "favorite001ExternalTrigger" }.
 * The old second-to-last rule sent every nested key into a wrong "misc" channel
 * (and thereby also mis-derived its writability).
 *
 * @param key the fully-qualified BSH key
 * @returns the channel and the within-channel id
 */
export function stateIdForKey(key: string): { channel: string; id: string } {
  const parts = key.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const channel = KIND_TO_CHANNEL[parts[i] ?? ""];
    if (channel) {
      return { channel, id: camelJoin(parts.slice(i + 1)) };
    }
  }
  return { channel: "misc", id: lowerFirst(parts[parts.length - 1] ?? key) };
}

/**
 * Join key segments after the kind into one speaking camelCase id:
 * ["Door", "Freezer"] → "doorFreezer"; ["Favorite", "001", "ExternalTrigger"] →
 * "favorite001ExternalTrigger".
 *
 * @param segments the key segments after the kind segment
 * @returns the joined id
 */
function camelJoin(segments: string[]): string {
  return segments.map((s, i) => (i === 0 ? lowerFirst(s) : s.charAt(0).toUpperCase() + s.slice(1))).join("");
}

/**
 * Transform one BSH item into an idiomatic ioBroker state (channel, id, common, value).
 *
 * @param item the BSH status/setting/option/event item
 * @returns the transformed state ready to create and set
 */
export function transformItem(item: BshItem): TransformedState {
  const { channel, id } = stateIdForKey(item.key);
  const { common, value, bshValues, nameSource } = transformValue(item);
  return { channel, id, common, nameSource, value, bshValues };
}

/** The two synthetic program items — the adapter names them itself (translated). */
const PROGRAM_ITEM_NAMES: Record<string, "selectedProgram" | "activeProgram"> = {
  "BSH.Common.Root.SelectedProgram": "selectedProgram",
  "BSH.Common.Root.ActiveProgram": "activeProgram",
};

/**
 * The display name for a BSH-keyed state: the cloud's localized name when the
 * item carried one, else a readable English label derived from the id. The
 * technical key goes into `desc`, so the object browser shows both.
 *
 * @param key the fully-qualified BSH key
 * @param apiName the item's `name` off the wire, if any
 * @param id the derived state id
 * @returns the name, its source, and the desc
 */
function itemLabel(
  key: string,
  apiName: string | undefined,
  id: string,
): { name: ioBroker.StringOrTranslated; nameSource: NameSource; desc: string } {
  const own = PROGRAM_ITEM_NAMES[key];
  if (own) {
    return { name: tName(own), nameSource: "i18n", desc: key };
  }
  const cleaned = cleanLabel(apiName);
  return cleaned.length > 0
    ? { name: cleaned, nameSource: "api", desc: key }
    : { name: humanizeId(id), nameSource: "derived", desc: key };
}

/** The common door status key, carrying Open/Closed/Locked. */
const DOOR_STATE_KEY = "BSH.Common.Status.DoorState";
/** The operation state key — source of the derived `programRunning` boolean. */
const OPERATION_STATE_KEY = "BSH.Common.Status.OperationState";

/**
 * Whether a key is a door status — the common `DoorState` or a per-compartment
 * `…Status.Door.*` key of the refrigeration family. (Door *settings* like
 * `…Setting.Door.AssistantFreezer` stay on the generic path.)
 *
 * @param key the fully-qualified BSH key
 * @returns whether the key gets the boolean door mapping
 */
export function isDoorStatusKey(key: string): boolean {
  return key === DOOR_STATE_KEY || key.includes(".Status.Door.");
}

/**
 * Expand one BSH item into its idiomatic states. Almost always 1:1
 * ({@link transformItem}), with two deliberate exceptions from the design
 * principles (proper datapoint types, not raw enum text):
 * - a door status becomes boolean `doorOpen` (+ `doorLocked` on appliance types
 *   whose door locks), a per-compartment door becomes `door<Compartment>Open`;
 * - the operation state additionally feeds the derived boolean `programRunning`.
 *
 * @param item the BSH status / setting / option / event item
 * @param lockableDoor whether the appliance type has a lockable door
 * @returns the transformed states ready to create and set
 */
export function expandBshItem(item: BshItem, lockableDoor: boolean): TransformedState[] {
  if (isDoorStatusKey(item.key)) {
    const short = typeof item.value === "string" ? shortEnum(item.value) : "";
    if (item.key === DOOR_STATE_KEY) {
      const states: TransformedState[] = [
        {
          channel: "status",
          id: "doorOpen",
          common: { ...booleanCommon(tName("doorOpen"), "sensor.door", false), desc: item.key },
          nameSource: "i18n",
          value: short === "open",
        },
      ];
      if (lockableDoor) {
        states.push({
          channel: "status",
          id: "doorLocked",
          common: { ...booleanCommon(tName("doorLocked"), "indicator", false), desc: item.key },
          nameSource: "i18n",
          value: short === "locked",
        });
      }
      return states;
    }
    const id = `${stateIdForKey(item.key).id}Open`;
    // The compartment is the key's last segment ("Freezer", "Refrigerator", …).
    const compartment = item.key.split(".").at(-1) ?? "";
    return [
      {
        channel: "status",
        id,
        common: { ...booleanCommon(tName("doorCompartmentOpen", compartment), "sensor.door", false), desc: item.key },
        nameSource: "i18n",
        value: short === "open",
      },
    ];
  }
  const t = transformItem(item);
  if (item.key === OPERATION_STATE_KEY) {
    return [
      t,
      {
        channel: "status",
        id: "programRunning",
        common: { ...booleanCommon(tName("programRunning"), "indicator.working", false), desc: item.key },
        nameSource: "i18n",
        value: t.value === "run",
      },
    ];
  }
  return [t];
}

/**
 * Transform a program-option *definition* (from `/programs/available/{programKey}`)
 * into a writable options state. Unlike {@link transformItem} the type comes from
 * `option.type` (a definition may carry no value), and the state is always writable
 * (options are settings you configure before a start). Enum options get their
 * `common.states` labels from the parallel `displayvalues[]`, and the full allowed
 * values in `bshValues` for resolving a short write back.
 *
 * @param opt the option definition
 * @returns the writable options state
 */
export function transformOptionDefinition(opt: BshOptionDefinition): TransformedState {
  const { channel, id } = stateIdForKey(opt.key);
  const { name, nameSource, desc } = itemLabel(opt.key, opt.name, id);
  const c = opt.constraints;

  if (opt.type === "Boolean") {
    const common: ioBroker.StateCommon = {
      name,
      desc,
      type: "boolean",
      role: "switch",
      read: true,
      write: true,
      def: false,
    };
    return { channel, id, common, nameSource, value: c?.default === true };
  }

  if (opt.type === "Int" || opt.type === "Double") {
    const common: ioBroker.StateCommon = { name, desc, type: "number", role: "level", read: true, write: true };
    if (opt.unit) {
      common.unit = opt.unit;
    }
    if (typeof c?.min === "number") {
      common.min = c.min;
    }
    if (typeof c?.max === "number") {
      common.max = c.max;
    }
    if (typeof c?.stepsize === "number") {
      common.step = c.stepsize;
    }
    const value = typeof c?.default === "number" ? c.default : typeof c?.min === "number" ? c.min : 0;
    return { channel, id, common, nameSource, value };
  }

  // Enum (allowedvalues) or plain string option.
  const allowed = c?.allowedvalues?.filter(v => v.length > 0);
  const common: ioBroker.StateCommon = { name, desc, type: "string", role: "text", read: true, write: true };
  let bshValues: string[] | undefined;
  if (allowed && allowed.length > 0) {
    common.states = allowedStates(allowed, c?.displayvalues);
    bshValues = allowed;
  }
  const value = typeof c?.default === "string" ? shortEnum(c.default) : "";
  return { channel, id, common, nameSource, value, bshValues };
}

/**
 * Build a `common.states` map from allowed enum values and their parallel display
 * labels (falling back to the short value when no label is given).
 *
 * @param allowed the full allowed BSH values
 * @param displayvalues the parallel human-readable labels
 * @returns the short-value → label map
 */
function allowedStates(allowed: string[], displayvalues?: string[]): Record<string, string> {
  const states: Record<string, string> = {};
  allowed.forEach((v, i) => {
    const label = displayvalues?.[i];
    states[shortEnum(v)] = typeof label === "string" && label.length > 0 ? label : shortEnum(v);
  });
  return states;
}

/**
 * Whether a key maps to a writable state: settings are writable (PUT /settings),
 * and the selected program is writable (PUT /programs/selected). Status, events,
 * options and the active program are read-only.
 *
 * @param key the fully-qualified BSH key
 * @returns whether the resulting state should be writable
 */
function isWritable(key: string): boolean {
  const { channel, id } = stateIdForKey(key);
  return channel === "settings" || (channel === "programs" && id === "selectedProgram");
}

/**
 * The value + common part of the transform (id/channel handled by the caller).
 *
 * @param item the BSH item to transform
 * @returns the common fragment, the transformed value, and (for writable enums) the full candidate values
 */
function transformValue(item: BshItem): {
  common: ioBroker.StateCommon;
  nameSource: NameSource;
  value: ioBroker.StateValue;
  bshValues?: string[];
} {
  const { key, value } = item;
  const { name, nameSource, desc } = itemLabel(key, item.name, stateIdForKey(key).id);
  // A setting the API marks access:"read" is not writable, whatever its channel says.
  const writable = isWritable(key) && item.constraints?.access !== "read";
  const allowed = item.constraints?.allowedvalues?.filter(v => v.length > 0);

  // Events carry an EventPresentState enum → boolean "is present" (always read-only).
  if (key.includes(".Event.")) {
    return {
      common: { ...booleanCommon(name, "indicator.alarm", false), desc },
      nameSource,
      value: value === EVENT_PRESENT,
    };
  }

  // Numeric values → number, carrying unit + min/max when the API supplied them.
  if (typeof value === "number") {
    const common: ioBroker.StateCommon = {
      name,
      desc,
      type: "number",
      role: writable ? "level" : "value",
      read: true,
      write: writable,
    };
    if (item.unit) {
      common.unit = item.unit;
    }
    if (typeof item.constraints?.min === "number") {
      common.min = item.constraints.min;
    }
    if (typeof item.constraints?.max === "number") {
      common.max = item.constraints.max;
    }
    if (typeof item.constraints?.stepsize === "number") {
      common.step = item.constraints.stepsize;
    }
    return { common, nameSource, value };
  }

  // Native booleans (RemoteControlActive, ChildLock, …).
  if (typeof value === "boolean") {
    return {
      common: { ...booleanCommon(name, writable ? "switch" : "indicator", writable), desc },
      nameSource,
      value,
    };
  }

  // Enum strings, or any value that came with an allowed-values list → short value,
  // with curated states for the well-known enums (else derived from the allowed values),
  // and the full candidate values for resolving a write back to its BSH value.
  const isEnumString = typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."));
  if (isEnumString || (allowed && allowed.length > 0)) {
    const short = typeof value === "string" && value.length > 0 ? shortEnum(value) : "";
    const common: ioBroker.StateCommon = { name, desc, type: "string", role: "text", read: true, write: writable };
    const enumType = typeof value === "string" ? value.split(".EnumType.")[1]?.split(".")[0] : undefined;
    const display = item.constraints?.displayvalues;
    if (allowed && allowed.length > 0 && display && display.length === allowed.length) {
      // The cloud's own localized labels beat any curated English list.
      common.states = allowedStates(allowed, display);
    } else if (enumType && ENUM_STATES[enumType]) {
      common.states = ENUM_STATES[enumType];
    } else if (allowed && allowed.length > 0) {
      common.states = Object.fromEntries(allowed.map(v => [shortEnum(v), shortEnum(v)]));
    }
    // Only writable enums need the candidate values (to resolve a short write back).
    const bshValues = writable
      ? allowed && allowed.length > 0
        ? allowed
        : short.length > 0
          ? [value as string]
          : undefined
      : undefined;
    return { common, nameSource, value: short, bshValues };
  }

  // Fallback: keep the raw value as a string, so nothing is lost.
  return {
    common: { name, desc, type: "string", role: "text", read: true, write: writable },
    nameSource,
    value: typeof value === "string" ? value : JSON.stringify(value),
  };
}

/**
 * A boolean `common` with the given role and writability.
 *
 * @param name the state name (a translation object for the adapter's own states)
 * @param role the ioBroker role
 * @param writable whether the state is writable
 * @returns the boolean common fragment
 */
function booleanCommon(name: ioBroker.StringOrTranslated, role: string, writable: boolean): ioBroker.StateCommon {
  return { name, type: "boolean", role, read: true, write: writable, def: false };
}
