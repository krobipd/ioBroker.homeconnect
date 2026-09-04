import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vi, describe, it, expect } from "vitest";

// adapter-core's I18n needs init() with a real adapter; the tests feed it the
// shipped admin/i18n files directly, so translated names are the real ones.
vi.mock("@iobroker/adapter-core", () => {
  const i18nDir = join(__dirname, "../../admin/i18n");
  const i18nData: Record<string, Record<string, string>> = {};
  for (const f of readdirSync(i18nDir).filter(f => f.endsWith(".json"))) {
    i18nData[f.replace(".json", "")] = JSON.parse(readFileSync(join(i18nDir, f), "utf8"));
  }
  const fill = (text: string, args: unknown[]): string =>
    args.reduce<string>((t, a) => t.replace("%s", String(a)), text);
  return {
    I18n: {
      getTranslatedObject: (key: string, ...args: unknown[]) => {
        const result: Record<string, string> = {};
        for (const [lang, translations] of Object.entries(i18nData)) {
          result[lang] = fill(translations[key] ?? key, args);
        }
        return result;
      },
      translate: (key: string, ...args: unknown[]) => fill(i18nData.en?.[key] ?? key, args),
    },
  };
});

import {
  shortEnum,
  stateIdForKey,
  transformItem,
  transformOptionDefinition,
  parseConstraints,
  expandBshItem,
  isDoorStatusKey,
} from "./value-transformer";

describe("parseConstraints", () => {
  it("returns undefined when there is no constraints object", () => {
    expect(parseConstraints(undefined)).toBeUndefined();
    expect(parseConstraints("nope")).toBeUndefined();
    expect(parseConstraints(["a"])).toBeUndefined();
  });

  it("parses numeric bounds, allowed + display values and passes the default through", () => {
    expect(
      parseConstraints({
        min: 0,
        max: 8,
        allowedvalues: ["A", "B"],
        displayvalues: ["a", "b"],
        default: "A",
      }),
    ).toEqual({ min: 0, max: 8, allowedvalues: ["A", "B"], displayvalues: ["a", "b"], default: "A" });
  });

  it("drops non-numeric bounds and non-array value lists (API drift safe)", () => {
    expect(parseConstraints({ min: "0", max: null, allowedvalues: "A" })).toEqual({
      min: undefined,
      max: undefined,
      allowedvalues: undefined,
      displayvalues: undefined,
      default: undefined,
    });
  });
});

describe("shortEnum", () => {
  it("takes the lower-case tail of a dotted BSH value", () => {
    expect(shortEnum("BSH.Common.EnumType.OperationState.Run")).toBe("run");
    expect(shortEnum("LaundryCare.Washer.Program.Cotton")).toBe("cotton");
  });
});

describe("stateIdForKey", () => {
  it("maps kind to channel and lower-cases the name", () => {
    expect(stateIdForKey("BSH.Common.Status.OperationState")).toEqual({ channel: "status", id: "operationState" });
    expect(stateIdForKey("Dishcare.Dishwasher.Event.SaltNearlyEmpty")).toEqual({
      channel: "events",
      id: "saltNearlyEmpty",
    });
    expect(stateIdForKey("BSH.Common.Setting.PowerState")).toEqual({ channel: "settings", id: "powerState" });
    expect(stateIdForKey("BSH.Common.Root.ActiveProgram")).toEqual({ channel: "programs", id: "activeProgram" });
  });
});

