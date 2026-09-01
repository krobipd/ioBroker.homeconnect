import { describe, it, expect, beforeEach } from "vitest";
import { ApplianceSync, type AdapterPort } from "./appliance-sync";
import type { WriteRequest } from "./command-dispatch";
import type { JsonResult } from "./http";

const NS = "homeconnect.0";
const ok: JsonResult = { status: 204, ok: true, data: undefined, error: undefined };

/** A recording in-memory AdapterPort — no adapter, no network. */
class FakePort implements AdapterPort {
  readonly namespace = NS;
  /** Recorded log lines as `level: message`, so "what did the user see" is assertable. */
  readonly logs: string[] = [];
  readonly log = {
    debug: (m: string) => this.logs.push(`debug: ${m}`),
    info: (m: string) => this.logs.push(`info: ${m}`),
    warn: (m: string) => this.logs.push(`warn: ${m}`),
    error: (m: string) => this.logs.push(`error: ${m}`),
    silly: () => {},
  } as unknown as ioBroker.Logger;

  readonly objects = new Map<string, ioBroker.PartialObject>();
  readonly states = new Map<string, ioBroker.StateValue>();
  readonly deleted: string[] = [];
  readonly writes: WriteRequest[] = [];
  readonly getCalls: string[] = [];
  /** Every extendObject id, with repeats — an object must not be rewritten per sync. */
  readonly extendCalls: string[] = [];
  /** Every getState id, with repeats — the start payload must only be read for a start. */
  readonly getStateCalls: string[] = [];
  /** Every state write in order — a button press must produce exactly one. */
  readonly stateWrites: Array<{ id: string; val: ioBroker.StateValue }> = [];

  /** path → unwrapped data; absent ⇒ apiGet resolves undefined (a failure). */
  readonly getResponses = new Map<string, unknown>();
  writeResult: JsonResult | undefined = ok;
  primeDevices: Record<string, ioBroker.Object> = {};
  primeStates: Record<string, ioBroker.Object> = {};
  primeChannels: Record<string, ioBroker.Object> = {};

