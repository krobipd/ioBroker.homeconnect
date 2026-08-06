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
  /** Optional numeric constraints from the API. */
  constraints?: { min?: number; max?: number; stepsize?: number };
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
  const { common, value } = transformValue(item);
  return { channel, id, common, value };
}

/**
 * The value + common part of the transform (id/channel handled by the caller).
 *
 * @param item the BSH item to transform
 * @returns the common fragment and the transformed value
 */
function transformValue(item: BshItem): { common: ioBroker.StateCommon; value: ioBroker.StateValue } {
  const { key, value } = item;
  const name = stateIdForKey(key).id;

  // Events carry an EventPresentState enum → boolean "is present".
  if (key.includes(".Event.")) {
    return { common: booleanCommon(name, "indicator.alarm"), value: value === EVENT_PRESENT };
  }

  // Numeric values → number, carrying unit + min/max when the API supplied them.
  if (typeof value === "number") {
    const common: ioBroker.StateCommon = { name, type: "number", role: "value", read: true, write: false };
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
    return { common: booleanCommon(name, "indicator"), value };
  }

  // Enum strings → short value, with curated states for the well-known ones.
  if (typeof value === "string" && (value.includes(".EnumType.") || value.includes(".Program."))) {
    const short = shortEnum(value);
    const enumType = value.split(".EnumType.")[1]?.split(".")[0];
    const common: ioBroker.StateCommon = { name, type: "string", role: "text", read: true, write: false };
    if (enumType && ENUM_STATES[enumType]) {
      common.states = ENUM_STATES[enumType];
    }
    return { common, value: short };
  }

  // Fallback: keep the raw value as a string, so nothing is lost.
  return {
    common: { name, type: "string", role: "text", read: true, write: false },
    value: typeof value === "string" ? value : JSON.stringify(value),
  };
}

/**
 * A read-only boolean `common` with the given role.
 *
 * @param name the state name
 * @param role the ioBroker role
 * @returns the boolean common fragment
 */
function booleanCommon(name: string, role: string): ioBroker.StateCommon {
  return { name, type: "boolean", role, read: true, write: false, def: false };
}
