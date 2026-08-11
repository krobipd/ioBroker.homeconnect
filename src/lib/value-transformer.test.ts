import { describe, it, expect } from "vitest";
import { shortEnum, stateIdForKey, transformItem, transformOptionDefinition, parseConstraints } from "./value-transformer";

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
    expect(stateIdForKey("Dishcare.Dishwasher.Event.SaltNearlyEmpty")).toEqual({ channel: "events", id: "saltNearlyEmpty" });
    expect(stateIdForKey("BSH.Common.Setting.PowerState")).toEqual({ channel: "settings", id: "powerState" });
    expect(stateIdForKey("BSH.Common.Root.ActiveProgram")).toEqual({ channel: "programs", id: "activeProgram" });
  });
});

describe("transformItem", () => {
  it("turns an event's EventPresentState into a boolean", () => {
    const present = transformItem({ key: "BSH.Common.Event.ProgramFinished", value: "BSH.Common.EnumType.EventPresentState.Present" });
    expect(present).toMatchObject({ channel: "events", id: "programFinished", value: true });
    expect(present.common).toMatchObject({ type: "boolean", read: true, write: false });

    const off = transformItem({ key: "BSH.Common.Event.ProgramFinished", value: "BSH.Common.EnumType.EventPresentState.Off" });
    expect(off.value).toBe(false);
  });

  it("turns a known enum into a short value with curated states", () => {
    const op = transformItem({ key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Run" });
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
    const t = transformItem({ key: "BSH.Common.Option.RemainingProgramTime", value: 3600, unit: "seconds", constraints: { min: 0, max: 86400 } });
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
    const t = transformItem({ key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Run" });
    expect(t.common.write).toBe(false);
    expect(t.bshValues).toBeUndefined();
  });
});

describe("transformOptionDefinition", () => {
  it("makes a Boolean option a writable switch", () => {
    const t = transformOptionDefinition({ key: "Dishcare.Dishwasher.Option.IntensivZone", name: "Intensive zone", type: "Boolean" });
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
        allowedvalues: ["LaundryCare.Washer.EnumType.SpinSpeed.RPM800", "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200"],
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