  extendObject(id: string, obj: ioBroker.PartialObject): Promise<unknown> {
    this.extendCalls.push(id);
    // Merge like the real extendObject: a partial update (e.g. only native)
    // must not wipe the rest of the object.
    const existing = this.objects.get(id) as Record<string, unknown> | undefined;
    const partial = obj as unknown as Record<string, unknown>;
    this.objects.set(
      id,
      (existing
        ? {
            ...existing,
            ...partial,
            common: { ...(existing.common as object), ...(partial.common as object) },
            native: { ...(existing.native as object), ...(partial.native as object) },
          }
        : obj) as ioBroker.PartialObject,
    );
    return Promise.resolve();
  }
  setState(id: string, state: ioBroker.SettableState): Promise<unknown> {
    const val = (state as { val: ioBroker.StateValue }).val;
    this.stateWrites.push({ id, val });
    this.states.set(id, val);
    return Promise.resolve();
  }
  setStateChanged(id: string, state: ioBroker.SettableState): Promise<unknown> {
    return this.setState(id, state);
  }
  getState(id: string): Promise<ioBroker.State | null | undefined> {
    this.getStateCalls.push(id);
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
  delObjectRecursive(id: string): Promise<void> {
    this.deleted.push(id);
    for (const map of [this.objects, this.states] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) {
        if (key === id || key.startsWith(`${id}.`)) {
          map.delete(key);
        }
      }
    }
    return Promise.resolve();
  }
  getForeignObjects(_pattern: string, type: "state" | "device" | "channel"): Promise<Record<string, ioBroker.Object>> {
    return Promise.resolve(
      type === "device" ? this.primeDevices : type === "channel" ? this.primeChannels : this.primeStates,
    );
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
    /** The appliance type (drives catalog events, door form, programs). */
    type?: string;
    /** Type-plate E-number (device-id source). Defaults to the name so the fixture ids stay speaking; "" ⇒ absent. */
    enumber?: string;
    /** Model code fallback. */
    vib?: string;
  } = {},
): void {
  const base = `/api/homeappliances/${haId}`;
  const list =
    (port.getResponses.get("/api/homeappliances") as { homeappliances: unknown[] } | undefined)?.homeappliances ?? [];
  port.getResponses.set("/api/homeappliances", {
    homeappliances: [
      ...list,
      {
        haId,
        name,
        connected: parts.connected ?? true,
        type: parts.type ?? "Dishwasher",
        enumber: parts.enumber ?? name,
        vib: parts.vib,
      },
    ],
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
    // The door is a proper boolean, not enum text (design principle: idiomatic types).
    expect(port.states.get("geschirrspueler.status.doorOpen")).toBe(true);
    expect(port.objects.get("geschirrspueler.status.doorOpen")?.common).toMatchObject({ type: "boolean" });
    // A dishwasher's door does not lock — no doorLocked state for this type.
    expect(port.objects.has("geschirrspueler.status.doorLocked")).toBe(false);
    expect(port.objects.get("geschirrspueler.settings.childLock")?.common).toMatchObject({ write: true });
  });

  it("creates the catalog events of the type upfront — even for a switched-off appliance", async () => {
    appliance(port, "HA-1", "Geschirrspüler", { connected: false });
    await sync.syncAppliances();
    // Dishwasher catalog: the event exists with false BEFORE it ever fires.
    expect(port.states.get("geschirrspueler.events.saltNearlyEmpty")).toBe(false);
    expect(port.states.get("geschirrspueler.events.programAborted")).toBe(false);
    expect(port.objects.get("geschirrspueler.events.programFinished")?.common).toMatchObject({ type: "boolean" });
  });

  it("derives the boolean programRunning from the operation state", async () => {
    appliance(port, "HA-1", "Waschtrockner", {
      type: "WasherDryer",
      status: [{ key: "BSH.Common.Status.OperationState", value: "BSH.Common.EnumType.OperationState.Run" }],
    });
    await sync.syncAppliances();
    expect(port.states.get("waschtrockner.status.operationState")).toBe("run");
    expect(port.states.get("waschtrockner.status.programRunning")).toBe(true);
  });

  it("gives a lockable-door type doorOpen AND doorLocked", async () => {
    appliance(port, "HA-1", "Waschtrockner", {
      type: "WasherDryer",
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Locked" }],
    });
    await sync.syncAppliances();
    expect(port.states.get("waschtrockner.status.doorOpen")).toBe(false);
    expect(port.states.get("waschtrockner.status.doorLocked")).toBe(true);
  });

  it("routes nested BSH keys into their real channel instead of misc", async () => {
    appliance(port, "HA-1", "Kühlschrank", {
      type: "FridgeFreezer",
      status: [{ key: "Refrigeration.Common.Status.Door.Freezer", value: "BSH.Common.EnumType.DoorState.Open" }],
      settings: [{ key: "Refrigeration.Common.Setting.Light.Internal.Brightness", value: 70, unit: "%" }],
    });
    await sync.syncAppliances();
    // Per-compartment door → a speaking boolean under status, not "misc.freezer".
    expect(port.states.get("kuehlschrank.status.doorFreezerOpen")).toBe(true);
    // A nested setting lands under settings and is writable.
    expect(port.states.get("kuehlschrank.settings.lightInternalBrightness")).toBe(70);
    expect(port.objects.get("kuehlschrank.settings.lightInternalBrightness")?.common).toMatchObject({ write: true });
    expect([...port.objects.keys()].some(k => k.includes(".misc."))).toBe(false);
  });

  it("creates no programs channel for a program-less appliance type", async () => {
    appliance(port, "HA-1", "Kühlschrank", { type: "FridgeFreezer", status: [], settings: [] });
    await sync.syncAppliances();
    expect([...port.objects.keys()].some(k => k.startsWith("kuehlschrank.programs"))).toBe(false);
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

describe("ApplianceSync datapoint persistence", () => {
  let port: FakePort;
  let sync: ApplianceSync;
  beforeEach(() => {
    port = new FakePort();
    sync = new ApplianceSync(port);
  });

  it("keeps a state that a later, reduced response no longer carries", async () => {
    // The cloud reports a state-dependent SUBSET: a switched-off washer in
    // network standby answers with powerState only. That must never delete
    // anything (the childLock finding, 2026-09-01).
    appliance(port, "HA-1", "Waschtrockner", {
      type: "WasherDryer",
      settings: [
        { key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.On" },
        { key: "BSH.Common.Setting.ChildLock", value: false },
      ],
    });
    await sync.syncAppliances();
    expect(port.objects.has("waschtrockner.settings.childLock")).toBe(true);

    // Standby re-sync: only powerState comes back.
    port.getResponses.set("/api/homeappliances/HA-1/settings", {
      settings: [{ key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.Off" }],
    });
    await sync.syncAppliances();
    expect(port.deleted).not.toContain("waschtrockner.settings.childLock");
    expect(port.objects.has("waschtrockner.settings.childLock")).toBe(true);
  });

  it("keeps every state when the status GET fails entirely", async () => {
    appliance(port, "HA-1", "Oven", {
      type: "Oven",
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
    });
    await sync.syncAppliances();
    // Make the status GET fail (undefined).
    port.getResponses.delete("/api/homeappliances/HA-1/status");
    await sync.syncAppliances();
    expect(port.deleted).not.toContain("oven.status.doorOpen");
    expect(port.objects.has("oven.status.doorOpen")).toBe(true);
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
      [`${NS}.washer`]: {
        _id: "",
        type: "device",
        common: { name: "Washer" },
        native: { haId: "HA-2" },
      } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.options.spinSpeed`]: {
        _id: "",
        type: "state",
        common: { name: "spinSpeed", type: "string", role: "text", read: true, write: true },
        native: {
          bshKey: "LaundryCare.Washer.Option.SpinSpeed",
          bshValues: ["LaundryCare.Washer.EnumType.SpinSpeed.RPM1200"],
        },
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
    expect(port.writes[0]).toMatchObject({
      method: "PUT",
      path: "/api/homeappliances/HA-1/commands/BSH.Common.Command.PauseProgram",
    });
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
      data: JSON.stringify({
        items: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Closed" }],
      }),
    });
    await flush();
    expect(port.states.get("oven.status.doorOpen")).toBe(false);
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
    expect(port.states.get("washer.status.doorOpen")).toBe(true);
    expect(port.states.has("oven.status.doorOpen")).toBe(false);
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
    // Removed from the account — the tree goes with it (see the dedicated tests).
    expect(port.objects.has("oven")).toBe(false);
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
      [`${NS}.oven`]: {
        _id: "",
        type: "device",
        common: { name: "Oven" },
        native: { haId: "HA-1" },
      } as unknown as ioBroker.Object,
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

  it("unions an option's allowed values across programs and keeps the chosen value", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Washer", {
      type: "Washer",
      status: [],
      available: ["LaundryCare.Washer.Program.Cotton", "LaundryCare.Washer.Program.Wool"],
    });
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
      spinDef(["LaundryCare.Washer.EnumType.SpinSpeed.RPM800", "LaundryCare.Washer.EnumType.SpinSpeed.RPM1200"]),
    );
    port.getResponses.set(
      "/api/homeappliances/HA-1/programs/available/LaundryCare.Washer.Program.Wool",
      spinDef(["LaundryCare.Washer.EnumType.SpinSpeed.RPM800", "LaundryCare.Washer.EnumType.SpinSpeed.RPM400"]),
    );
    const sync = new ApplianceSync(port);
    await sync.syncAppliances();
    // The user picked a value.
    port.states.set("washer.options.spinSpeed", "rpm800");

    // Both program definitions feed ONE stable object: the union of all values.
    const after = port.objects.get("washer.options.spinSpeed");
    expect((after?.native as { bshValues: string[] }).bshValues).toHaveLength(3);

    // A later re-sync fetches no definition again and rewrites nothing.
    port.extendCalls.length = 0;
    await sync.syncAppliances();
    expect(port.extendCalls).not.toContain("washer.options.spinSpeed");
    expect(port.states.get("washer.options.spinSpeed")).toBe("rpm800");
    const defFetches = port.getCalls.filter(p => p.includes("/programs/available/LaundryCare.Washer.Program.Cotton"));
    expect(defFetches).toHaveLength(1);
  });

  it("does not let a stream event overwrite object metadata", async () => {
    const port = new FakePort();
    appliance(port, "HA-1", "Oven", {
      settings: [
        {
          key: "BSH.Common.Setting.PowerState",
          value: "BSH.Common.EnumType.PowerState.On",
          constraints: {
            allowedvalues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Standby"],
          },
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
      data: JSON.stringify({
        items: [{ key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.Standby" }],
      }),
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

// ---------------------------------------------------------------------------
// Gaps found by mutation testing: rules the suite above did not pin down.
// ---------------------------------------------------------------------------

describe("ApplianceSync.primeFromObjects robustness", () => {
  it("takes only top-level device objects into the haId mapping", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.oven`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
      // A nested object that also carries a haId — a sub-device, or a leftover from
      // an older tree. Taking it as a device would map the SAME haId to a path that
      // is not a device root, and the write path would then aim there.
      [`${NS}.oven.info`]: {
        _id: "",
        type: "device",
        common: {},
        native: { haId: "HA-1" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    sync.handleStreamEvent({
      event: "NOTIFY",
      id: "",
      data: JSON.stringify({ haId: "HA-1", items: [{ key: "BSH.Common.Status.DoorState", value: "x" }] }),
    });
    await flush();
    // The haId must resolve to the device ROOT. Mapping it to a nested path puts
    // the appliance's whole live tree one level too deep, next to the real one.
    expect(port.states.has("oven.status.doorOpen")).toBe(true);
    expect(port.states.has("oven.info.status.doorOpen")).toBe(false);
  });

  it("ignores a state whose stored BSH key is not a string", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.oven`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.oven.settings.broken`]: {
        _id: "",
        type: "state",
        common: { write: true },
        // A hand-edited or half-migrated object. Passing this through would build
        // the path "/settings/42" and produce a permanent server-side error.
        native: { bshKey: 42, bshValues: "nope" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.oven.settings.broken`, "x");
    expect(port.writes).toHaveLength(0);
  });
});

describe("ApplianceSync malformed API responses", () => {
  it("keeps the tree when the appliance list has the wrong shape", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [{ key: "BSH.Common.Status.DoorState", value: "x" }] });
    await sync.syncAppliances();
    port.logs.length = 0;

    // A 200 carrying an error envelope instead of the list.
    port.getResponses.set("/api/homeappliances", { error: { key: "SDK.Error.HomeAppliance.Offline" } });
    await sync.syncAppliances();
    // "Setting up 0 appliance(s)" would be a lie: nothing was learned, and the
    // user would go looking for a pairing problem that does not exist.
    expect(port.logs.some(l => l.includes("Setting up"))).toBe(false);
    expect(port.objects.has("oven")).toBe(true);
  });

  it("keeps every state when the response has the wrong shape", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", {
      type: "Oven",
      status: [{ key: "BSH.Common.Status.DoorState", value: "BSH.Common.EnumType.DoorState.Open" }],
    });
    await sync.syncAppliances();

    // Not a failure (undefined) but a record without the expected array — the
    // rate-limit / error envelope shape.
    port.getResponses.set("/api/homeappliances/HA-1/status", { error: { key: "SDK.Error.TooManyRequests" } });
    await sync.syncAppliances();
    expect(port.deleted).not.toContain("oven.status.doorOpen");
    expect(port.objects.has("oven.status.doorOpen")).toBe(true);
  });

  it("falls back to the haId when the appliance has an empty name", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    port.getResponses.set("/api/homeappliances", {
      homeappliances: [{ haId: "HA-XYZ", name: "", connected: false }],
    });
    await sync.syncAppliances();
    // An empty name slugifies to an empty id — the device would have no tree at all.
    const device = [...port.objects.entries()].find(([, o]) => o.type === "device");
    expect(device?.[0]).toBe("ha-xyz");
    expect(device?.[1].common?.name).toBe("HA-XYZ");
  });
});

describe("ApplianceSync stream events for unknown and new appliances", () => {
  it("rebuilds a known appliance's tree on PAIRED, not just on CONNECTED", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();
    port.getCalls.length = 0;

    sync.handleStreamEvent({ event: "PAIRED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();
    expect(port.getCalls).toContain("/api/homeappliances/HA-1/status");
    expect(port.states.get("oven.info.reachable")).toBe(true);
  });

  it("fetches the whole list for a PAIRED appliance it has never seen", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-NEW", "New oven", { status: [] });
    port.getCalls.length = 0;

    sync.handleStreamEvent({ event: "PAIRED", id: "", data: JSON.stringify({ haId: "HA-NEW" }) });
    await flush();
    // A brand-new appliance has no name/type yet — only the list carries them, so
    // the single-appliance shortcut used for CONNECTED is not enough here.
    expect(port.getCalls).toContain("/api/homeappliances");
    expect(port.objects.has("new-oven")).toBe(true);
  });

  it("does not fetch a connected appliance's data twice for overlapping events", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();
    port.getCalls.length = 0;

    sync.handleStreamEvent({ event: "CONNECTED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    sync.handleStreamEvent({ event: "CONNECTED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();
    // The appliance sends CONNECTED more than once on a flaky link. Each pass is
    // ~6 cloud calls against a rate-limited API.
    expect(port.getCalls.filter(p => p === "/api/homeappliances/HA-1/status")).toHaveLength(1);
  });
});

describe("ApplianceSync object churn", () => {
  it("creates a command button once, not on every sync", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [], commands: [{ key: "BSH.Common.Command.PauseProgram" }] });
    await sync.syncAppliances();
    expect(port.objects.has("oven.commands.pauseProgram")).toBe(true);
    port.extendCalls.length = 0;

    await sync.syncAppliances();
    expect(port.extendCalls).not.toContain("oven.commands.pauseProgram");
  });

  it("keeps the previous program's options when the program changes — no datapoint ever disappears", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    port.getResponses.set(`${base}/programs/available/P.Cotton`, {
      options: [{ key: "LaundryCare.Washer.Option.SpinSpeed", type: "Int", constraints: { min: 0, max: 1600 } }],
    });
    port.getResponses.set(`${base}/programs/available/P.Wool`, {
      options: [{ key: "LaundryCare.Washer.Option.Temperature", type: "Int", constraints: { min: 0, max: 60 } }],
    });
    await sync.activateProgramOptions("washer", "HA-1", "P.Cotton");
    expect(port.objects.has("washer.options.spinSpeed")).toBe(true);

    await sync.activateProgramOptions("washer", "HA-1", "P.Wool");
    // The tree holds the union of all programs; which options the SELECTED
    // program accepts is the write gate's business, not the object tree's.
    expect(port.deleted).not.toContain("washer.options.spinSpeed");
    expect(port.objects.has("washer.options.spinSpeed")).toBe(true);
    expect(port.objects.has("washer.options.temperature")).toBe(true);
  });

  it("blocks a write to an option outside the selected program's definition", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    port.primeDevices = {
      [`${NS}.washer`]: {
        _id: "",
        type: "device",
        common: {},
        native: { haId: "HA-1" },
      } as unknown as ioBroker.Object,
    };
    await sync.primeFromObjects();
    const base = "/api/homeappliances/HA-1";
    port.getResponses.set(`${base}/programs/available/P.Cotton`, {
      options: [{ key: "LaundryCare.Washer.Option.SpinSpeed", type: "Int" }],
    });
    port.getResponses.set(`${base}/programs/available/P.Wool`, {
      options: [{ key: "LaundryCare.Washer.Option.Temperature", type: "Int" }],
    });
    await sync.activateProgramOptions("washer", "HA-1", "P.Cotton");
    await sync.activateProgramOptions("washer", "HA-1", "P.Wool");
    // spinSpeed still EXISTS (union) but belongs to the previous program only —
    // writing it now would just produce a server-side error, so it is not sent.
    await sync.handleWrite(`${NS}.washer.options.spinSpeed`, 800);
    expect(port.writes).toHaveLength(0);
    await sync.handleWrite(`${NS}.washer.options.temperature`, 40);
    expect(port.writes).toHaveLength(1);
  });

  it("re-fetches nothing on a program change the cache already knows", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    port.getResponses.set(`${base}/programs/available/P.Cotton`, { options: [] });
    port.getResponses.set(`${base}/programs/available/P.Wool`, { options: [] });
    await sync.activateProgramOptions("washer", "HA-1", "P.Cotton");
    await sync.activateProgramOptions("washer", "HA-1", "P.Wool");
    port.getCalls.length = 0;
    await sync.activateProgramOptions("washer", "HA-1", "P.Cotton");
    expect(port.getCalls).toHaveLength(0);
  });
});

describe("ApplianceSync write results", () => {
  /** A washer primed with a selected program and one writable option. */
  function washer(): { port: FakePort; sync: ApplianceSync } {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.programs.selectedProgram`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "BSH.Common.Root.SelectedProgram", bshValues: ["LaundryCare.Washer.Program.Cotton"] },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.settings.powerState`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: {
          bshKey: "BSH.Common.Setting.PowerState",
          bshValues: ["BSH.Common.EnumType.PowerState.On", "BSH.Common.EnumType.PowerState.Off"],
        },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.options.spinSpeed`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "LaundryCare.Washer.Option.SpinSpeed", bshValues: [] },
      } as unknown as ioBroker.Object,
    };
    port.states.set("washer.programs.selectedProgram", "cotton");
    port.states.set("washer.options.spinSpeed", 1200);
    return { port, sync: new ApplianceSync(port) };
  }

  it("does not confirm a value the appliance rejected", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();
    port.writeResult = { status: 409, ok: false, data: undefined, error: "wrong state" };

    await sync.handleWrite(`${NS}.washer.settings.powerState`, "off");
    // Acking a rejected write shows the user's wish as if the appliance had done
    // it — the tree then disagrees with the machine until the next sync.
    expect(port.states.get("washer.settings.powerState")).toBeUndefined();
  });

  it("writes a pressed button exactly once — the reset, not the press", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();
    port.stateWrites.length = 0;

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    const own = port.stateWrites.filter(w => w.id === "washer.programs.start");
    // Confirming the press with `true` and resetting to `false` right after leaves
    // a phantom true in history and fires two state events for one press.
    expect(own).toEqual([{ id: "washer.programs.start", val: false }]);
  });

  it("resets the start button and does not confirm it as a value", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    expect(port.writes[0]).toMatchObject({ method: "PUT", path: "/api/homeappliances/HA-1/programs/active" });
    // A press is momentary: leaving it true means the next press writes nothing
    // (the value did not change) and the button looks stuck in the UI.
    expect(port.states.get("washer.programs.start")).toBe(false);
  });

  it("sends an option that has no enum candidates", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    // A numeric option carries an empty candidate list. Treating "list present"
    // as "is an enum" resolves nothing and silently drops the option.
    expect(port.writes[0].body?.options).toEqual([{ key: "LaundryCare.Washer.Option.SpinSpeed", value: 1200 }]);
  });

  it("does not assemble the start payload for a plain program change", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();
    port.getStateCalls.length = 0;

    await sync.handleWrite(`${NS}.washer.programs.selectedProgram`, "cotton");
    // Selecting a program is not a start: reading every option state for it costs
    // one DB round trip per option on every single program change.
    expect(port.getStateCalls).not.toContain("washer.options.spinSpeed");
  });

  it("retries a rejected start with defaults only when options were sent", async () => {
    const { port, sync } = washer();
    await sync.primeFromObjects();
    port.writeResult = { status: 409, ok: false, data: undefined, error: "not possible" };

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    expect(port.writes).toHaveLength(2);
    expect(port.writes[1].body).toEqual({ key: "LaundryCare.Washer.Program.Cotton" });

    // No options in the first attempt → the retry would be byte-identical and only
    // burn another call against the rate-limited API.
    port.states.delete("washer.options.spinSpeed");
    port.writes.length = 0;
    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    expect(port.writes).toHaveLength(1);
  });
});

