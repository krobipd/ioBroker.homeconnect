import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deviceIcon, ICON_BY_TYPE, ICON_URI_PREFIX } from "./device-icons";

const ICON_DIR = join(__dirname, "..", "..", "admin", "icons");

/**
 * What the Admin's `Icon` component does with the value: base64 → markup.
 *
 * @param uri the `common.icon` value
 * @returns the SVG markup the Admin inlines into the DOM
 */
function inlinedMarkup(uri: string): string {
  expect(uri.startsWith(ICON_URI_PREFIX)).toBe(true);
  return Buffer.from(uri.slice(ICON_URI_PREFIX.length), "base64").toString("utf8");
}

describe("deviceIcon", () => {
  it("answers with the file itself as the inline data URI the Admin renders theme-true", () => {
    // adapter-react-v5 `Icon.tsx`: a value starting with `data:image/svg` is
    // inlined into the DOM (react-inlinesvg); anything else lands in a plain
    // `<img>`, where `currentColor` collapses to black. So the URI has to carry
    // the markup itself, byte for byte.
    const uri = deviceIcon("Dishwasher");
    expect(uri).toBeDefined();
    expect(inlinedMarkup(uri as string)).toBe(readFileSync(join(ICON_DIR, "dishwasher.svg"), "utf8"));
    expect(inlinedMarkup(deviceIcon("WasherDryer") as string)).toBe(
      readFileSync(join(ICON_DIR, "washerdryer.svg"), "utf8"),
    );
  });

  it("answers every mapped type with its own file, never with a path", () => {
    // The v1.19.0 form `/icons/<file>.svg` was rendered as an `<img>` and came
    // out black on both dark themes — 0 pixels lighter than the background.
    for (const [type, file] of Object.entries(ICON_BY_TYPE)) {
      const uri = deviceIcon(type);
      expect(uri, type).toBeDefined();
      expect(uri, type).not.toContain("/icons/");
      expect(inlinedMarkup(uri as string), type).toBe(readFileSync(join(ICON_DIR, file), "utf8"));
    }
  });

  it("answers the same value on repeated calls", () => {
    // The file is read once per icon; a device is synced many times a day.
    expect(deviceIcon("Oven")).toBe(deviceIcon("Oven"));
  });

  it("leaves the field untouched for an appliance type it has no pictogram for", () => {
    // `undefined` rather than "": the deep merge skips undefined, so an unknown
    // type neither invents an icon nor clears one an earlier version set.
    expect(deviceIcon(undefined)).toBeUndefined();
    expect(deviceIcon("Toaster")).toBeUndefined();
  });

  it("does not answer with an inherited property for cloud text", () => {
    // The type is cloud text at an API boundary: a plain lookup would answer
    // `ICON_BY_TYPE["constructor"]` with Object's constructor and try to read a
    // file named after a function.
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

  it("paints every pictogram in currentColor and nothing else", () => {
    // Inlined SVG inherits the row's text colour through `currentColor` — that
    // is the whole mechanism (measured at krobi's live Admin, 2026-09-12, all
    // four themes). A fixed colour looks perfect in one theme family and is
    // invisible in the other: v1.19.0 shipped `#000` strokes and was black on
    // black in both dark themes. So the colour rule is asserted, not remembered.
    const offenders: string[] = [];
    for (const file of Object.values(ICON_BY_TYPE)) {
      const svg = readFileSync(join(ICON_DIR, file), "utf8");
      if (!svg.includes('viewBox="0 0 64 64"')) {
        offenders.push(`${file}: not on the shared 64-unit grid`);
      }
      if (!svg.includes("currentColor")) {
        offenders.push(`${file}: paints nothing in currentColor`);
      }
      if (/#[0-9a-f]{3,8}\b|\b(?:black|white)\b|rgb\(/i.test(svg)) {
        offenders.push(`${file}: carries a fixed colour`);
      }
      for (const [, attr, value] of svg.matchAll(/(fill|stroke)="([^"]*)"/g)) {
        if (value !== "none" && value !== "currentColor") {
          offenders.push(`${file}: ${attr}="${value}" is neither currentColor nor none`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("draws with elements the ObjectBrowser's cell CSS cannot collapse", () => {
    // adapter-react-v5 `ObjectBrowser/styles.ts`, `cellId`: `'& *': { width: 'initial' }`.
    // Once the SVG is inlined, that rule reaches its children, and for the SVG
    // elements whose width is a CSS geometry property — `rect`, `image`, `use`,
    // a nested `svg` — `initial` means 0: the element vanishes. Measured at
    // krobi's live Admin 2026-09-12: a `<rect width="44">` came out 0 px wide
    // (and hm-rpc 4.0.0's mask icons, rect + image, draw nothing at all).
    // Frames are therefore paths; circles and paths carry no `width`.
    const offenders: string[] = [];
    for (const file of Object.values(ICON_BY_TYPE)) {
      const body = readFileSync(join(ICON_DIR, file), "utf8").replace(/^\s*<svg\b[^>]*>/, "");
      for (const [, tag] of body.matchAll(/<(rect|image|use|svg|foreignObject)\b/g)) {
        offenders.push(`${file}: <${tag}> collapses to width 0 in the object browser`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
