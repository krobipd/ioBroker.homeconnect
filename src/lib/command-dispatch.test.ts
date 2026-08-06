import { describe, it, expect } from "vitest";
import { resolveWrite } from "./command-dispatch";

const HA = "SIEMENS-HCS02DWH1-0123456789AB";
const base = `/api/homeappliances/${HA}`;

describe("resolveWrite", () => {
  it("writes a boolean setting through as-is", () => {
    expect(resolveWrite({ haId: HA, channel: "settings", id: "childLock", bshKey: "BSH.Common.Setting.ChildLock", value: true })).toEqual({
      method: "PUT",
      path: `${base}/settings/BSH.Common.Setting.ChildLock`,
      body: { key: "BSH.Common.Setting.ChildLock", value: true },
    });
  });

  it("resolves a short enum setting back to its full BSH value", () => {
    const req = resolveWrite({
      haId: HA,
      channel: "settings",
      id: "powerState",
      bshKey: "BSH.Common.Setting.PowerState",
      bshValues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"],
      value: "standby",
    });
    expect(req?.body?.value).toBe("BSH.Common.EnumType.PowerState.Standby");
  });

  it("ignores an enum setting write whose short value matches no candidate", () => {
    expect(
      resolveWrite({
        haId: HA,
        channel: "settings",
        id: "powerState",
        bshKey: "BSH.Common.Setting.PowerState",
        bshValues: ["BSH.Common.EnumType.PowerState.On"],
        value: "bogus",
      }),
    ).toBeNull();
  });

  it("fires a command only on a true write", () => {
    const key = "BSH.Common.Command.PauseProgram";
    expect(resolveWrite({ haId: HA, channel: "commands", id: "pauseProgram", bshKey: key, value: true })).toEqual({
      method: "PUT",
      path: `${base}/commands/${key}`,
      body: { key, value: true },
    });
    expect(resolveWrite({ haId: HA, channel: "commands", id: "pauseProgram", bshKey: key, value: false })).toBeNull();
  });

  it("selects a program by resolving the short value to its full program key", () => {
    const req = resolveWrite({
      haId: HA,
      channel: "programs",
      id: "selectedProgram",
      bshKey: "BSH.Common.Root.SelectedProgram",
      bshValues: ["Dishcare.Dishwasher.Program.Eco50", "Dishcare.Dishwasher.Program.Auto2"],
      value: "auto2",
    });
    expect(req).toEqual({ method: "PUT", path: `${base}/programs/selected`, body: { key: "Dishcare.Dishwasher.Program.Auto2" } });
  });

  it("starts the currently selected program", () => {
    expect(
      resolveWrite({ haId: HA, channel: "programs", id: "start", value: true, selectedProgramKey: "Dishcare.Dishwasher.Program.Eco50" }),
    ).toEqual({ method: "PUT", path: `${base}/programs/active`, body: { key: "Dishcare.Dishwasher.Program.Eco50" } });
  });

  it("ignores start when no program is selected", () => {
    expect(resolveWrite({ haId: HA, channel: "programs", id: "start", value: true })).toBeNull();
  });

  it("stops the active program with a DELETE", () => {
    expect(resolveWrite({ haId: HA, channel: "programs", id: "stop", value: true })).toEqual({
      method: "DELETE",
      path: `${base}/programs/active`,
    });
  });

  it("ignores an unrecognized state", () => {
    expect(resolveWrite({ haId: HA, channel: "status", id: "operationState", value: "run" })).toBeNull();
  });
});