describe("ApplianceSync failure paths", () => {
  it("keeps starting when the object DB cannot be read for priming", async () => {
    const port = new FakePort();
    port.getForeignObjects = () => Promise.reject(new Error("objects db down"));
    const sync = new ApplianceSync(port);
    // Priming is best-effort: a DB hiccup at start must not abort onReady before
    // the sign-in and the REST sync ever run.
    await expect(sync.primeFromObjects()).resolves.toBeUndefined();
    expect(port.logs.filter(l => l.includes("priming"))).toHaveLength(2);
  });

  it("ignores stream payloads it cannot use", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();
    port.getCalls.length = 0;

    sync.handleStreamEvent({ event: "STATUS", id: "", data: "not json" });
    sync.handleStreamEvent({ event: "STATUS", id: "", data: "[1,2,3]" });
    sync.handleStreamEvent({ event: "STATUS", id: "", data: "{}" });
    sync.handleStreamEvent({ event: "STATUS", id: "", data: JSON.stringify({ haId: "" }) });
    await flush();
    // A malformed frame is a fact of life on a cloud stream — it must not warn
    // per frame and must not reach the device tree.
    expect(port.getCalls).toEqual([]);
    expect(port.logs.filter(l => l.startsWith("warn"))).toEqual([]);
  });

  it("removes the whole tree of an appliance that left the account", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();
    expect(port.objects.has("oven")).toBe(true);

    sync.handleStreamEvent({ event: "DEPAIRED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();

    // What is no longer on the account cannot be addressed either — every write
    // would go nowhere. Keeping the tree would leave datapoints that can never
    // update again and an entry counting as permanently offline in the summary.
    expect(port.logs.some(l => l.includes("removing its objects"))).toBe(true);
    expect(port.objects.has("oven")).toBe(false);
    expect(port.states.has("oven.info.reachable")).toBe(false);
    expect(port.states.get("info.devicesTotal")).toBe(0);
  });

  it("links the device object to its reachable state so the tree shows an icon", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();

    // The `info.reachable` value alone is just a number nobody connects to the
    // green/grey dot — statusStates is what makes the object browser show it, and
    // it needs the FULL id, not the device-relative one.
    const device = port.objects.get("oven") as { common?: { statusStates?: { onlineId?: string } } };
    expect(device.common?.statusStates?.onlineId).toBe(`${port.namespace}.oven.info.reachable`);
  });

  it("an account without a single appliance does not report all-online", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();

    sync.handleStreamEvent({ event: "DEPAIRED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();

    // "All 0 of 0 connected" would be a success message for an empty setup.
    expect(port.states.get("info.devicesTotal")).toBe(0);
    expect(port.states.get("info.devicesAllOnline")).toBe(false);
  });

  it("keeps the tree of an appliance that is merely switched off", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();

    sync.handleStreamEvent({ event: "DISCONNECTED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();

    // Still on the account, just powered down — dropping the tree here would make
    // the datapoints vanish every evening and tear the history apart.
    expect(port.objects.has("oven")).toBe(true);
    expect(port.states.get("oven.info.reachable")).toBe(false);
    expect(port.states.get("info.devicesTotal")).toBe(1);
    expect(port.states.get("info.devicesOnline")).toBe(0);
  });

  it("removes an appliance that silently vanished from the account list", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    appliance(port, "HA-2", "Dishwasher", { status: [] });
    await sync.syncAppliances();
    expect(port.states.get("info.devicesTotal")).toBe(2);

    // The second way an appliance disappears: removed while the adapter was off,
    // so no DEPAIRED event ever arrives — it is simply missing from the list.
    const list = (port.getResponses.get("/api/homeappliances") as { homeappliances: { haId: string }[] })
      .homeappliances;
    port.getResponses.set("/api/homeappliances", { homeappliances: list.filter(a => a.haId !== "HA-2") });
    await sync.syncAppliances();

    expect(port.objects.has("dishwasher")).toBe(false);
    expect(port.objects.has("oven")).toBe(true);
    expect(port.states.get("info.devicesTotal")).toBe(1);
  });

  it("a failed appliance list never wipes the tree", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();

    // Nothing was learned — deleting on a network hiccup would destroy the whole
    // configuration, so the removal pass must sit behind the success guard.
    port.apiGet = () => Promise.resolve(undefined);
    await sync.syncAppliances();

    expect(port.objects.has("oven")).toBe(true);
    expect(port.states.get("info.devicesTotal")).toBe(1);
  });

  it("reports a failing background task instead of dying on an unhandled rejection", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    await sync.syncAppliances();
    port.setStateChanged = () => Promise.reject(new Error("states db down"));

    sync.handleStreamEvent({ event: "DISCONNECTED", id: "", data: JSON.stringify({ haId: "HA-1" }) });
    await flush();
    // Stream handling is fire-and-forget: an escaping rejection kills the process.
    expect(port.logs.some(l => l.includes("appliance sync task failed"))).toBe(true);
  });

  it("skips an appliance record without a haId", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    port.getResponses.set("/api/homeappliances", { homeappliances: [{ name: "Nameless" }] });
    await sync.syncAppliances();
    expect([...port.objects.keys()]).toEqual([]);
  });

  it("skips items and option definitions without a key", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [{ value: 1 }, { key: 42, value: 2 }] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available/P.X", { options: [{ type: "Int" }] });
    await sync.syncAppliances();
    await sync.activateProgramOptions("oven", "HA-1", "P.X");
    expect([...port.objects.keys()].filter(k => k.startsWith("oven.status."))).toEqual([]);
    expect([...port.objects.keys()].filter(k => k.startsWith("oven.options."))).toEqual([]);
  });

  it("retries a failed definition fetch on the next activation instead of caching the failure", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    // First activation: the definition fetch fails (no response configured).
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    expect(port.objects.has("w.options.one")).toBe(false);
    // The endpoint recovers → the next activation fetches and creates the option.
    port.getResponses.set(`${base}/programs/available/P.A`, { options: [{ key: "X.Option.One", type: "Int" }] });
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    expect(port.objects.has("w.options.one")).toBe(true);
  });

  it("ignores a program response whose options are not a list", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/selected", { key: "P.A", options: "nonsense" });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available/P.A", { options: [] });
    await expect(sync.syncAppliances()).resolves.toBeUndefined();
  });

  it("reports a failing write instead of dying on an unhandled rejection", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.oven`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.oven.settings.powerState`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "BSH.Common.Setting.PowerState" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();
    port.apiWrite = () => Promise.reject(new Error("transport blew up"));

    // handleWrite is called with `void` from onStateChange.
    await expect(sync.handleWrite(`${NS}.oven.settings.powerState`, "off")).resolves.toBeUndefined();
    expect(port.logs.some(l => l.includes("handling write to"))).toBe(true);
  });

  it("ignores a write to an id that is not a device state", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    for (const id of [`${NS}.info.connection`, `${NS}.oven`, `${NS}.oven.settings`, `${NS}.oven.settings.`]) {
      await sync.handleWrite(id, true);
    }
    expect(port.writes).toEqual([]);
  });
});

