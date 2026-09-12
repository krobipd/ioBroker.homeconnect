import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deviceIcon, ICON_BY_TYPE } from "./device-icons";

const ICON_DIR = join(__dirname, "..", "..", "admin", "icons");

describe("deviceIcon", () => {
  it("answers with the path the Admin resolves against the adapter folder", () => {
    // adapter-react-v5 turns this into `adapter/homeconnect/icons/dishwasher.svg`.
    expect(deviceIcon("Dishwasher")).toBe("/icons/dishwasher.svg");
    expect(deviceIcon("WasherDryer")).toBe("/icons/washerdryer.svg");
  });

  it("leaves the field untouched for an appliance type it has no pictogram for", () => {
    // `undefined` rather than "": the deep merge skips undefined, so an unknown
    // type neither invents an icon nor clears one an earlier version set.
    expect(deviceIcon(undefined)).toBeUndefined();
    expect(deviceIcon("Toaster")).toBeUndefined();
  });

  it("does not answer with an inherited property for cloud text", () => {
    // The type is cloud text at an API boundary: a plain lookup would answer
    // `ICON_BY_TYPE["constructor"]` with Object's constructor and build a path
    // out of a function.
    expect(deviceIcon("constructor")).toBeUndefined();
    expect(deviceIcon("__proto__")).toBeUndefined();
    expect(deviceIcon("toString")).toBeUndefined();
  });
});

describe("admin/icons", () => {
  it("has a file for every mapped appliance type and no orphan", () => {
    const onDisk = readdirSync(ICON_DIR)
      .filter(f => f.endsWith(".svg"))
      .sort();
    const mapped = Object.values(ICON_BY_TYPE).sort();
    expect(mapped).toEqual(onDisk);
  });

  it("draws every pictogram as a pure black-and-transparent mask", () => {
    // The Admin INVERTS object icons in its dark theme (measured at krobi's live
    // Admin, hm-rpc 2026-07-18): a black mask comes out white and correct, while
    // a white fill comes out black and a colour comes out negative. So a white
    // cut-out is the one mistake that looks perfect in the light theme and breaks
    // in the dark one — which is why it is asserted rather than remembered.
    const offenders: string[] = [];
    for (const file of Object.values(ICON_BY_TYPE)) {
      const svg = readFileSync(join(ICON_DIR, file), "utf8");
      if (!svg.includes('viewBox="0 0 64 64"')) {
        offenders.push(`${file}: not on the shared 64-unit grid`);
      }
      if (/#fff|white|currentColor/i.test(svg)) {
        offenders.push(`${file}: carries a white or theme-dependent colour`);
      }
      for (const [, attr, value] of svg.matchAll(/(fill|stroke)="([^"]*)"/g)) {
        if (value !== "none" && value !== "#000") {
          offenders.push(`${file}: ${attr}="${value}" is neither #000 nor none`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
