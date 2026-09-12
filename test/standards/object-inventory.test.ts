import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Assertions over the generated object inventory (`npm run test:inventory`,
 * driven by the 17 device-type fixtures). These hold what the unit tests cannot:
 * that the rule survives for EVERY appliance type, across the whole tree the
 * adapter really builds.
 */
const inventory = JSON.parse(readFileSync(join(__dirname, "..", "objects.inventory.json"), "utf8")) as Record<
  string,
  { common?: Record<string, unknown>; native?: Record<string, unknown> }
>;

describe("object inventory", () => {
  it("gives every writable enum setting more than one candidate value", () => {
    // The finding this defends (2026-09-12, measured at a live installation):
    // the settings LIST carries no constraints, so without the single-setting
    // fetch a writable enum knows only its CURRENT value as a write candidate —
    // an appliance sitting at `off` could not be switched on through the adapter.
    // One candidate is the signature of that bug.
    const offenders = Object.entries(inventory)
      .filter(([id]) => id.includes(".settings."))
      .filter(([, o]) => o.common?.write === true && Array.isArray(o.native?.bshValues))
      .filter(([, o]) => (o.native?.bshValues as unknown[]).length < 2)
      .map(([id]) => id);
    expect(offenders).toEqual([]);
    // And the rule is not vacuous: there ARE such settings in the inventory.
    const enums = Object.entries(inventory).filter(
      ([id, o]) => id.includes(".settings.") && o.common?.write === true && Array.isArray(o.native?.bshValues),
    );
    expect(enums.length).toBeGreaterThan(10);
  });

  it("gives every numeric setting the bounds its constraints declare", () => {
    const offenders = Object.entries(inventory)
      .filter(([id, o]) => id.includes(".settings.") && o.common?.type === "number")
      .filter(([, o]) => o.common?.min === undefined || o.common?.max === undefined)
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });

  it("names every datapoint the text table covers itself, in every language", () => {
    // A cloud name reaches one language, and measured 2026-09-12 not reliably the
    // one that was asked for. Where this adapter has a text, `nameSource` must be
    // "i18n" — a plain string there means a single-language label froze in.
    const plainStrings = Object.entries(inventory)
      .filter(([, o]) => o.native?.nameSource === "i18n")
      .filter(([, o]) => typeof o.common?.name === "string")
      .map(([id]) => id);
    expect(plainStrings).toEqual([]);
  });
});
