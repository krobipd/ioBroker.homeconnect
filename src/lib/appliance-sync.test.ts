import { describe, it, expect, beforeEach } from "vitest";
import { ApplianceSync, type AdapterPort } from "./appliance-sync";
import type { WriteRequest } from "./command-dispatch";
import type { JsonResult } from "./http";

const NS = "homeconnect.0";
const ok: JsonResult = { status: 204, ok: true, data: undefined, error: undefined };

/** A recording in-memory AdapterPort — no adapter, no network. */
class FakePort implements AdapterPort {
  readonly namespace = NS;
  readonly log = { debug() {}, info() {}, warn() {}, error() {}, silly() {} } as unknown as ioBroker.Logger;

  readonly objects = new Map<string, ioBroker.PartialObject>();
  readonly states = new Map<string, ioBroker.StateValue>();
  readonly deleted: string[] = [];
  readonly writes: WriteRequest[] = [];
  readonly getCalls: string[] = [];

  /** path → unwrapped data; absent ⇒ apiGet resolves undefined (a failure). */
  readonly getResponses = new Map<string, unknown>();
  writeResult: JsonResult | undefined = ok;
  primeDevices: Record<string, ioBroker.Object> = {};
  primeStates: Record<string, ioBroker.Object> = {};

  extendObject(id: string, obj: ioBroker.PartialObject): Promise<unknown> {
    this.objects.set(id, obj);
    return Promise.resolve();
  }
  setState(id: string, state: ioBroker.SettableState): Promise<unknown> {
    this.states.set(id, (state as { val: ioBroker.StateValue }).val);
    return Promise.resolve();
  }
  setStateChanged(id: string, state: ioBroker.SettableState): Promise<unknown> {
    return this.setState(id, state);
  }
  getState(id: string): Promise<ioBroker.State | null | undefined> {
    return Promise.resolve(this.states.has(id) ? ({ val: this.states.get(id), ack: true } as ioBroker.State) : null);
  }
  getObject(id: string): Promise<ioBroker.Object | null | undefined> {
    return Promise.resolve((this.objects.get(id) as ioBroker.Object | undefined) ?? null);
  }
  setObjectNotExists(id: string, obj: ioBroker.PartialObject): Promise<unknown> {
    if (!this.objects.has(id)) {
      this.objects.set(id, obj);
    }
    return Promise.resolve();
  }
  delObject(id: string): Promise<void> {
    this.deleted.push(id);
    this.objects.delete(id);
    this.states.delete(id);
    return Promise.resolve();
  }
  getForeignObjects(_pattern: string, type: "state" | "device"): Promise<Record<string, ioBroker.Object>> {
    return Promise.resolve(type === "device" ? this.primeDevices : this.primeStates);
  }
  apiGet(path: string): Promise<unknown> {
    this.getCalls.push(path);
    return Promise.resolve(this.getResponses.get(path));
  }
  apiWrite(req: WriteRequest): Promise<JsonResult | undefined> {
    this.writes.push(req);
    return Promise.resolve(this.writeResult);
  }
}

/** Let the fire-and-forget stream/write chains settle. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));

/** Configure the endpoints one connected appliance's full sync hits. */
function appliance(
  port: FakePort,
  haId: string,
  name: string,
  parts: {
    connected?: boolean;
    status?: unknown[];
    settings?: unknown[];
    available?: string[];
    commands?: unknown[];
  } = {},
): void {
  const base = `/api/homeappliances/${haId}`;
  const list = (port.getResponses.get("/api/homeappliances") as { homeappliances: unknown[] } | undefined)
    ?.homeappliances ?? [];
  port.getResponses.set("/api/homeappliances", {
    homeappliances: [...list, { haId, name, connected: parts.connected ?? true, type: "Dishwasher" }],
  });
  if (parts.status !== undefined) {
    port.getResponses.set(`${base}/status`, { status: parts.status });
  }
  if (parts.settings !== undefined) {
    port.getResponses.set(`${base}/settings`, { settings: parts.settings });
  }
  port.getResponses.set(`${base}/programs/available`, { programs: (parts.available ?? []).map(key => ({ key })) });
  port.getResponses.set(`${base}/programs/selected`, {});
  port.getResponses.set(`${base}/programs/active`, {});
  if (parts.commands !== undefined) {
    port.getResponses.set(`${base}/commands`, { commands: parts.commands });
  }
}

