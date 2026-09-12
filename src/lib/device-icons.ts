// A pictogram for every appliance type, so the object tree shows WHAT a device
// is before its name is read. The Home Connect appliance list names the type
// ("Dishwasher", "WasherDryer", …) and that is the only input needed — no cloud
// call, no extra datapoint.
//
// Two things decide how these files are drawn, both measured rather than assumed:
//
// 1. The Admin renders an object icon as a plain `<img>` and resolves a relative
//    path against the adapter's own admin folder: for `homeconnect.0.<device>`
//    it builds `adapter/homeconnect` + the icon (adapter-react-v5,
//    `getSelectIdIconFromObjects`, `id.split('.', 2)`). A leading slash is
//    handled there, so `/icons/<file>.svg` lands on `admin/icons/<file>.svg`.
// 2. The Admin INVERTS object icons in its dark theme. Measured at krobi's live
//    Admin on 2026-07-18 while fixing the same problem in hm-rpc: black masks
//    came out white and correct, while coloured or white-filled icons came out
//    negative and broken. So every file here is a pure black-and-transparent
//    mask — `#000` strokes, nothing else, and never a white fill as a cut-out
//    (white would invert to black and break in the opposite theme; a hole is
//    unpainted area).
//
// Drawn for the size they are actually rendered at: the object browser shows
// them at 28 px (`ObjectBrowser/styles.ts`, `ROW_HEIGHT - 4`), which is why the
// shapes are simple line art on a uniform 64-unit grid with a 4-unit stroke and
// no hairlines.

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

/**
 * The `common.icon` value for an appliance type, or `undefined` when the type is
 * unknown — an unknown type leaves the field untouched rather than clearing it.
 *
 * `Object.hasOwn` instead of a plain lookup because the type is cloud text at an
 * API boundary: `ICON_BY_TYPE["constructor"]` would answer with an inherited
 * property, not `undefined`.
 *
 * @param type the appliance type from the cloud, if it sent one
 * @returns the path the Admin resolves against `admin/`, or `undefined`
 */
export function deviceIcon(type: string | undefined): string | undefined {
  if (type === undefined || !Object.hasOwn(ICON_BY_TYPE, type)) {
    return undefined;
  }
  return `/icons/${ICON_BY_TYPE[type]}`;
}
