// A pictogram for every appliance type, so the object tree shows WHAT a device
// is before its name is read. The Home Connect appliance list names the type
// ("Dishwasher", "WasherDryer", …) and that is the only input needed — no cloud
// call, no extra datapoint.
//
// Two things decide how the icon reaches the Admin, both measured rather than
// assumed (krobi's live Admin, 2026-09-12, all four themes, pixel-counted on
// the exact 28 px element rectangle):
//
// 1. The Admin does NOT recolour object icons. Its `Icon` component
//    (adapter-react-v5) branches on the VALUE of `common.icon`: a
//    `data:image/svg…` URI is inlined into the DOM through react-inlinesvg,
//    anything else — including the `/icons/<file>.svg` path that v1.19.0 wrote
//    — lands in a plain `<img>` with no filter, no mask, no blend mode
//    (`ObjectBrowser/styles.ts`, `cellIdIconOwn: {}`; no `filter: invert` on
//    object icons anywhere in the admin 7.9.13 and 8.0.12 bundles). A path icon
//    therefore keeps whatever colour is painted in the file: v1.19.0's black
//    strokes were black on both dark themes — 0 pixels lighter than the
//    background, invisible. The earlier belief that "the Admin inverts, so draw
//    a black mask" was wrong and had never been measured.
// 2. Theme-true rendering needs the SVG INLINED, and it needs `currentColor`:
//    inlined markup inherits the row's text colour through `currentColor`, so
//    the same file is light on the dark themes and dark on the light ones. In
//    an `<img>` `currentColor` collapses to black, which is why the path form
//    could never have worked. That is also how hm-rpc 4.0.0 does it. Price:
//    any consumer that puts `common.icon` into an `<img>` or a
//    `background-image` gets a black icon — accepted, the object tree is the
//    one place these icons are made for.
//
// So `deviceIcon()` returns the file itself as a base64 data URI, read once per
// icon and cached (about 0.5 KB per device object). The files in `admin/icons`
// use `stroke`/`fill` of `currentColor` or `none` and nothing else — a fixed
// colour would break one of the two theme families again, and the unit test
// holds that. Drawn for the size they are actually rendered at: the object
// browser shows them at 28 px (`ObjectBrowser/styles.ts`, `ROW_HEIGHT - 4`),
// which is why the shapes are simple line art on a uniform 64-unit grid with a
// 4-unit stroke and no hairlines.
//
// One more thing inlining brings with it: the ID cell's CSS reaches INTO the
// markup — `cellId: { '& *': { width: 'initial' } }` — and for the SVG elements
// whose width is a CSS geometry property (`rect`, `image`, `use`, a nested
// `svg`) `initial` means 0. Measured at the live Admin: a `<rect width="44">`
// frame came out 0 px wide, and hm-rpc 4.0.0's mask icons (rect + image) draw
// nothing at all. So the files contain only `path` and `circle`, frames are
// paths, and the unit test holds that too.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Appliance type (the cloud's own `type` field) → file in `admin/icons`.
 *
 * All seventeen types the adapter knows are present; the inventory test holds
 * that, so a new appliance type can not arrive without its pictogram.
 */
export const ICON_BY_TYPE: Readonly<Record<string, string>> = {
  AirConditioner: "airconditioner.svg",
  CleaningRobot: "cleaningrobot.svg",
  CoffeeMaker: "coffeemaker.svg",
  CookProcessor: "cookprocessor.svg",
  Dishwasher: "dishwasher.svg",
  Dryer: "dryer.svg",
  Freezer: "freezer.svg",
  FridgeFreezer: "fridgefreezer.svg",
  Hob: "hob.svg",
  Hood: "hood.svg",
  Microwave: "microwave.svg",
  Oven: "oven.svg",
  Refrigerator: "refrigerator.svg",
  WarmingDrawer: "warmingdrawer.svg",
  Washer: "washer.svg",
  WasherDryer: "washerdryer.svg",
  WineCooler: "winecooler.svg",
};

/** The prefix the Admin recognises as an inline SVG (`Icon.tsx`). */
export const ICON_URI_PREFIX = "data:image/svg+xml;base64,";

/**
 * Where the files live. This module is `build/lib/` at runtime and `src/lib/`
 * under vitest — two levels below the adapter root either way.
 */
const ICON_DIR = join(__dirname, "..", "..", "admin", "icons");

/** File name → data URI, filled on first use. Failed reads are not cached. */
const iconCache = new Map<string, string>();

/**
 * The `common.icon` value for an appliance type, or `undefined` when the type is
 * unknown or its file can not be read — either way the field is left untouched
 * rather than cleared.
 *
 * `Object.hasOwn` instead of a plain lookup because the type is cloud text at an
 * API boundary: `ICON_BY_TYPE["constructor"]` would answer with an inherited
 * property, not `undefined`.
 *
 * @param type the appliance type from the cloud, if it sent one
 * @returns the inline SVG data URI the Admin renders theme-true, or `undefined`
 */
export function deviceIcon(type: string | undefined): string | undefined {
  if (type === undefined || !Object.hasOwn(ICON_BY_TYPE, type)) {
    return undefined;
  }
  const file = ICON_BY_TYPE[type];
  const cached = iconCache.get(file);
  if (cached !== undefined) {
    return cached;
  }
  // Only the read is guarded: a missing or unreadable file leaves the field
  // untouched, while a non-string `file` (an inherited property that slipped
  // past the guard above) must throw, not vanish.
  const path = join(ICON_DIR, file);
  let svg: string;
  try {
    svg = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const uri = `${ICON_URI_PREFIX}${Buffer.from(normaliseLineEndings(svg)).toString("base64")}`;
  iconCache.set(file, uri);
  return uri;
}

/**
 * The value written to an object must not depend on how the files reached the
 * disk: a Windows checkout with `autocrlf` turns the LF of the repository into
 * CRLF, and the same icon would then differ byte for byte between systems.
 *
 * @param svg the file content as read
 * @returns the content with LF line endings only
 */
export function normaliseLineEndings(svg: string): string {
  return svg.replace(/\r\n/g, "\n");
}
