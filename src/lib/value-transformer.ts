// Value transformer — the core of the greenfield: turn BSH's raw enum strings
// into idiomatic ioBroker states (boolean / short enum + states / number+unit)
// and derive a speaking state id from the BSH key. Enum catalogue + wire shapes:
// `Ressourcen/homeconnect/bsh-api-research-2026-08-05.md` / reference_bsh_home_connect_api.
//
// Unknown keys/values are NOT dropped: they fall back to the raw value as a
// string, so nothing is lost — the mapping is then extended device by device.

/** A single status / setting / option / event item as the BSH API returns it. */
export interface BshItem {
  /** The fully-qualified BSH key, e.g. "BSH.Common.Status.OperationState". */
  key: string;
  /** The raw value (enum string, number, boolean). */
  value: unknown;
  /** Optional unit (e.g. "seconds", "°C") from the API. */
  unit?: string;
  /** Optional constraints from the API (numeric bounds and/or the allowed enum values). */
  constraints?: { min?: number; max?: number; stepsize?: number; allowedvalues?: string[] };
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
  constraints?: {
    min?: number;
    max?: number;
    stepsize?: number;
    allowedvalues?: string[];
    displayvalues?: string[];
    default?: unknown;
  };
}

/** The transformed state: the `common` fragment to create it with, and the value. */
export interface TransformedState {
  /** The channel this state lives under (status / settings / events / options / …). */
  channel: string;
  /** The state id within the channel, e.g. "operationState". */
  id: string;
  /** The `common` fragment for the object. */
  common: ioBroker.StateCommon;
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
 * Derive the speaking channel + id from a BSH key.
 * "BSH.Common.Status.OperationState" → { channel: "status", id: "operationState" };
 * "Dishcare.Dishwasher.Event.SaltNearlyEmpty" → { channel: "events", id: "saltNearlyEmpty" }.
 *
 * @param key the fully-qualified BSH key
 * @returns the channel and the within-channel id
 */
export function stateIdForKey(key: string): { channel: string; id: string } {
  const parts = key.split(".");
  const name = parts[parts.length - 1] ?? key;
  const kind = parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
  const channel = KIND_TO_CHANNEL[kind] ?? "misc";
  return { channel, id: lowerFirst(name) };
}

/**
 * Transform one BSH item into an idiomatic ioBroker state (channel, id, common, value).
 *
 * @param item the BSH status/setting/option/event item
 * @returns the transformed state ready to create and set
 */
export function transformItem(item: BshItem): TransformedState {
  const { channel, id } = stateIdForKey(item.key);
  const { common, value, bshValues } = transformValue(item);
  return { channel, id, common, value, bshValues };
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
  const name = opt.name && opt.name.length > 0 ? opt.name : id;
  const c = opt.constraints;

  if (opt.type === "Boolean") {
    const common: ioBroker.StateCommon = { name, type: "boolean", role: "switch", read: true, write: true, def: false };
    return { channel, id, common, value: c?.default === true };
  }

  if (opt.type === "Int" || opt.type === "Double") {
    const common: ioBroker.StateCommon = { name, type: "number", role: "level", read: true, write: true };
    if (opt.unit) {
      common.unit = opt.unit;
    }
    if (typeof c?.min === "number") {
      common.min = c.min;
    }
    if (typeof c?.max === "number") {
      common.max = c.max;
    }
    const value = typeof c?.default === "number" ? c.default : typeof c?.min === "number" ? c.min : 0;
    return { channel, id, common, value };
  }

  // Enum (allowedvalues) or plain string option.
  const allowed = c?.allowedvalues?.filter(v => v.length > 0);
  const common: ioBroker.StateCommon = { name, type: "string", role: "text", read: true, write: true };
  let bshValues: string[] | undefined;
  if (allowed && allowed.length > 0) {
    common.states = allowedStates(allowed, c?.displayvalues);
    bshValues = allowed;
  }
  const value = typeof c?.default === "string" ? shortEnum(c.default) : "";
  return { channel, id, common, value, bshValues };
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
  value: ioBroker.StateValue;
  bshValues?: string[];
} {
  const { key, value } = item;
  const name = stateIdForKey(key).id;
  const writable = isWritable(key);
  const allowed = item.constraints?.allowedvalues?.filter(v => v.length > 0);

  // Events carry an EventPresentState enum → boolean "is present" (always read-only).
  if (key.includes(".Event.")) {
    return { common: booleanCommon(name, "indicator.alarm", false), value: value === EVENT_PRESENT };
  }

  // Numeric values → number, carrying unit + min/max when the API supplied them.
  if (typeof value === "number") {
    const common: ioBroker.StateCommon = {
      name,
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
    return { common, value };
  }

  // Native booleans (RemoteControlActive, ChildLock, …).
  if (typeof value === "boolean") {
    return { common: booleanCommon(name, writable ? "switch" : "indicator", writable), value };
  }

  // Enum strings, or any value that came with an allowed-values list → short value,
  // with curated states for the well-known enums (else derived from the allowed values),
  // and the full candidate values for resolving a write back to its BSH value.
  const isEnumString = typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."));
  if (isEnumString || (allowed && allowed.length > 0)) {
    const short = typeof value === "string" && value.length > 0 ? shortEnum(value) : "";
    const common: ioBroker.StateCommon = { name, type: "string", role: "text", read: true, write: writable };
    const enumType = typeof value === "string" ? value.split(".EnumType.")[1]?.split(".")[0] : undefined;
    if (enumType && ENUM_STATES[enumType]) {
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
    return { common, value: short, bshValues };
  }

  // Fallback: keep the raw value as a string, so nothing is lost.
  return {
    common: { name, type: "string", role: "text", read: true, write: writable },
    value: typeof value === "string" ? value : JSON.stringify(value),
  };
}

/**
 * A boolean `common` with the given role and writability.
 *
 * @param name the state name
 * @param role the ioBroker role
 * @param writable whether the state is writable
 * @returns the boolean common fragment
 */
function booleanCommon(name: string, role: string, writable: boolean): ioBroker.StateCommon {
  return { name, type: "boolean", role, read: true, write: writable, def: false };
}