describe("ApplianceSync metadata replace details", () => {
  it("keeps the user's history settings across a metadata refresh", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available", {
      programs: [{ key: "Cooking.Oven.Program.HeatingMode.HotAir" }],
    });
    await sync.syncAppliances();
    const id = "oven.programs.selectedProgram";
    const obj = port.objects.get(id) as { common: Record<string, unknown> };
    obj.common.name = "My program";
    (obj.common as { custom?: unknown }).custom = { "history.0": { enabled: true } };
    port.states.set(id, "hotair");

    // A new program appears → the candidate list changes → the object is replaced.
    port.getResponses.set("/api/homeappliances/HA-1/programs/available", {
      programs: [
        { key: "Cooking.Oven.Program.HeatingMode.HotAir" },
        { key: "Cooking.Oven.Program.HeatingMode.TopBottomHeating" },
      ],
    });
    await sync.syncAppliances();
    const after = port.objects.get(id) as { common: Record<string, unknown> };
    // delObject drops everything. A refresh that silently switches off the user's
    // logging is the kind of loss nobody notices until the charts are empty.
    expect(after.common.name).toBe("My program");
    expect((after.common as { custom?: unknown }).custom).toEqual({ "history.0": { enabled: true } });
    // delObject also drops the value. It is written back before the sync sets the
    // current one, so the state is never briefly empty for a rule reading it.
    expect(port.stateWrites.some(w => w.id === id && w.val === "hotair")).toBe(true);
  });

  it("reports a failing metadata refresh and leaves the sync running", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Oven", { status: [] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available", { programs: [{ key: "P.A" }] });
    await sync.syncAppliances();
    port.setObjectNotExists = () => Promise.reject(new Error("objects db down"));
    port.getResponses.set("/api/homeappliances/HA-1/programs/available", {
      programs: [{ key: "P.A" }, { key: "P.B" }],
    });

    await expect(sync.syncAppliances()).resolves.toBeUndefined();
    expect(port.logs.some(l => l.includes("refreshing object metadata"))).toBe(true);
  });
});