describe("transformItem", () => {
  it("turns an event's EventPresentState into a boolean", () => {
    const present = transformItem({
      key: "BSH.Common.Event.ProgramFinished",
      value: "BSH.Common.EnumType.EventPresentState.Present",
    });
    expect(present).toMatchObject({ channel: "events", id: "programFinished", value: true });
    expect(present.common).toMatchObject({ type: "boolean", read: true, write: false });

    const off = transformItem({
      key: "BSH.Common.Event.ProgramFinished",
      value: "BSH.Common.EnumType.EventPresentState.Off",
    });
    expect(off.value).toBe(false);
  });

  it("turns a known enum into a short value with curated states", () => {
    const op = transformItem({
      key: "BSH.Common.Status.OperationState",
      value: "BSH.Common.EnumType.OperationState.Run",
    });
    expect(op).toMatchObject({ channel: "status", id: "operationState", value: "run" });
    expect(op.common.type).toBe("string");
    expect(op.common.states).toMatchObject({ run: "Running", finished: "Finished" });
  });

  it("shortens an enum without a curated states map (still lossless)", () => {
    const door = transformItem({ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" });
    expect(door.value).toBe("open");
    expect(door.common.states).toBeUndefined();
  });

  it("keeps a number and carries unit + constraints", () => {
    const t = transformItem({
      key: "BSH.Common.Option.RemainingProgramTime",
      value: 3600,
      unit: "seconds",
      constraints: { min: 0, max: 86400 },
    });
    expect(t).toMatchObject({ channel: "options", id: "remainingProgramTime", value: 3600 });
    expect(t.common).toMatchObject({ type: "number", role: "value", unit: "seconds", min: 0, max: 86400 });
  });

  it("keeps a native boolean", () => {
    const t = transformItem({ key: "BSH.Common.Status.RemoteControlActive", value: true });
    expect(t).toMatchObject({ channel: "status", id: "remoteControlActive", value: true });
    expect(t.common.type).toBe("boolean");
  });

  it("shortens an active program key", () => {
    const t = transformItem({ key: "BSH.Common.Root.ActiveProgram", value: "LaundryCare.Washer.Program.Cotton" });
    expect(t).toMatchObject({ channel: "programs", id: "activeProgram", value: "cotton" });
  });

  it("falls back to the raw value for an unknown string, losing nothing", () => {
    const t = transformItem({ key: "Cooking.Oven.Status.SomethingNew", value: "Cooking.Oven.SomethingRaw" });
    // Contains no ".EnumType." / ".Program." → kept as-is.
    expect(t.value).toBe("Cooking.Oven.SomethingRaw");
    expect(t.common.type).toBe("string");
  });

  it("makes a setting boolean writable with a switch role", () => {
    const t = transformItem({ key: "BSH.Common.Setting.ChildLock", value: false });
    expect(t.common).toMatchObject({ type: "boolean", role: "switch", read: true, write: true });
  });

  it("makes a setting number writable with a level role", () => {
    const t = transformItem({
      key: "Refrigeration.FridgeFreezer.Setting.SetpointTemperatureRefrigerator",
      value: 4,
      unit: "°C",
      constraints: { min: 2, max: 8 },
    });
    expect(t.common).toMatchObject({ type: "number", role: "level", read: true, write: true, min: 2, max: 8 });
  });

  it("carries the constraints' step size into common.step", () => {
    const t = transformItem({
      key: "Refrigeration.FridgeFreezer.Setting.SetpointTemperatureRefrigerator",
      value: 4,
      unit: "°C",
      constraints: { min: 2, max: 8, stepsize: 1 },
    });
    expect(t.common.step).toBe(1);
  });

  it("keeps a setting the API marks access:'read' read-only", () => {
    const t = transformItem({
      key: "BSH.Common.Setting.AmbientLightBrightness",
      value: 70,
      constraints: { min: 0, max: 100, access: "read" },
    });
    expect(t.common.write).toBe(false);
    expect(t.common.role).toBe("value");
  });

  it("keeps a setting with access:'readWrite' writable", () => {
    const t = transformItem({
      key: "BSH.Common.Setting.ChildLock",
      value: false,
      constraints: { access: "readWrite" },
    });
    expect(t.common).toMatchObject({ write: true, role: "switch" });
  });

  it("makes a setting enum writable with states + candidate values from allowedvalues", () => {
    const t = transformItem({
      key: "BSH.Common.Setting.PowerState",
      value: "BSH.Common.EnumType.PowerState.On",
      constraints: { allowedvalues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"] },
    });
    expect(t).toMatchObject({ channel: "settings", id: "powerState", value: "on" });
    expect(t.common).toMatchObject({ role: "text", write: true, states: { on: "On", standby: "Standby" } });
    expect(t.bshValues).toEqual(["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"]);
  });

  it("makes the selected program writable and keeps the full program keys for write-back", () => {
    const t = transformItem({
      key: "BSH.Common.Root.SelectedProgram",
      value: "Dishcare.Dishwasher.Program.Eco50",
      constraints: { allowedvalues: ["Dishcare.Dishwasher.Program.Eco50", "Dishcare.Dishwasher.Program.Auto2"] },
    });
    expect(t).toMatchObject({ channel: "programs", id: "selectedProgram", value: "eco50" });
    expect(t.common.write).toBe(true);
    expect(t.bshValues).toEqual(["Dishcare.Dishwasher.Program.Eco50", "Dishcare.Dishwasher.Program.Auto2"]);
  });

  it("leaves the active program read-only with no candidate values", () => {
    const t = transformItem({ key: "BSH.Common.Root.ActiveProgram", value: "LaundryCare.Washer.Program.Cotton" });
    expect(t.common.write).toBe(false);
    expect(t.bshValues).toBeUndefined();
  });

  it("leaves a status enum read-only (no write-back candidates)", () => {
    const t = transformItem({
      key: "BSH.Common.Status.OperationState",
      value: "BSH.Common.EnumType.OperationState.Run",
    });
    expect(t.common.write).toBe(false);
    expect(t.bshValues).toBeUndefined();
  });
});

describe("transformOptionDefinition", () => {
  it("makes a Boolean option a writable switch", () => {
    const t = transformOptionDefinition({
      key: "Dishcare.Dishwasher.Option.IntensivZone",
      name: "Intensive zone",
      type: "Boolean",
    });
    expect(t).toMatchObject({ channel: "options", id: "intensivZone", value: false });
    expect(t.common).toMatchObject({ type: "boolean", role: "switch", read: true, write: true });
  });

  it("derives type from option.type (Int), not from a value, with unit + bounds + default", () => {
    const t = transformOptionDefinition({
      key: "BSH.Common.Option.StartInRelative",
      name: "Start in",
      type: "Int",
      unit: "seconds",
      constraints: { min: 0, max: 86400, default: 3600 },
    });
    expect(t.common).toMatchObject({ type: "number", role: "level", write: true, unit: "seconds", min: 0, max: 86400 });
    expect(t.value).toBe(3600);
  });

  it("labels an enum option from the parallel displayvalues and keeps full values for write-back", () => {
    const t = transformOptionDefinition({
      key: "LaundryCare.Washer.Option.SpinSpeed",
      name: "Spin speed",
      type: "LaundryCare.Washer.EnumType.SpinSpeed",
      constraints: {
        allowedvalues: [
          "LaundryCare.Washer.EnumType.SpinSpeed.RPM800",
          "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200",
        ],
        displayvalues: ["800 rpm", "1200 rpm"],
        default: "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200",
      },
    });
    expect(t).toMatchObject({ channel: "options", id: "spinSpeed", value: "rpm1200" });
    expect(t.common).toMatchObject({ write: true, states: { rpm800: "800 rpm", rpm1200: "1200 rpm" } });
    expect(t.bshValues).toEqual([
      "LaundryCare.Washer.EnumType.SpinSpeed.RPM800",
      "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200",
    ]);
  });

  it("falls back to the short value as its own label when no displayvalues are given", () => {
    const t = transformOptionDefinition({
      key: "Cooking.Oven.Option.WarmingLevel",
      type: "Cooking.Oven.EnumType.WarmingLevel",
      constraints: { allowedvalues: ["Cooking.Oven.EnumType.WarmingLevel.Low"] },
    });
    expect(t.common.states).toEqual({ low: "low" });
  });
});

describe("value-transformer edge inputs", () => {
  it("keeps a key with no dots usable", () => {
    // Anything the API adds later that does not follow the four-part shape must
    // still land somewhere addressable instead of producing an empty id.
    expect(stateIdForKey("Weird")).toEqual({ channel: "misc", id: "weird" });
    expect(shortEnum("Plain")).toBe("plain");
    expect(shortEnum("")).toBe("");
  });

  it("ignores constraint fields of the wrong type", () => {
    // These come straight off the wire. A string min would end up in common.min
    // and make the admin slider unusable.
    const c = parseConstraints({ min: "5", max: null, stepsize: "1", allowedvalues: "x", access: 7, default: 3 });
    expect(c).toMatchObject({ min: undefined, max: undefined, stepsize: undefined, allowedvalues: undefined });
    expect(c?.access).toBeUndefined();
    expect(c?.default).toBe(3);
    expect(parseConstraints(undefined)).toBeUndefined();
  });

  it("turns a value it cannot classify into a lossless string", () => {
    // Nothing may be silently dropped: an unknown shape is still shown.
    const t = transformItem({ key: "BSH.Common.Status.Something", value: { a: 1 } });
    expect(t.common.type).toBe("string");
    expect(t.value).toBe('{"a":1}');
  });

  it("gives a writable enum its candidates even without an allowed list", () => {
    // A settings enum whose constraints the API omitted still has to resolve a
    // short write back to its full BSH value.
    const t = transformItem({ key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.On" });
    expect(t.value).toBe("on");
    expect(t.bshValues).toEqual(["BSH.Common.EnumType.PowerState.On"]);
  });

  it("gives a read-only enum no candidates", () => {
    const t = transformItem({
      key: "BSH.Common.Status.OperationState",
      value: "BSH.Common.EnumType.OperationState.Run",
      constraints: { access: "read" },
    });
    expect(t.common.write).toBe(false);
    expect(t.bshValues).toBeUndefined();
  });

  it("carries unit and bounds onto a numeric item", () => {
    const t = transformItem({
      key: "Cooking.Oven.Setting.SetpointTemperature",
      value: 200,
      unit: "°C",
      constraints: { min: 30, max: 300, stepsize: 5 },
    });
    expect(t.common).toMatchObject({ type: "number", unit: "°C", min: 30, max: 300, step: 5 });
  });

  it("seeds a numeric option from its default, else its minimum, else zero", () => {
    const mk = (constraints: Record<string, unknown>): unknown =>
      transformOptionDefinition({ key: "X.Option.Y", type: "Int", constraints: parseConstraints(constraints) }).value;
    expect(mk({ default: 7, min: 1 })).toBe(7);
    expect(mk({ min: 1 })).toBe(1);
    expect(mk({})).toBe(0);
  });
});

describe("stateIdForKey — nested keys land in their real channel", () => {
  it("routes the kind segment wherever it sits in the key", () => {
    expect(stateIdForKey("Refrigeration.Common.Status.Door.Freezer")).toEqual({
      channel: "status",
      id: "doorFreezer",
    });
    expect(stateIdForKey("Refrigeration.Common.Setting.Light.Internal.Brightness")).toEqual({
      channel: "settings",
      id: "lightInternalBrightness",
    });
    expect(stateIdForKey("BSH.Common.Option.SmartEnergyService.SmartStartEnabled")).toEqual({
      channel: "options",
      id: "smartEnergyServiceSmartStartEnabled",
    });
    expect(stateIdForKey("BSH.Common.Event.Favorite.001.ExternalTrigger")).toEqual({
      channel: "events",
      id: "favorite001ExternalTrigger",
    });
    expect(stateIdForKey("ConsumerProducts.CleaningRobot.Event.DustBin.NotInstalled")).toEqual({
      channel: "events",
      id: "dustBinNotInstalled",
    });
  });

  it("keeps the simple two-segment form unchanged", () => {
    expect(stateIdForKey("BSH.Common.Status.OperationState")).toEqual({ channel: "status", id: "operationState" });
    expect(stateIdForKey("Dishcare.Dishwasher.Event.SaltNearlyEmpty")).toEqual({
      channel: "events",
      id: "saltNearlyEmpty",
    });
  });

  it("a nested SETTING is writable again (the misc mis-channeling made it read-only)", () => {
    const t = transformItem({ key: "Refrigeration.Common.Setting.Light.Internal.Brightness", value: 70 });
    expect(t.channel).toBe("settings");
    expect(t.common.write).toBe(true);
  });
});

describe("expandBshItem — doors and the derived programRunning", () => {
  it("turns the common DoorState into a doorOpen boolean", () => {
    const states = expandBshItem(
      { key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" },
      false,
    );
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ channel: "status", id: "doorOpen", value: true });
    expect(states[0]?.common.type).toBe("boolean");
  });

  it("adds doorLocked only for a lockable-door appliance type", () => {
    const locked = expandBshItem(
      { key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Locked" },
      true,
    );
    expect(locked.map(s => s.id)).toEqual(["doorOpen", "doorLocked"]);
    expect(locked[0]?.value).toBe(false);
    expect(locked[1]?.value).toBe(true);
  });

  it("maps a per-compartment door to its own <compartment>Open boolean", () => {
    const states = expandBshItem(
      { key: "Refrigeration.Common.Status.Door.Freezer", value: "BSH.Common.EnumType.DoorState.Closed" },
      false,
    );
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ channel: "status", id: "doorFreezerOpen", value: false });
  });

  it("leaves a door SETTING on the generic path", () => {
    expect(isDoorStatusKey("Refrigeration.Common.Setting.Door.AssistantFreezer")).toBe(false);
    expect(isDoorStatusKey("BSH.Common.Status.DoorState")).toBe(true);
    expect(isDoorStatusKey("Refrigeration.Common.Status.Door.Refrigerator")).toBe(true);
  });

  it("derives programRunning from the operation state", () => {
    const run = expandBshItem(
      { key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Run" },
      false,
    );
    expect(run.map(s => s.id)).toEqual(["operationState", "programRunning"]);
    expect(run[1]?.value).toBe(true);
    const ready = expandBshItem(
      { key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Ready" },
      false,
    );
    expect(ready[1]?.value).toBe(false);
  });

  it("passes every other item through 1:1", () => {
    const states = expandBshItem({ key: "BSH.Common.Setting.ChildLock", value: true }, true);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ channel: "settings", id: "childLock", value: true });
  });
});

describe("display names and descriptions", () => {
  it("uses the cloud's localized name and keeps the BSH key as desc", () => {
    const t = transformItem({
      key: "BSH.Common.Status.OperationState",
      name: "Betriebszustand",
      value: "BSH.Common.EnumType.OperationState.Run",
    });
    // The object browser shows the cloud name and our own explanation — never
    // the manufacturer's key, which says nothing to a user.
    expect(t.common.name).toBe("Betriebszustand");
    expect(t.common.desc).toMatchObject({ en: "Operating state: off, ready, running, paused, finished, fault." });
    expect(t.nameSource).toBe("api");
  });

  it("names a catalog event itself, in every language, with a short explanation", () => {
    const t = transformItem({ key: "Dishcare.Dishwasher.Event.SaltNearlyEmpty", value: undefined });
    expect(t.common.name).toMatchObject({ en: "Salt nearly empty", de: "Salz fast leer" });
    expect(t.common.desc).toMatchObject({ de: "Reicht noch für wenige Spülgänge." });
    expect(t.nameSource).toBe("i18n");
  });

  it("cleans a name with a line break instead of storing it", () => {
    const t = transformItem({ key: "BSH.Common.Setting.ChildLock", name: "Kinder\nsicherung", value: false });
    expect(t.common.name).toBe("Kinder sicherung");
  });

  it("names the synthetic program states itself, as translation objects", () => {
    const sel = transformItem({ key: "BSH.Common.Root.SelectedProgram", value: "" });
    expect(sel.common.name).toMatchObject({ en: "Selected program", de: "Gewähltes Programm" });
    expect(sel.nameSource).toBe("i18n");
    const act = transformItem({ key: "BSH.Common.Root.ActiveProgram", value: "" });
    expect(act.common.name).toMatchObject({ en: "Active program" });
  });

  it("names the derived door and running states as translation objects", () => {
    const door = expandBshItem(
      { key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" },
      true,
    );
    expect(door[0]?.common.name).toMatchObject({ en: "Door open", de: "Tür offen" });
    expect(door[1]?.common.name).toMatchObject({ en: "Door locked" });
    expect(door[0]?.common.desc).toMatchObject({ de: "Wahr, solange die Tür offen steht." });
    const freezer = expandBshItem(
      { key: "Refrigeration.Common.Status.Door.Freezer", value: "BSH.Common.EnumType.DoorState.Closed" },
      false,
    );
    expect(freezer[0]?.common.name).toMatchObject({ en: "Freezer door open", de: "Tür Gefrierfach offen" });
    const run = expandBshItem(
      { key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Run" },
      false,
    );
    expect(run[1]?.common.name).toMatchObject({ en: "Program running" });
  });

  it("labels a setting's choices with the cloud's display values when it sends them", () => {
    const t = transformItem({
      key: "BSH.Common.Setting.PowerState",
      value: "BSH.Common.EnumType.PowerState.On",
      constraints: {
        allowedvalues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"],
        displayvalues: ["Ein", "Bereitschaft"],
      },
    });
    // Localized labels from the API beat the curated English list.
    expect(t.common.states).toEqual({ on: "Ein", standby: "Bereitschaft" });
  });

  it("keeps the curated labels when the display values do not line up", () => {
    const t = transformItem({
      key: "BSH.Common.Setting.PowerState",
      value: "BSH.Common.EnumType.PowerState.On",
      constraints: {
        allowedvalues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"],
        displayvalues: ["Ein"],
      },
    });
    expect(t.common.states).toMatchObject({ on: "On", standby: "Standby" });
  });

  it("names an option from its definition, without inventing an explanation", () => {
    const t = transformOptionDefinition({
      key: "LaundryCare.Washer.Option.SpinSpeed",
      name: "Schleuderdrehzahl",
      type: "Int",
    });
    expect(t.common.name).toBe("Schleuderdrehzahl");
    // An option only one appliance family has: the adapter has nothing to
    // explain about it, so it says nothing instead of dumping the BSH key.
    expect(t.common.desc).toBeUndefined();
    // One it does know carries the explanation.
    const known = transformOptionDefinition({ key: "BSH.Common.Option.ProgramProgress", type: "Int" });
    expect(known.common.desc).toMatchObject({ de: "Fortschritt in Prozent." });
    // No name from the cloud: the adapter's own translated one takes the place of
    // the English label derived from the key. It stays "derived", so a cloud name
    // arriving later still wins.
    const bare = transformOptionDefinition({ key: "LaundryCare.Washer.Option.SpinSpeed", type: "Int" });
    expect(bare.common.name).toMatchObject({ de: "Schleuderdrehzahl", en: "Spin speed" });
    expect(bare.nameSource).toBe("derived");
    // A key the adapter has no name for still falls back to the English label.
    const unknown = transformOptionDefinition({ key: "LaundryCare.Washer.Option.MadeUpOne", type: "Int" });
    expect(unknown.common.name).toBe("Made up one");
    expect(unknown.nameSource).toBe("derived");
  });
});

describe("option names where the cloud sends none", () => {
  it("prefers the cloud name, falls back to our translated one, never the other way round", () => {
    // The appliance is on and the definition carries a localized name: that wins.
    const fromCloud = transformOptionDefinition({
      key: "LaundryCare.Washer.Option.Prewash",
      name: "Vorspülen",
      type: "Boolean",
    });
    expect(fromCloud.common.name).toBe("Vorspülen");
    expect(fromCloud.nameSource).toBe("api");

    // The appliance has been off since the tree was built, so no definition and
    // no name ever arrived — our own translated name instead of an English label.
    const fromUs = transformOptionDefinition({ key: "LaundryCare.Washer.Option.Prewash", type: "Boolean" });
    expect(fromUs.common.name).toMatchObject({ de: "Vorwäsche", en: "Prewash", "zh-cn": "预洗" });
    // "derived", so the cloud name still replaces it the moment it arrives.
    expect(fromUs.nameSource).toBe("derived");
  });

  it("covers every appliance family, not only the ones we can test with", () => {
    for (const key of [
      "Dishcare.Dishwasher.Option.IntensivZone",
      "Cooking.Oven.Option.FastPreHeat",
      "ConsumerProducts.CoffeeMaker.Option.CoffeeStrength",
      "ConsumerProducts.CleaningRobot.Option.SuctionPower",
      "HeatingVentilationAirConditioning.AirConditioner.Option.FanSpeedPercentage",
      "LaundryCare.Dryer.Option.DryingTarget",
    ]) {
      const t = transformOptionDefinition({ key, type: "Boolean" });
      expect(typeof t.common.name, key).toBe("object");
    }
  });
});

describe("compartment doors of a refrigeration appliance", () => {
  it("names every known compartment in every language, not with the raw key segment", () => {
    const expected: Record<string, { de: string; en: string }> = {
      Refrigerator: { de: "Tür Kühlfach offen", en: "Refrigerator door open" },
      Freezer: { de: "Tür Gefrierfach offen", en: "Freezer door open" },
      BottleCooler: { de: "Tür Flaschenkühler offen", en: "Bottle cooler door open" },
      ChillerLeft: { de: "Tür Kaltfach links offen", en: "Left chiller door open" },
      WineCompartment: { de: "Tür Weinfach offen", en: "Wine compartment door open" },
      FlexCompartment: { de: "Tür Flexfach offen", en: "Flex compartment door open" },
    };
    for (const [segment, texts] of Object.entries(expected)) {
      const [t] = expandBshItem({ key: `Refrigeration.Common.Status.Door.${segment}`, value: undefined }, false);
      expect(t.id, segment).toBe(`door${segment}Open`);
      expect(t.common.name, segment).toMatchObject(texts);
    }
  });

  it("falls back to the placeholder for a compartment the catalogue does not know", () => {
    // A new compartment must not break — it just arrives in English until it is
    // added to the table.
    const [t] = expandBshItem({ key: "Refrigeration.Common.Status.Door.SnackDrawer", value: undefined }, false);
    expect(t.common.name).toMatchObject({ en: "Door SnackDrawer open" });
  });
});
