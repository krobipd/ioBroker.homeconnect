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