describe("ApplianceSync start payload details", () => {
  it("leaves out options that carry no value or no BSH key", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.programs.selectedProgram`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "BSH.Common.Root.SelectedProgram", bshValues: ["LaundryCare.Washer.Program.Cotton"] },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.options.hasValue`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "X.Option.HasValue" },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.options.neverSet`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "X.Option.NeverSet" },
      } as unknown as ioBroker.Object,
      [`${NS}.washer.options.noKey`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: {},
      } as unknown as ioBroker.Object,
    };
    port.states.set("washer.programs.selectedProgram", "cotton");
    port.states.set("washer.options.hasValue", 40);
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    // Sending `null` for an option the user never touched makes the appliance
    // reject the whole start.
    expect(port.writes[0].body?.options).toEqual([{ key: "X.Option.HasValue", value: 40 }]);
  });

  it("starts with defaults when no program is selected in the tree", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();
    await sync.handleWrite(`${NS}.washer.programs.start`, true);
    // No program → nothing to start. Sending a start without a key 400s.
    expect(port.writes).toEqual([]);
  });

  it("reloads the option definitions after the program was changed", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.programs.selectedProgram`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "BSH.Common.Root.SelectedProgram", bshValues: ["LaundryCare.Washer.Program.Cotton"] },
      } as unknown as ioBroker.Object,
    };
    port.getResponses.set("/api/homeappliances/HA-1/programs/available/LaundryCare.Washer.Program.Cotton", {
      options: [{ key: "LaundryCare.Washer.Option.Temperature", type: "Int", constraints: { min: 0, max: 60 } }],
    });
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();

    await sync.handleWrite(`${NS}.washer.programs.selectedProgram`, "cotton");
    // Without the reload the options panel still shows the previous program's
    // options — writable, and rejected by the appliance.
    expect(port.objects.has("washer.options.temperature")).toBe(true);
  });
});

