import { describe, it, expect } from "vitest";
import { slugify, disambiguateSlug, errMessage, cleanLabel, humanizeId, coerceForType } from "./pure-helpers";

describe("slugify", () => {
  it("transliterates umlauts and lower-cases", () => {
    expect(slugify("Geschirrspüler")).toBe("geschirrspueler");
    expect(slugify("Kühl-Gefrier-Kombination")).toBe("kuehl-gefrier-kombination");
    expect(slugify("Waschtrockner")).toBe("waschtrockner");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("strips diacritics from non-German accented letters instead of dropping them", () => {
    expect(slugify("Réfrigérateur")).toBe("refrigerateur");
    expect(slugify("Cafetera automática")).toBe("cafetera-automatica");
    expect(slugify("Piekarnik Świętokrzyski")).toBe("piekarnik-swietokrzyski");
  });

  it("collapses other characters to single hyphens and trims them", () => {
    expect(slugify("Bosch  Serie 6 / 2024")).toBe("bosch-serie-6-2024");
    expect(slugify("--edge--")).toBe("edge");
  });

  it("falls back to 'device' when nothing usable remains", () => {
    expect(slugify("")).toBe("device");
    expect(slugify("///")).toBe("device");
  });
});

describe("disambiguateSlug", () => {
  it("returns the base slug when it is not taken", () => {
    expect(disambiguateSlug("geschirrspueler", "SIEMENS-HCS02-AABBCCDDEEFF", new Set())).toBe("geschirrspueler");
  });

  it("appends the last 4 haId hex on a collision, stable per appliance", () => {
    const taken = new Set(["geschirrspueler"]);
    expect(disambiguateSlug("geschirrspueler", "SIEMENS-HCS02-AABBCCDDE1F2", taken)).toBe("geschirrspueler-e1f2");
  });

  it("keeps disambiguating when the suffixed slug is also taken", () => {
    const taken = new Set(["dishwasher", "dishwasher-e1f2"]);
    expect(disambiguateSlug("dishwasher", "HA-XXXX-XXXXE1F2", taken)).toBe("dishwasher-e1f2-2");
  });

  it("falls back to a numeric suffix when the haId has no usable tail", () => {
    const taken = new Set(["oven"]);
    expect(disambiguateSlug("oven", "----", taken)).toBe("oven-2");
  });
});

describe("errMessage", () => {
  it("returns the message for an Error", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(errMessage("nope")).toBe("nope");
    expect(errMessage(42)).toBe("42");
    expect(errMessage(null)).toBe("null");
  });
});

describe("cleanLabel", () => {
  it("strips control characters and collapses whitespace", () => {
    // A line break inside an appliance name splits a log line and puts a
    // two-line label into the object tree.
    expect(cleanLabel("Geschirr\nspüler\t  oben ")).toBe("Geschirr spüler oben");
    expect(cleanLabel("\u0007Backofen\u009f")).toBe("Backofen");
  });

  it("returns the fallback for non-strings and empty results", () => {
    expect(cleanLabel(undefined, "x")).toBe("x");
    expect(cleanLabel(42, "x")).toBe("x");
    expect(cleanLabel("   \n", "x")).toBe("x");
    expect(cleanLabel("")).toBe("");
  });

  it("caps an overlong label", () => {
    const out = cleanLabel("a".repeat(500));
    expect(out).toHaveLength(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("humanizeId", () => {
  it("turns a camelCase id into a sentence-case label", () => {
    expect(humanizeId("operationState")).toBe("Operation state");
    expect(humanizeId("doorFreezerOpen")).toBe("Door freezer open");
    expect(humanizeId("favorite001ExternalTrigger")).toBe("Favorite 001 external trigger");
  });

  it("keeps a brand spelling like iDos in one piece", () => {
    // "I dos 1 fill level poor" is what a naive split produces — it reads broken.
    expect(humanizeId("iDos1FillLevelPoor")).toBe("iDos 1 fill level poor");
    expect(humanizeId("iDos2Active")).toBe("iDos 2 active");
    // A normal id is untouched: the rule needs a single letter before a capital.
    expect(humanizeId("doorOpen")).toBe("Door open");
    expect(humanizeId("interiorIlluminationActive")).toBe("Interior illumination active");
    expect(humanizeId("saltNearlyEmpty")).toBe("Salt nearly empty");
    expect(humanizeId("x")).toBe("X");
  });
});

describe("coerceForType", () => {
  it("brings script-written text into a boolean switch", () => {
    expect(coerceForType("true", "boolean")).toBe(true);
    expect(coerceForType("0", "boolean")).toBe(false);
    expect(coerceForType(1, "boolean")).toBe(true);
    expect(coerceForType("on", "boolean")).toBe(true);
    expect(coerceForType("maybe", "boolean")).toBeUndefined();
  });

  it("brings text into a number and refuses what is not one", () => {
    expect(coerceForType("40", "number")).toBe(40);
    expect(coerceForType(" 2.5 ", "number")).toBe(2.5);
    expect(coerceForType(true, "number")).toBe(1);
    expect(coerceForType("forty", "number")).toBeUndefined();
    expect(coerceForType("", "number")).toBeUndefined();
    expect(coerceForType(Number.NaN, "number")).toBeUndefined();
  });

  it("stringifies for a string state and passes through when the type is unknown", () => {
    expect(coerceForType(7, "string")).toBe("7");
    expect(coerceForType("run", undefined)).toBe("run");
    expect(coerceForType(null, "boolean")).toBeUndefined();
  });
});
