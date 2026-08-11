// Small pure helpers, isolated so they can be unit-tested without an adapter.

/**
 * Turn a device name into an id-safe, speaking path segment.
 * "Kühl-Gefrier-Kombination" → "kuehl-gefrier-kombination", "Geschirrspüler" → "geschirrspueler".
 * German umlauts are transliterated; anything else non-alphanumeric becomes a hyphen.
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