describe("ApplianceSync remaining guards", () => {
  it("ignores value and offline events for an appliance it does not know", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    for (const event of ["NOTIFY", "STATUS", "EVENT", "DISCONNECTED", "DEPAIRED"]) {
      sync.handleStreamEvent({
        event,
        id: "",
        data: JSON.stringify({ haId: "HA-GHOST", items: [{ key: "BSH.Common.Status.DoorState", value: "x" }] }),
      });
    }
    await flush();
    // Only CONNECTED/PAIRED may go and fetch. Everything else for an unknown
    // appliance would build a tree from a value frame — without name or type.
    expect(port.getCalls).toEqual([]);
    expect([...port.objects.keys()]).toEqual([]);
  });

  it("reports a broken stream frame instead of dying on it", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const hostile = {
      event: "STATUS",
      data: "{}",
      get id(): string {
        throw new Error("frame blew up");
      },
    };
    expect(() => sync.handleStreamEvent(hostile as never)).not.toThrow();
    expect(port.logs.some(l => l.includes("handling stream event failed"))).toBe(true);
  });

  it("applies the option values a program response carries", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Washer", { status: [], available: ["P.A"] });
    port.getResponses.set("/api/homeappliances/HA-1/programs/selected", {
      key: "P.A",
      options: [{ key: "LaundryCare.Washer.Option.Temperature", value: 40, unit: "°C" }],
    });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available/P.A", { options: [] });
    await sync.syncAppliances();
    // The values of the selected program are what the user sees before pressing
    // start — dropping them leaves the panel empty until the appliance runs.
    expect(port.states.get("washer.options.temperature")).toBe(40);
  });

  it("does no follow-up when the write was never sent", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: { _id: "", type: "device", common: {}, native: { haId: "HA-1" } } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.washer.programs.selectedProgram`]: {
        _id: "",
        type: "state",
        common: { write: true },
        native: { bshKey: "BSH.Common.Root.SelectedProgram", bshValues: ["P.A"] },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();
    port.writeResult = undefined; // paused by the rate limiter / not signed in
    port.getCalls.length = 0;

    port.logs.length = 0;
    await sync.handleWrite(`${NS}.washer.programs.selectedProgram`, "a");
    expect(port.writes).toHaveLength(1);
    // Reloading the option definitions for a program change that never reached
    // the cloud spends calls from a quota that is already exhausted.
    expect(port.getCalls).toEqual([]);
    // And a not-sent write is not a failure — reading the missing result would
    // throw and turn a rate-limit pause into a warning per press.
    expect(port.logs.filter(l => l.startsWith("warn"))).toEqual([]);
  });
});

describe("ApplianceSync online/offline logging", () => {
  it("logs a reachability transition once at debug — never at info, none while nothing changes", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Waschtrockner", { type: "WasherDryer", status: [], settings: [] });
    await sync.syncAppliances();

    port.logs.length = 0;
    sync.handleStreamEvent({ event: "DISCONNECTED", id: "HA-1", data: "{}" });
    await flush();
    // Fleet convention: routine per-device connectivity is debug material — the
    // tree's green/grey dot and info.devicesOnline carry it for the user. The
    // line names the appliance as `Name (id)`.
    expect(port.logs.filter(l => l === "debug: Appliance Waschtrockner (waschtrockner) is now offline.")).toHaveLength(
      1,
    );
    expect(port.logs.filter(l => l.startsWith("info") && l.includes("is now"))).toHaveLength(0);

    // The same state again produces no second line.
    sync.handleStreamEvent({ event: "DISCONNECTED", id: "HA-1", data: "{}" });
    await flush();
    expect(port.logs.filter(l => l.includes("offline"))).toHaveLength(1);
  });

  it("does not flood the log with per-device lines at start — one summary line leads", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-1", "Geschirrspüler", { status: [] });
    appliance(port, "HA-2", "Waschtrockner", { type: "WasherDryer", status: [], connected: false });
    await sync.syncAppliances();

    const infos = port.logs.filter(l => l.startsWith("info"));
    // The summary is the FIRST info line — before any per-device output; the old
    // trailing "N found" after the per-device lines read like an afterthought.
    expect(infos[0]).toBe("info: Setting up 2 appliance(s) from the Home Connect account...");
    // The initial reachability stamping produces no transition lines at all.
    expect(port.logs.filter(l => l.startsWith("info") && l.includes("is now"))).toHaveLength(0);
  });
});

describe("ApplianceSync program-list flicker guard", () => {
  it("keeps the program dropdown when the available list is refused mid-run", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    appliance(port, "HA-1", "Washer", {
      type: "Washer",
      status: [],
      available: ["LaundryCare.Washer.Program.Cotton"],
    });
    port.getResponses.set(`${base}/programs/available/LaundryCare.Washer.Program.Cotton`, { options: [] });
    await sync.syncAppliances();
    const before = port.objects.get("washer.programs.selectedProgram");
    expect((before?.native as { bshValues: string[] }).bshValues).toEqual(["LaundryCare.Washer.Program.Cotton"]);

    // While a program runs the API refuses the list ("wrong operation state").
    port.getResponses.delete(`${base}/programs/available`);
    port.extendCalls.length = 0;
    await sync.syncAppliances();
    const after = port.objects.get("washer.programs.selectedProgram");
    // The dropdown values survive — the cache knows the programs.
    expect((after?.native as { bshValues: string[] }).bshValues).toEqual(["LaundryCare.Washer.Program.Cotton"]);
    // And the start/stop buttons are still justified by the cached list.
    expect(port.objects.has("washer.programs.start")).toBe(true);
  });
});

describe("ApplianceSync definition cache across restarts", () => {
  it("restores the cache from the device object and fetches no definition again", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.washer`]: {
        _id: "",
        type: "device",
        common: {},
        native: {
          haId: "HA-1",
          type: "Washer",
          programOptions: { "LaundryCare.Washer.Program.Cotton": ["spinSpeed"] },
        },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.primeFromObjects();
    await sync.activateProgramOptions("washer", "HA-1", "LaundryCare.Washer.Program.Cotton");
    // No definition request — the persisted cache answers.
    expect(port.getCalls).toHaveLength(0);
  });

  it("persists a freshly fetched definition on the device object", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    port.objects.set("washer", { type: "device", common: {}, native: { haId: "HA-1" } });
    port.getResponses.set("/api/homeappliances/HA-1/programs/available/P.A", {
      options: [{ key: "X.Option.One", type: "Int" }],
    });
    await sync.activateProgramOptions("washer", "HA-1", "P.A");
    const device = port.objects.get("washer");
    expect((device?.native as { programOptions: Record<string, string[]> }).programOptions).toEqual({
      "P.A": ["one"],
    });
    // haId survived the partial native update (merge, not replace).
    expect((device?.native as { haId: string }).haId).toBe("HA-1");
  });
});

