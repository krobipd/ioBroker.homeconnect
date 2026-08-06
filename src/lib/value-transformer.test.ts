import { describe, it, expect } from "vitest";
import { shortEnum, stateIdForKey, transformItem } from "./value-transformer";

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
});
