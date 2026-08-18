import { describe, it, expect } from "vitest";
import { planLegacyCleanup, type CleanupObject } from "./legacy-cleanup";

const state = (): CleanupObject => ({ type: "state", native: {} });

describe("planLegacyCleanup", () => {
  it("flags an old-generation haId tree (upper-case root) for removal", () => {
    const objects = {
      "SIEMENS-HCS02DWH1-0123456789AB": { type: "folder", native: {} },
      "SIEMENS-HCS02DWH1-0123456789AB.status.BSH_Common_Status_DoorState": state(),
      "SIEMENS-HCS02DWH1-0123456789AB.settings.BSH_Common_Setting_PowerState": state(),
      "BOSCH-WTX87K90-0011223344556677.status.BSH_Common_Status_OperationState": state(),
    };
    expect(planLegacyCleanup(objects)).toEqual([
      "BOSCH-WTX87K90-0011223344556677",
      "SIEMENS-HCS02DWH1-0123456789AB",
    ]);
  });

  it("never touches auth, info, or our own speaking device trees", () => {
    const objects = {
      "auth.session": state(),
      "auth.verificationUrl": state(),
      "info.connection": state(),
      geschirrspueler: { type: "device", native: { haId: "SIEMENS-HCS02DWH1-0123456789AB" } },
      "geschirrspueler.status.doorState": state(),
      "geschirrspueler.info.reachable": state(),
      "geschirrspueler.programs.selectedProgram": state(),
    };
    expect(planLegacyCleanup(objects)).toEqual([]);
  });

  it("catches a legacy tree via its underscored raw-key leaves even with a lower-case root", () => {
    const objects = {
      "somedevice.status.BSH_Common_Status_DoorState": state(),
      "somedevice.events.Dishcare_Dishwasher_Event_SaltNearlyEmpty": state(),
    };
    expect(planLegacyCleanup(objects)).toEqual(["somedevice"]);
  });

  it("does not flag our trees just because a root object is missing", () => {
    // A speaking tree whose device object was not returned (edge): camelCase
    // leaves carry no underscore fingerprint → left alone.
    const objects = {
      "waschtrockner.status.operationState": state(),
      "waschtrockner.options.spinSpeed": state(),
      "waschtrockner.programs.start": state(),
    };
    expect(planLegacyCleanup(objects)).toEqual([]);
  });

  it("handles the mixed picture of an update: old tree goes, new tree and auth stay", () => {
    const objects = {
      "auth.session": state(),
      "info.connection": state(),
      "SIEMENS-HCS02DWH1-0123456789AB.programs.selected.options.BSH_Common_Option_StartInRelative": state(),
      geschirrspueler: { type: "device", native: { haId: "SIEMENS-HCS02DWH1-0123456789AB" } },
      "geschirrspueler.status.doorState": state(),
    };
    expect(planLegacyCleanup(objects)).toEqual(["SIEMENS-HCS02DWH1-0123456789AB"]);
  });
});