describe("ApplianceSync.migrateRenamedStates", () => {
  /** Devices + states as an earlier adapter version left them in the DB. */
  function legacyDb(port: FakePort): void {
    port.primeDevices = {
      [`${NS}.fridge`]: {
        _id: "",
        type: "device",
        common: {},
        native: { haId: "HA-F", type: "FridgeFreezer" },
      } as unknown as ioBroker.Object,
      [`${NS}.washer`]: {
        _id: "",
        type: "device",
        common: {},
        native: { haId: "HA-W", type: "WasherDryer" },
      } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      // Mis-channeled nested setting, read-only by accident, with history config.
      [`${NS}.fridge.misc.brightness`]: {
        _id: "",
        type: "state",
        common: {
          name: "brightness",
          type: "number",
          role: "value",
          unit: "%",
          write: false,
          custom: { "influxdb.0": { enabled: true } },
        },
        native: { bshKey: "Refrigeration.Common.Setting.Light.Internal.Brightness" },
      } as unknown as ioBroker.Object,
      // Mis-channeled per-compartment door (text) → boolean under status.
      [`${NS}.fridge.misc.freezer`]: {
        _id: "",
        type: "state",
        common: { name: "freezer", type: "string", role: "text", write: false },
        native: { bshKey: "Refrigeration.Common.Status.Door.Freezer" },
      } as unknown as ioBroker.Object,
      // A fridge has no programs — the whole channel goes.
      [`${NS}.fridge.programs.activeProgram`]: {
        _id: "",
        type: "state",
        common: { name: "activeProgram", type: "string", role: "text", write: false },
        native: { bshKey: "BSH.Common.Root.ActiveProgram" },
      } as unknown as ioBroker.Object,
      // Door text state of a lockable type → doorOpen + doorLocked booleans.
      [`${NS}.washer.status.doorState`]: {
        _id: "",
        type: "state",
        common: { name: "doorState", type: "string", role: "text", write: false },
        native: { bshKey: "BSH.Common.Status.DoorState" },
      } as unknown as ioBroker.Object,
      // Already in its right place — must stay untouched.
      [`${NS}.washer.status.operationState`]: {
        _id: "",
        type: "state",
        common: { name: "operationState", type: "string", role: "text", write: false },
        native: { bshKey: "BSH.Common.Status.OperationState" },
      } as unknown as ioBroker.Object,
    };
    for (const [fullId, obj] of Object.entries(port.primeStates)) {
      port.objects.set(fullId.slice(`${NS}.`.length), obj as ioBroker.PartialObject);
    }
    port.objects.set("fridge.misc", { type: "channel", common: { name: "misc" }, native: {} });
    port.states.set("fridge.misc.brightness", 70);
    port.states.set("washer.status.doorState", "locked");
  }

  it("moves mis-channeled states to their real place, carrying value + history config", async () => {
    const port = new FakePort();
    legacyDb(port);
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();

    const migrated = port.objects.get("fridge.settings.lightInternalBrightness");
    expect(migrated).toBeDefined();
    expect(migrated?.common).toMatchObject({ unit: "%", write: true, custom: { "influxdb.0": { enabled: true } } });
    expect(port.states.get("fridge.settings.lightInternalBrightness")).toBe(70);
    expect(port.objects.has("fridge.misc.brightness")).toBe(false);
    // The drained misc channel object is gone too.
    expect(port.objects.has("fridge.misc")).toBe(false);
  });

  it("reshapes a door text state into the boolean pair", async () => {
    const port = new FakePort();
    legacyDb(port);
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();

    expect(port.states.get("washer.status.doorOpen")).toBe(false);
    expect(port.states.get("washer.status.doorLocked")).toBe(true);
    expect(port.objects.has("washer.status.doorState")).toBe(false);
    expect(port.states.get("fridge.status.doorFreezerOpen")).toBe(false);
  });

  it("removes the programs channel of a program-less appliance type", async () => {
    const port = new FakePort();
    legacyDb(port);
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();
    expect(port.objects.has("fridge.programs.activeProgram")).toBe(false);
  });

  it("leaves states alone that are already in their place", async () => {
    const port = new FakePort();
    legacyDb(port);
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();
    expect(port.objects.has("washer.status.operationState")).toBe(true);
    expect(port.deleted).not.toContain("washer.status.operationState");
  });

  it("reports a summary instead of one line per datapoint", async () => {
    const port = new FakePort();
    legacyDb(port);
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();
    expect(port.logs.filter(l => l.startsWith("info") && l.includes("Migrated"))).toHaveLength(1);
  });

  it("does nothing on a tree that is already current", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    await sync.migrateRenamedStates();
    expect(port.deleted).toEqual([]);
    expect(port.logs.filter(l => l.startsWith("info"))).toEqual([]);
  });
});

describe("ApplianceSync definition-cache robustness", () => {
  it("does not cache a half-shaped definition response as 'no options'", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    // A record that carries neither an options list nor the program key — a shape
    // we do not understand must be retried, not remembered as an empty program.
    port.getResponses.set(`${base}/programs/available/P.A`, { unexpected: true });
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    // The endpoint recovers → the option appears (a cached failure would block this).
    port.getResponses.set(`${base}/programs/available/P.A`, { options: [{ key: "X.Option.One", type: "Int" }] });
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    expect(port.objects.has("w.options.one")).toBe(true);
  });

  it("caches a well-formed program without options as empty", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    const base = "/api/homeappliances/HA-1";
    port.getResponses.set(`${base}/programs/available/P.A`, { key: "P.A" });
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    port.getCalls.length = 0;
    await sync.activateProgramOptions("w", "HA-1", "P.A");
    expect(port.getCalls).toHaveLength(0);
  });
});

