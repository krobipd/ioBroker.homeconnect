import { describe, it, expect } from "vitest";
import { slugify } from "./pure-helpers";

describe("slugify", () => {
  it("transliterates umlauts and lower-cases", () => {
    expect(slugify("Geschirrspüler")).toBe("geschirrspueler");
    expect(slugify("Kühl-Gefrier-Kombination")).toBe("kuehl-gefrier-kombination");
    expect(slugify("Waschtrockner")).toBe("waschtrockner");
    expect(slugify("Straße")).toBe("strasse");
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
