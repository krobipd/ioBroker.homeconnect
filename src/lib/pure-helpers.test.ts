import { describe, it, expect } from "vitest";
import { slugify, disambiguateSlug, errMessage } from "./pure-helpers";

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