describe("ApplianceSync type-plate device ids", () => {
  it("names the device folder after the E-number and keeps the app name as display name", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "015090396331005775", "Geschirrspüler", { enumber: "SX87TX02CE/60", vib: "SX87TX02CE" });
    await sync.syncAppliances();

    // The folder id is the type plate's E-number — stable and model-identifying;
    // the mutable app name would freeze a snapshot ("geschirrspueler") forever.
    expect(port.objects.has("sx87tx02ce-60")).toBe(true);
    expect(port.objects.get("sx87tx02ce-60")?.common?.name).toBe("Geschirrspüler");
    expect(port.objects.has("geschirrspueler")).toBe(false);
  });

  it("falls back to the model code when the record has no E-number", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "875070392600001079", "Waschtrockner", { type: "WasherDryer", enumber: "", vib: "WN54C2A40" });
    await sync.syncAppliances();
    expect(port.objects.has("wn54c2a40")).toBe(true);
  });

  it("disambiguates two appliances of the identical model via the haId", async () => {
    const port = new FakePort();
    const sync = new ApplianceSync(port);
    appliance(port, "HA-AAAA1111", "Geschirrspüler", { enumber: "SX87TX02CE/60" });
    appliance(port, "HA-BBBB2222", "Geschirrspüler unten", { enumber: "SX87TX02CE/60" });
    await sync.syncAppliances();

    // Two identical machines share the E-number — the second gets the tail of
    // its serial-carrying haId, so writes can never collapse onto one tree.
    expect(port.objects.has("sx87tx02ce-60")).toBe(true);
    expect(port.objects.has("sx87tx02ce-60-2222")).toBe(true);
    expect(port.objects.get("sx87tx02ce-60-2222")?.common?.name).toBe("Geschirrspüler unten");
  });
});

describe("ApplianceSync.migrateDeviceIds", () => {
  /** A legacy name-based tree as v1.12 left it in the DB, mirrored into the live maps. */
  function legacyTree(port: FakePort): void {
    port.primeDevices = {
      [`${NS}.geschirrspueler`]: {
        _id: "",
        type: "device",
        common: { name: "Geschirrspüler", statusStates: { onlineId: `${NS}.geschirrspueler.info.reachable` } },
        native: { haId: "HA-1", type: "Dishwasher", enumber: "SX87TX02CE/60", vib: "SX87TX02CE" },
      } as unknown as ioBroker.Object,
    };
    port.primeChannels = {
      [`${NS}.geschirrspueler.settings`]: {
        _id: "",
        type: "channel",
        common: { name: "settings" },
        native: {},
      } as unknown as ioBroker.Object,
    };
    port.primeStates = {
      [`${NS}.geschirrspueler.settings.childLock`]: {
        _id: "",
        type: "state",
        common: {
          name: "Kindersicherung",
          type: "boolean",
          role: "switch",
          read: true,
          write: true,
          custom: { "history.0": { enabled: true } },
        },
        native: { bshKey: "BSH.Common.Setting.ChildLock" },
      } as unknown as ioBroker.Object,
    };
    for (const map of [port.primeDevices, port.primeChannels, port.primeStates]) {
      for (const [fullId, obj] of Object.entries(map)) {
        port.objects.set(fullId.slice(`${NS}.`.length), obj as ioBroker.PartialObject);
      }
    }
    port.states.set("geschirrspueler.settings.childLock", true);
  }

  it("moves the whole tree to the E-number id, carrying names, history config and values", async () => {
    const port = new FakePort();
    legacyTree(port);
    const sync = new ApplianceSync(port);
    await sync.migrateDeviceIds();

    const device = port.objects.get("sx87tx02ce-60") as {
      common?: { name?: string; statusStates?: { onlineId?: string } };
    };
    expect(device).toBeDefined();
    expect(device.common?.name).toBe("Geschirrspüler");
    // The marker link must follow — pointing at the old folder would leave the
    // green/grey dot reading a state that never updates again.
    expect(device.common?.statusStates?.onlineId).toBe(`${NS}.sx87tx02ce-60.info.reachable`);
    expect(port.objects.has("sx87tx02ce-60.settings")).toBe(true);
    const state = port.objects.get("sx87tx02ce-60.settings.childLock");
    expect(state?.common).toMatchObject({ name: "Kindersicherung", custom: { "history.0": { enabled: true } } });
    expect(port.states.get("sx87tx02ce-60.settings.childLock")).toBe(true);
    expect(port.objects.has("geschirrspueler")).toBe(false);
    expect(port.logs.filter(l => l.startsWith("info") && l.includes("moved to sx87tx02ce-60"))).toHaveLength(1);
  });

  it("leaves a tree alone that is already on the scheme", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.sx87tx02ce-60`]: {
        _id: "",
        type: "device",
        common: { name: "Geschirrspüler" },
        native: { haId: "HA-1", enumber: "SX87TX02CE/60" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.migrateDeviceIds();
    expect(port.deleted).toEqual([]);
    expect(port.logs.filter(l => l.startsWith("info"))).toEqual([]);
  });

  it("keeps a tree whose stored native has no plate data yet (moves on a later start)", async () => {
    const port = new FakePort();
    port.primeDevices = {
      [`${NS}.geschirrspueler`]: {
        _id: "",
        type: "device",
        common: { name: "Geschirrspüler" },
        native: { haId: "HA-1" },
      } as unknown as ioBroker.Object,
    };
    const sync = new ApplianceSync(port);
    await sync.migrateDeviceIds();
    // Guessing an id here would move the tree twice (once now, once when the
    // E-number arrives) — waiting one start costs nothing.
    expect(port.deleted).toEqual([]);
  });

  it("never merges into an id another appliance still occupies", async () => {
    const port = new FakePort();
    port.primeDevices = {
      // The dishwasher's target id is occupied by ANOTHER appliance the user
      // happened to NAME like the model code.
      [`${NS}.geschirrspueler`]: {
        _id: "",
        type: "device",
        common: { name: "Geschirrspüler" },
        native: { haId: "HA-AAAA1111", enumber: "SX87TX02CE/60" },
      } as unknown as ioBroker.Object,
      [`${NS}.sx87tx02ce-60`]: {
        _id: "",
        type: "device",
        common: { name: "sx87tx02ce-60" },
        native: { haId: "HA-BBBB2222", enumber: "KG49NSBBF/03" },
      } as unknown as ioBroker.Object,
    };
    for (const [fullId, obj] of Object.entries(port.primeDevices)) {
      port.objects.set(fullId.slice(`${NS}.`.length), obj as ioBroker.PartialObject);
    }
    const sync = new ApplianceSync(port);
    await sync.migrateDeviceIds();

    // Merging two trees loses one of them — the blocked target gets a suffix.
    expect(port.objects.has("sx87tx02ce-60-1111")).toBe(true);
    expect(port.objects.has("kg49nsbbf-03")).toBe(true);
    expect(port.objects.has("sx87tx02ce-60")).toBe(false);
    expect(port.objects.has("geschirrspueler")).toBe(false);
  });
});