describe("ApplianceSync.syncAppliances", () => {
  let port: FakePort;
  let sync: ApplianceSync;
  beforeEach(() => {
    port = new FakePort();
    sync = new ApplianceSync(port);
  });

  it("builds a speaking device tree with idiomatic values", async () => {
    appliance(port, "HA-1", "Geschirrspüler", {
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
      settings: [{ key: "BSH.Common.Setting.ChildLock", value: false }],
    });
    await sync.syncAppliances();

    expect(port.objects.has("geschirrspueler")).toBe(true);
    expect(port.objects.get("geschirrspueler")?.type).toBe("device");
    expect(port.states.get("geschirrspueler.status.doorState")).toBe("open");
    expect(port.objects.get("geschirrspueler.settings.childLock")?.common).toMatchObject({ write: true });
  });

  it("creates each object once — a repeated item only updates the value", async () => {
    appliance(port, "HA-1", "Oven", {
      status: [{ key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Ready" }],
    });
    await sync.syncAppliances();
    port.objects.clear(); // if applyBshItem re-extended, the object would reappear
    await sync.syncAppliances();
    expect(port.objects.has("oven.status.operationState")).toBe(false);
    expect(port.states.get("oven.status.operationState")).toBe("ready");
  });

  it("disambiguates two appliances whose names slugify equally", async () => {
    appliance(port, "HA-AAAA1111", "Geschirrspüler", { status: [] });
    appliance(port, "HA-BBBB2222", "Geschirrspüler", { status: [] });
    await sync.syncAppliances();
    expect(port.objects.has("geschirrspueler")).toBe(true);
    expect(port.objects.has("geschirrspueler-2222")).toBe(true);
  });

  it("gives start/stop buttons only to an appliance that has programs", async () => {
    appliance(port, "HA-FRIDGE", "Fridge", { status: [], available: [] });
    appliance(port, "HA-WASHER", "Washer", { status: [], available: ["LaundryCare.Washer.Program.Cotton"] });
    await sync.syncAppliances();
    expect(port.objects.has("fridge.programs.start")).toBe(false);
    expect(port.objects.has("washer.programs.start")).toBe(true);
  });
});

describe("ApplianceSync pruning", () => {
  let port: FakePort;
  let sync: ApplianceSync;
  beforeEach(() => {
    port = new FakePort();
    sync = new ApplianceSync(port);
  });

  it("removes a status state the appliance no longer reports", async () => {
    appliance(port, "HA-1", "Oven", {
      status: [
        { key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" },
        { key: "BSH.Common.Status.LocalControlActive", value: true },
      ],
    });
    await sync.syncAppliances();
    expect(port.objects.has("oven.status.localControlActive")).toBe(true);

    // Re-sync with LocalControlActive gone.
    port.getResponses.set("/api/homeappliances/HA-1/status", {
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
    });
    await sync.syncAppliances();
    expect(port.deleted).toContain("oven.status.localControlActive");
    expect(port.objects.has("oven.status.doorState")).toBe(true);
  });

  it("does NOT prune when the status GET fails (no tree wipe on a transient error)", async () => {
    appliance(port, "HA-1", "Oven", {
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
    });
    await sync.syncAppliances();
    // Make the status GET fail (undefined).
    port.getResponses.delete("/api/homeappliances/HA-1/status");
    await sync.syncAppliances();
    expect(port.deleted).not.toContain("oven.status.doorState");
    expect(port.objects.has("oven.status.doorState")).toBe(true);
  });
});

describe("ApplianceSync.primeFromObjects + write after a restart-while-offline", () => {
  it("routes a settings write for an appliance that never synced this run", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.dishwasher`]: {
        _id: `${NS}.dishwasher`,
        type: "device",
        common: { name: "Dishwasher" },
        native: { haId: "HA-1" },
      } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.dishwasher.settings.powerState`]: {
        _id: `${NS}.dishwasher.settings.powerState`,
        type: "state",
        common: { name: "powerState", type: "string", role: "text", read: true, write: true },
        native: {
          bshKey: "BSH.Common.Setting.PowerState",
          bshValues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Off"],
        },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.dishwasher.settings.powerState`, "off");
    expect(port.writes).toHaveLength(1);
    expect(port.writes[0]).toMatchObject({
      method: "PUT",
      path: "/api/homeappliances/HA-1/settings/BSH.Common.Setting.PowerState",
      body: { value: "BSH.Common.EnumType.PowerState.Off" },
    });
  });

  it("primes writable options into the start-payload set but not read-only display options", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: { name: "Washer" }, native: { haId: "HA-2" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.options.spinSpeed`]: {
        _id: "",
        type: "state",
        common: { name: "spinSpeed", type: "string", role: "text", read: true, write: true },
        native: { bshKey: "LaundryCare.Washer.Option.SpinSpeed", bshValues: ["LaundryCare.Washer.EnumType.SpinSpeed.RPM1200"] },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.options.remainingProgramTime`]: {
        _id: "",
        type: "state",
        common: { name: "remainingProgramTime", type: "number", role: "value", read: true, write: false },
        native: { bshKey: "BSH.Common.Option.RemainingProgramTime" },
      } as unknown as ioBroker.Object,
    };
    // setState/getState use namespace-relative ids (like the adapter).
    port.states.set("washer.options.spinSpeed", "rpm1200");
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    // Start the (selected) program → only the writable option is collected.
    port.states.set("washer.programs.selectedProgram", "cotton");
    // selectedProgram meta needs bshValues to resolve; prime it too.
    port.primeStates[`${NS}.washer.programs.selectedProgram`] = {
      _id: "",
      type: "state",
      common: { write: true },
      native: { bshKey: "BSH.Common.Root.SelectedProgram", bshValues: ["LaundryCare.Washer.Program.Cotton"] },
    } as unknown as ioBroker.Object;
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    expect(port.writes).toHaveLength(1);
    expect(port.writes[0].body?.options).toEqual([
      { key: "LaundryCare.Washer.Option.SpinSpeed", value: "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200" },
    ]);
  });
});

describe("ApplianceSync.handleWrite", () => {
  it("resets a momentary command button to false after firing it", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.oven`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.oven.commands.pauseProgram`]: {
        _id: "",
        type: "state",
        common: { type: "boolean", role: "button", read: false, write: true },
        native: { bshKey: "BSH.Common.Command.PauseProgram" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.oven.commands.pauseProgram`, true);
    expect(port.writes[0]).toMatchObject({ method: "PUT", path: "/api/homeappliances/HA-1/commands/BSH.Common.Command.PauseProgram" });
    expect(port.states.get("oven.commands.pauseProgram")).toBe(false);
  });

  it("ignores a write to an unknown device", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    await sync.handleWrite(`${NS}.ghost.settings.x`, true);
    expect(port.writes).toHaveLength(0);
  });
});

