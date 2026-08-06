// Command dispatch — the pure mapping from an ioBroker state write to the Home
// Connect REST call that carries it out. No adapter instance, no I/O: a context
// object in, a request (or null) out. Kept separate so the write routing is
// unit-testable like oauth / http / value-transformer / sse-parser.

import { shortEnum } from "./value-transformer";

/** The context of a single writable-state change, gathered by the adapter from the state + its object. */
export interface WriteContext {
  /** The appliance's haId. */
  haId: string;
  /** The state's channel (settings / commands / programs). */
  channel: string;
  /** The within-channel state id (e.g. "powerState", "selectedProgram", "start"). */
  id: string;
  /** The BSH key stored in the state's native (settings / commands / selectedProgram). */
  bshKey?: string;
  /** The full BSH candidate values stored in native, for resolving a short enum write back. */
  bshValues?: string[];
  /** The written value. */
  value: ioBroker.StateValue;
  /** The full BSH key of the currently selected program — the payload of the "start" button. */
  selectedProgramKey?: string;
}

/** A resolved Home Connect write. `body` is the inner `data` object; the HTTP layer wraps it as `{ data }`. */
export interface WriteRequest {
  /** The HTTP method. */
  method: "PUT" | "DELETE";
  /** The endpoint path. */
  path: string;
  /** The request body (omitted for DELETE). */
  body?: { key: string; value?: ioBroker.StateValue };
}

/**
 * Resolve a writable-state change into the Home Connect request that performs it,
 * or null when the write should be ignored: an unknown enum value, a button set to
 * false, a start with no program selected, or an unrecognized state.
 *
 * @param ctx the change context
 * @returns the request to send, or null to ignore the write
 */
export function resolveWrite(ctx: WriteContext): WriteRequest | null {
  const base = `/api/homeappliances/${ctx.haId}`;

  if (ctx.channel === "settings" && ctx.bshKey) {
    const value = resolveValue(ctx.value, ctx.bshValues);
    if (value === undefined) {
      return null;
    }
    return { method: "PUT", path: `${base}/settings/${ctx.bshKey}`, body: { key: ctx.bshKey, value } };
  }

  if (ctx.channel === "commands" && ctx.bshKey) {
    // Commands are momentary: only a true write fires one, a false is a no-op.
    return ctx.value === true
      ? { method: "PUT", path: `${base}/commands/${ctx.bshKey}`, body: { key: ctx.bshKey, value: true } }
      : null;
  }

  if (ctx.channel === "programs") {
    if (ctx.id === "selectedProgram" && ctx.bshKey) {
      const key = resolveEnum(ctx.value, ctx.bshValues);
      return key ? { method: "PUT", path: `${base}/programs/selected`, body: { key } } : null;
    }
    if (ctx.id === "start" && ctx.value === true) {
      return ctx.selectedProgramKey
        ? { method: "PUT", path: `${base}/programs/active`, body: { key: ctx.selectedProgramKey } }
        : null;
    }
    if (ctx.id === "stop" && ctx.value === true) {
      return { method: "DELETE", path: `${base}/programs/active` };
    }
  }

  return null;
}

/**
 * Resolve a written value to what the API expects: for an enum (candidates present),
 * map the short value back to its full BSH value; otherwise pass the value through
 * (booleans and numbers go as-is).
 *
 * @param value the written value
 * @param bshValues the full candidate values, if this is an enum
 * @returns the API value, or undefined to ignore the write (unknown enum value)
 */
function resolveValue(value: ioBroker.StateValue, bshValues?: string[]): ioBroker.StateValue | undefined {
  if (bshValues && bshValues.length > 0) {
    return resolveEnum(value, bshValues);
  }
  return value;
}

/**
 * Map a short enum value back to its full BSH value (e.g. "on" → "…PowerState.On").
 *
 * @param value the short value written to the state
 * @param bshValues the full candidate values
 * @returns the matching full value, or undefined if none matches
 */
function resolveEnum(value: ioBroker.StateValue, bshValues?: string[]): string | undefined {
  return bshValues?.find(v => shortEnum(v) === value);
}
