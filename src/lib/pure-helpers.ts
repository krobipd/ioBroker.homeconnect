// Small pure helpers, isolated so they can be unit-tested without an adapter.

/**
 * Turn a source string (a type-plate E-number, or a name) into an id-safe path segment.
 * "SX87TX02CE/60" → "sx87tx02ce-60", "Kühl-Gefrier-Kombination" → "kuehl-gefrier-kombination".
 * German umlauts are transliterated, all other accented letters lose their
 * diacritics (Unicode decomposition); anything else non-alphanumeric becomes a hyphen.
 *
 * @param name the friendly device name (may be empty)
 * @returns a lower-case id-safe slug, or "device" if nothing usable remains
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "device";
}

/**
 * Disambiguate a device slug against the slugs already taken this sync. Two
 * appliances whose names slugify to the same string (two "Geschirrspüler", or
 * default names) would otherwise collapse into one object tree and mis-route
 * writes. On a collision the haId's last 4 hex make the slug unique + stable
 * (the same appliance always resolves to the same slug).
 *
 * @param baseSlug the slug from {@link slugify}
 * @param haId the appliance's haId (its stable identity)
 * @param taken the slugs already assigned in this sync pass
 * @returns baseSlug if free, else `${baseSlug}-${last4OfHaId}`
 */
export function disambiguateSlug(baseSlug: string, haId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseSlug)) {
    return baseSlug;
  }
  const suffix =
    haId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-4)
      .toLowerCase() || "2";
  let candidate = `${baseSlug}-${suffix}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${baseSlug}-${suffix}-${n++}`;
  }
  return candidate;
}

/**
 * Render an unknown error to a string for logging: the message for an Error
 * (the stack stays out of the line — debug paths render it themselves), else
 * `String(...)`. Replaces the `e instanceof Error ? e.message : String(e)`
 * repeated across the adapter.
 *
 * @param e the caught value (usually `unknown` in a catch block)
 * @returns a human-readable message
 */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── API-boundary type-guards (shared; external data is `unknown`) ────────────

/**
 * Type guard for a plain (non-array) object.
 *
 * @param v the value to test
 * @returns whether v is a record
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * A number, or undefined for anything else.
 *
 * @param v the value to test
 * @returns the number, or undefined
 */
export function numberOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * The string elements of an array, or undefined for a non-array.
 *
 * @param v the value to test
 * @returns the string array, or undefined
 */
export function stringArrayOrUndef(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

// ─── cloud text → object names / log lines ───────────────────────────────────

/** Longest label the adapter puts into an object name or a log line. */
export const MAX_LABEL_LENGTH = 200;

/**
 * Make a cloud-provided display string safe for an object name or a log line:
 * control characters (line breaks, tabs, …) become spaces, runs of whitespace
 * collapse, the result is trimmed and capped. Cloud text is trusted CONTENT,
 * not trusted FORMAT — a line break inside an appliance name would split a log
 * line and put a two-line label into the object tree.
 *
 * @param raw the value off the wire (anything; only a string is used)
 * @param fallback what to return when nothing usable remains
 * @returns the cleaned label, or the fallback
 */
export function cleanLabel(raw: unknown, fallback = ""): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const cleaned = raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return fallback;
  }
  return cleaned.length > MAX_LABEL_LENGTH ? `${cleaned.slice(0, MAX_LABEL_LENGTH - 1)}…` : cleaned;
}

/**
 * A readable English label from a camelCase state id, for a datapoint whose
 * localized name the cloud has not delivered (yet): "operationState" →
 * "Operation state", "doorFreezerOpen" → "Door freezer open",
 * "favorite001ExternalTrigger" → "Favorite 001 external trigger".
 *
 * @param id the camelCase state id
 * @returns the sentence-case label, or the id itself when it has no letters
 */
export function humanizeId(id: string): string {
  const words = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(w => w.length > 0);
  if (words.length === 0) {
    return id;
  }
  const text = words.map(w => w.toLowerCase()).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── user writes → the state's declared type ─────────────────────────────────

/**
 * Bring a written value into the state's declared type before it is sent to
 * the appliance and confirmed back: a script writing `"true"` or `1` into a
 * boolean switch, or `"40"` into a number, must reach the cloud as `true` /
 * `40` — and the ack must carry that value, not the raw text.
 *
 * @param value the value the user wrote
 * @param type the state's `common.type`
 * @returns the typed value, or undefined when it cannot be read as that type
 */
export function coerceForType(
  value: ioBroker.StateValue,
  type: ioBroker.CommonType | undefined,
): ioBroker.StateValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  switch (type) {
    case "boolean": {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "number") {
        return value !== 0;
      }
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (["true", "1", "on", "yes"].includes(s)) {
          return true;
        }
        if (["false", "0", "off", "no"].includes(s)) {
          return false;
        }
      }
      return undefined;
    }
    case "number": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
      }
      if (typeof value === "boolean") {
        return value ? 1 : 0;
      }
      if (typeof value === "string" && value.trim().length > 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case "string":
      return typeof value === "string" ? value : String(value);
    default:
      return value;
  }
}