describe("ApplianceSync.handleStreamEvent", () => {
  it("applies NOTIFY items to a known device's states", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Oven", { status: [] });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();

    sync.handleStreamEvent({
      event: "NOTIFY",
      id: "HA-1",
      data: JSON.stringify({ items: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Closed" }] }),
    });
    await flush();
    expect(port.states.get("oven.status.doorState")).toBe("closed");
  });

  it("fetches only the affected appliance on a CONNECTED for an unknown haId", async () => {
    const port = new FakePort();
    port.getResponses.set("/api/homeappliances/HA-NEW", { haId: "HA-NEW", name: "New Oven", connected: false });
    const sync = new ApplianceSync(port);

    sync.handleStreamEvent({ event: "CONNECTED", id: "HA-NEW", data: "{}" });
    await flush();
    expect(port.getCalls).toContain("/api/homeappliances/HA-NEW");
    expect(port.getCalls).not.toContain("/api/homeappliances");
  });

  it("prefers the payload haId over a stale SSE id (SSE ids persist across events)", async () => {
    const port = new FakePort();
    appliance(port, "HA-OVEN", "Oven", { status: [] });
    appliance(port, "HA-WASHER", "Washer", { status: [] });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();

    // The SSE parser hands down the previous event's id ("HA-OVEN"); the payload names the washer.
    sync.handleStreamEvent({
      event: "NOTIFY",
      id: "HA-OVEN",
      data: JSON.stringify({
        haId: "HA-WASHER",
        items: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
      }),
    });
    await flush();
    expect(port.states.get("washer.status.doorState")).toBe("open");
    expect(port.states.has("oven.status.doorState")).toBe(false);
  });
});

describe("ApplianceSync reachability", () => {
  it("creates info.reachable from the appliance list's connected flag", async () => {
    const port = new FakePort();
    appliance(port, "HA-ON", "Oven", { status: [] });
    appliance(port, "HA-OFF", "Washer", { status: [], connected: false });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();

    expect(port.objects.get("oven.info.reachable")?.common).toMatchObject({ type: "boolean", write: false });
    expect(port.states.get("oven.info.reachable")).toBe(true);
    expect(port.states.get("washer.info.reachable")).toBe(false);
  });

  it("tracks DISCONNECTED / CONNECTED / DEPAIRED stream events", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Oven", { status: [] });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    expect(port.states.get("oven.info.reachable")).toBe(true);

    sync.handleStreamEvent({ event: "DISCONNECTED", id: "HA-1", data: "{}" });
    await flush();
    expect(port.states.get("oven.info.reachable")).toBe(false);

    sync.handleStreamEvent({ event: "CONNECTED", id: "HA-1", data: "{}" });
    await flush();
    expect(port.states.get("oven.info.reachable")).toBe(true);

    sync.handleStreamEvent({ event: "DEPAIRED", id: "HA-1", data: "{}" });
    await flush();
    expect(port.states.get("oven.info.reachable")).toBe(false);
    // The tree is kept.
    expect(port.objects.has("oven")).toBe(true);
  });
});

describe("ApplianceSync metadata refresh", () => {
  it("refreshes the selected-program dropdown + candidates when the program list changes", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Dishwasher", { status: [], available: ["Dishcare.Dishwasher.Program.Eco50"] });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    const before = port.objects.get("dishwasher.programs.selectedProgram");
    expect((before?.native as { bshValues: string[] }).bshValues).toEqual(["Dishcare.Dishwasher.Program.Eco50"]);

    // The appliance now reports an additional program (e.g. after a firmware update).
    port.getResponses.set("/api/homeappliances/HA-1/programs/available", {
      programs: [{ key: "Dishcare.Dishwasher.Program.Eco50" }, { key: "Dishcare.Dishwasher.Program.Auto2" }],
    });
    await sync.syncAppliances();

    const after = port.objects.get("dishwasher.programs.selectedProgram");
    expect((after?.native as { bshValues: string[] }).bshValues).toEqual([
      "Dishcare.Dishwasher.Program.Eco50",
      "Dishcare.Dishwasher.Program.Auto2",
    ]);
    expect((after?.common as ioBroker.StateCommon).states).toMatchObject({ eco50: "eco50", auto2: "auto2" });
  });

  it("does not replace primed objects whose metadata is unchanged (no wave on update)", async () => {
    const port = new FakePort();
    // Objects as a previous adapter run created them (identical to the fresh transform).
    port.primeDevices = {
      [`${NS}.oven`]: { _id: "", type: "device", common: { name: "Oven" }, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.oven.settings.childLock`]: {
        _id: "",
        type: "state",
        common: { name: "childLock", type: "boolean", role: "switch", read: true, write: true, def: false },
        native: { bshKey: "BSH.Common.Setting.ChildLock" },
      } as unknown as ioBroker.Object,
    };
    appliance(port, "HA-1", "Oven", {
      settings: [{ key: "BSH.Common.Setting.ChildLock", value: false }],
      status: [],
    });
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();
    await sync.syncAppliances();
    expect(port.deleted).toHaveLength(0);
  });

  it("does not rewrite an unchanged object on a re-sync", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Oven", {
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
    });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    await sync.syncAppliances();
    expect(port.deleted).toHaveLength(0);
  });

  it("preserves a user rename across a metadata refresh", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Dishwasher", { status: [], available: ["Dishcare.Dishwasher.Program.Eco50"] });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    // The user renamed the state in the admin.
    const obj = port.objects.get("dishwasher.programs.selectedProgram")!;
    (obj.common as ioBroker.StateCommon).name = "Mein Programm";

    port.getResponses.set("/api/homeappliances/HA-1/programs/available", {
      programs: [{ key: "Dishcare.Dishwasher.Program.Eco50" }, { key: "Dishcare.Dishwasher.Program.Auto2" }],
    });
    await sync.syncAppliances();

    const after = port.objects.get("dishwasher.programs.selectedProgram");
    expect((after?.common as ioBroker.StateCommon).name).toBe("Mein Programm");
  });

  it("preserves the user-chosen option value when the option's definition changes", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Washer", { status: [], available: ["LaundryCare.Washer.Program.Cotton"] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/selected", { key: "LaundryCare.Washer.Program.Cotton" });
    const spinDef = (allowed: string[]): unknown => ({
      options: [
        {
          key: "LaundryCare.Washer.Option.SpinSpeed",
          type: "LaundryCare.Washer.EnumType.SpinSpeed",
          constraints: { allowedvalues: allowed },
        },
      ],
    });
    port.getResponses.set(
      "/api/homeappliances/HA-1/programs/available/LaundryCare.Washer.Program.Cotton",
      spinDef(["LaundryCare.Washer.EnumType.SpinSpeed.RPM800"]),
    );
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    // The user picked a value.
    port.states.set("washer.options.spinSpeed", "rpm800");

    // The definition gains a value → metadata refresh, but the chosen value survives.
    port.getResponses.set(
      "/api/homeappliances/HA-1/programs/available/LaundryCare.Washer.Program.Cotton",
      spinDef(["LaundryCare.Washer.EnumType.SpinSpeed.RPM800", "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200"]),
    );
    await sync.syncAppliances();

    const after = port.objects.get("washer.options.spinSpeed");
    expect((after?.native as { bshValues: string[] }).bshValues).toHaveLength(2);
    expect(port.states.get("washer.options.spinSpeed")).toBe("rpm800");
  });

  it("does not let a stream event overwrite object metadata", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Oven", {
      settings: [
        {
          key: "BSH.Common.Setting.PowerState",
          value: "BSH.Common.EnumType.PowerState.On",
          constraints: { allowedvalues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"] },
        },
      ],
      status: [],
    });
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();

    // A NOTIFY carries the value only (no constraints) — the object must keep its candidates.
    sync.handleStreamEvent({
      event: "NOTIFY",
      id: "HA-1",
      data: JSON.stringify({ items: [{ key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.Standby" }] }),
    });
    await flush();
    const obj = port.objects.get("oven.settings.powerState");
    expect((obj?.native as { bshValues: string[] }).bshValues).toHaveLength(2);
    expect(port.states.get("oven.settings.powerState")).toBe("standby");
    expect(port.deleted).toHaveLength(0);
  });
});

describe("ApplianceSync options write gate", () => {
  it("does not send a write to a read-only display option", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.options.remainingProgramTime`]: {
        _id: "",
        type: "state",
        common: { name: "remainingProgramTime", type: "number", role: "value", read: true, write: false },
        native: { bshKey: "BSH.Common.Option.RemainingProgramTime" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.options.remainingProgramTime`, 1200);
    expect(port.writes).toHaveLength(0);
  });
});
