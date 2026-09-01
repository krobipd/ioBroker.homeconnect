import { vi } from "vitest";

/**
 * Orchestration tests for the adapter lifecycle. `@iobroker/adapter-core` is
 * stubbed with a minimal Adapter base class carrying in-memory object/state
 * stores and a REVERSIBLE encrypt/decrypt (base64) — a pass-through would make
 * the stored token's two formats indistinguishable and hide the migration path.
 * The HTTP layer is mocked; the three collaborators are replaced through the
 * factory seams in main.ts. Nothing here touches the network.
 */
vi.mock("@iobroker/adapter-core", () => {
  class Adapter {
    public log = { silly: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    public namespace = "homeconnect.0";
    public language: string | undefined = undefined;
    public config: Record<string, unknown> = {};
    public objects = new Map<string, Record<string, unknown>>();
    public states = new Map<string, { val: unknown; ack: boolean }>();
    public subscribed: string[] = [];
    public on = vi.fn();
    public registerNotification = vi.fn(async () => undefined);
    /** Reversible on purpose: the encrypted and the legacy cleartext form must stay distinguishable. */
    public encrypt = vi.fn((s: string) => `enc:${Buffer.from(s, "utf8").toString("base64")}`);
    public decrypt = vi.fn((s: string) => {
      if (!s.startsWith("enc:")) {
        throw new Error("not encrypted with this instance's secret");
      }
      return Buffer.from(s.slice(4), "base64").toString("utf8");
    });
    private key(id: string): string {
      return id.replace(`${this.namespace}.`, "");
    }
    public setState = vi.fn(async (id: string, state: unknown) => {
      const s = state as { val?: unknown; ack?: boolean };
      this.states.set(this.key(id), { val: s?.val, ack: s?.ack === true });
    });
    public setStateChangedAsync = vi.fn(async (id: string, state: unknown) => this.setState(id, state));
    public getStateAsync = vi.fn(async (id: string) => this.states.get(this.key(id)) ?? null);
    public getObjectAsync = vi.fn(async (id: string) => this.objects.get(this.key(id)) ?? null);
    public setObjectNotExistsAsync = vi.fn(async (id: string, obj: Record<string, unknown>) => {
      if (!this.objects.has(this.key(id))) {
        this.objects.set(this.key(id), obj);
      }
    });
    public extendObject = vi.fn(async (id: string, obj: Record<string, unknown>) => {
      this.objects.set(this.key(id), { ...(this.objects.get(this.key(id)) ?? {}), ...obj });
    });
    public getAdapterObjectsAsync = vi.fn(async () => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of this.objects) {
        out[`${this.namespace}.${k}`] = v;
      }
      return out;
    });
    public getForeignObjectsAsync = vi.fn(async () => ({}));
    public delObjectAsync = vi.fn(async (id: string, opts?: { recursive?: boolean }) => {
      const key = this.key(id);
      for (const k of [...this.objects.keys()]) {
        if (k === key || (opts?.recursive && k.startsWith(`${key}.`))) {
          this.objects.delete(k);
        }
      }
    });
    public subscribeStatesAsync = vi.fn(async (pattern: string) => {
      this.subscribed.push(pattern);
    });
    public setInterval = vi.fn(() => ({ kind: "interval" }) as unknown);
    public clearInterval = vi.fn();
    public setTimeout = vi.fn(() => ({ kind: "timeout" }) as unknown);
    public clearTimeout = vi.fn();
    constructor(_opts: unknown) {}
  }
  return { Adapter };
});

const httpMock = vi.hoisted(() => ({
  getJson: vi.fn(),
  putJson: vi.fn(),
  deleteJson: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock("./lib/http", () => httpMock);

import { Homeconnect } from "./main";
import type { JsonResult } from "./lib/http";
import type { WriteRequest } from "./lib/command-dispatch";

const okResult = (data: unknown = { fine: true }): JsonResult => ({
  status: 200,
  ok: true,
  data,
  error: undefined,
});
const failResult = (status: number, extra: Partial<JsonResult> = {}): JsonResult => ({
  status,
  ok: false,
  data: undefined,
  error: `status ${status}`,
  ...extra,
});

interface FakeSync {
  migrateDeviceIds: ReturnType<typeof vi.fn>;
  migrateRenamedStates: ReturnType<typeof vi.fn>;
  primeFromObjects: ReturnType<typeof vi.fn>;
  syncAppliances: ReturnType<typeof vi.fn>;
  markAllUnreachable: ReturnType<typeof vi.fn>;
  handleStreamEvent: ReturnType<typeof vi.fn>;
  handleWrite: ReturnType<typeof vi.fn>;
  port: Record<string, (...a: never[]) => unknown>;
}
interface FakeAuthCtl {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  refreshNow: ReturnType<typeof vi.fn>;
  accessToken: string | undefined;
  port: Record<string, (...a: never[]) => unknown>;
}
interface FakeStream {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  deps: Record<string, (...a: never[]) => unknown>;
}

/** Typed access to the private members the orchestration tests drive. */
function internalOf(adapter: Homeconnect): {
  onReady(): Promise<void>;
  onUnload(cb: () => void): void;
  onStateChange(id: string, state: unknown): void;
  apiGet(path: string): Promise<unknown>;
  apiWrite(req: WriteRequest): Promise<JsonResult | undefined>;
  acceptLanguage(): string | undefined;
  notifyUser(msg: string): void;
  authCtl: FakeAuthCtl | undefined;
  eventStream: FakeStream | undefined;
  sync: FakeSync | undefined;
  restBlockedUntil: number;
  objects: Map<string, Record<string, unknown>>;
  states: Map<string, { val: unknown; ack: boolean }>;
  config: Record<string, unknown>;
  language: string | undefined;
  log: Record<"debug" | "info" | "warn" | "error", ReturnType<typeof vi.fn>>;
  subscribed: string[];
  registerNotification: ReturnType<typeof vi.fn>;
  encrypt(s: string): string;
  makeSync: unknown;
  makeAuthController: unknown;
  makeEventStream: unknown;
} {
  return adapter as never;
}

interface Ctx {
  i: ReturnType<typeof internalOf>;
  syncs: FakeSync[];
  auths: FakeAuthCtl[];
  streams: FakeStream[];
}

/**
 * Build an adapter with fake collaborators and a config.
 *
 * @param config native config fields for this run
 */
function setup(config: Record<string, unknown> = {}): Ctx {
  const i = internalOf(new Homeconnect());
  i.config = { clientID: "cid", clientSecret: "sec", ...config };
  const syncs: FakeSync[] = [];
  const auths: FakeAuthCtl[] = [];
  const streams: FakeStream[] = [];

  i.makeSync = (port: Record<string, (...a: never[]) => unknown>) => {
    const s: FakeSync = {
      port,
      migrateDeviceIds: vi.fn(async () => undefined),
      migrateRenamedStates: vi.fn(async () => undefined),
      primeFromObjects: vi.fn(async () => undefined),
      syncAppliances: vi.fn(async () => undefined),
      markAllUnreachable: vi.fn(async () => undefined),
      handleStreamEvent: vi.fn(),
      handleWrite: vi.fn(async () => undefined),
    };
    syncs.push(s);
    return s;
  };
  i.makeAuthController = (_auth: unknown, port: Record<string, (...a: never[]) => unknown>) => {
    const a: FakeAuthCtl = {
      port,
      accessToken: "AT",
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      refreshNow: vi.fn(async () => false),
    };
    auths.push(a);
    return a;
  };
  i.makeEventStream = (deps: Record<string, (...a: never[]) => unknown>) => {
    const s: FakeStream = { deps, start: vi.fn(), stop: vi.fn() };
    streams.push(s);
    return s;
  };
  return { i, syncs, auths, streams };
}

beforeEach(() => {
  vi.clearAllMocks();
  httpMock.getJson.mockResolvedValue(okResult());
  httpMock.putJson.mockResolvedValue(okResult());
  httpMock.deleteJson.mockResolvedValue(okResult());
  httpMock.postForm.mockResolvedValue({ status: 200, ok: true, body: {} });
});

describe("Homeconnect onReady", () => {
  it("starts the sign-in and reports itself disconnected until it succeeds", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    // A green instance before the token exists tells the user everything is fine
    // while nothing works.
    expect(ctx.i.states.get("info.connection")).toEqual({ val: false, ack: true });
    expect(ctx.auths[0].start).toHaveBeenCalledTimes(1);
  });

  it("stops with a hint and starts nothing without credentials", async () => {
    for (const config of [{ clientID: "" }, { clientSecret: "" }]) {
      const ctx = setup(config);
      await ctx.i.onReady();
      expect(ctx.i.log.warn).toHaveBeenCalledWith(expect.stringContaining("No Home Connect client ID / secret"));
      // Running the device flow against an empty client id produces a stream of
      // rejected requests and a sign-in link that can never work.
      expect(ctx.auths).toHaveLength(0);
      expect(ctx.syncs).toHaveLength(0);
    }
  });

  it("removes the previous generation's trees before anything is primed", async () => {
    const ctx = setup();
    ctx.i.objects.set("SIEMENS-HCS02-0011", { type: "folder", native: {} });
    ctx.i.objects.set("SIEMENS-HCS02-0011.status.BSH_Common_Status_DoorState", { type: "state", native: {} });
    ctx.i.objects.set("auth.session", { type: "state", native: {} });

    await ctx.i.onReady();
    expect(ctx.i.objects.has("SIEMENS-HCS02-0011")).toBe(false);
    expect(ctx.i.objects.has("SIEMENS-HCS02-0011.status.BSH_Common_Status_DoorState")).toBe(false);
    // The sign-in must survive the migration — otherwise every user has to
    // re-authorise after the update.
    expect(ctx.i.objects.has("auth.session")).toBe(true);
    expect(ctx.i.log.info).toHaveBeenCalledWith(expect.stringContaining("1 object tree(s) of the previous"));
  });

  it("plans the cleanup only from this instance's own objects", async () => {
    const ctx = setup();
    ctx.i.objects.set("auth.session", { type: "state", native: {} });
    const get = (ctx.i as unknown as { getAdapterObjectsAsync: ReturnType<typeof vi.fn> }).getAdapterObjectsAsync;
    get.mockResolvedValue({
      "homeconnect.0.auth.session": { type: "state", native: {} },
      // A foreign id has no business here, but a mis-scoped view would put one in.
      // Planning from the raw id would aim a recursive delete at another adapter.
      "other.0.SIEMENS-X.status.BSH_Common_Status_DoorState": { type: "state", native: {} },
    });

    await ctx.i.onReady();
    const del = (ctx.i as unknown as { delObjectAsync: ReturnType<typeof vi.fn> }).delObjectAsync;
    expect(del).not.toHaveBeenCalled();
  });

  it("says nothing when there is nothing of the previous generation", async () => {
    const ctx = setup();
    ctx.i.objects.set("auth.session", { type: "state", native: {} });
    await ctx.i.onReady();
    expect(ctx.i.log.info).not.toHaveBeenCalledWith(expect.stringContaining("object tree(s) of the previous"));
  });

  it("keeps going when one legacy tree cannot be deleted", async () => {
    const ctx = setup();
    ctx.i.objects.set("SIEMENS-A-0011", { type: "folder", native: {} });
    ctx.i.objects.set("SIEMENS-B-0022", { type: "folder", native: {} });
    const del = (ctx.i as unknown as { delObjectAsync: ReturnType<typeof vi.fn> }).delObjectAsync;
    const real = del.getMockImplementation() as (id: string, o?: unknown) => Promise<void>;
    del.mockImplementation(async (id: string, o?: unknown) => {
      if (id.includes("SIEMENS-A")) {
        throw new Error("locked");
      }
      return real(id, o);
    });

    await ctx.i.onReady();
    expect(ctx.i.objects.has("SIEMENS-B-0022")).toBe(false);
    expect(ctx.i.log.debug).toHaveBeenCalledWith(expect.stringContaining("could not delete SIEMENS-A-0011"));
    // The sign-in must still start — a stuck leftover object is not a reason to
    // leave the adapter dead.
    expect(ctx.auths[0].start).toHaveBeenCalled();
  });

  it("reports a failing start-up instead of dying on an unhandled rejection", async () => {
    const ctx = setup();
    (ctx.i as unknown as { getAdapterObjectsAsync: ReturnType<typeof vi.fn> }).getAdapterObjectsAsync.mockRejectedValue(
      new Error("objects db down"),
    );
    await expect(ctx.i.onReady()).resolves.toBeUndefined();
    expect(ctx.i.log.error).toHaveBeenCalledWith(expect.stringContaining("onReady failed: objects db down"));
  });
});

describe("Homeconnect stored login", () => {
  it("stores the token encrypted, never as readable JSON", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.saveToken({ accessToken: "AT", refreshToken: "RT", accessExpires: 1, scope: "" } as never);

    const stored = ctx.i.states.get("auth.session")?.val as string;
    // The refresh token is a long-lived credential to the user's appliances. In
    // cleartext it is readable by anything that can read the object DB.
    expect(stored).not.toContain("RT");
    expect(() => JSON.parse(stored)).toThrow();
    expect(stored).toBe(ctx.i.encrypt('{"accessToken":"AT","refreshToken":"RT","accessExpires":1,"scope":""}'));
  });

  it("reads back its own encrypted token", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.i.states.set("auth.session", {
      val: ctx.i.encrypt(JSON.stringify({ accessToken: "AT", refreshToken: "SECRET" })),
      ack: true,
    });
    await expect(ctx.auths[0].port.loadRefreshToken()).resolves.toBe("SECRET");
  });

  it("keeps the previous adapter's cleartext login across the update", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    // The old generation stored plain JSON. Without this path every existing user
    // has to run the device flow again after updating.
    ctx.i.states.set("auth.session", { val: JSON.stringify({ refresh_token: "LEGACY" }), ack: true });
    await expect(ctx.auths[0].port.loadRefreshToken()).resolves.toBe("LEGACY");
  });

  it("reports no login for an empty, missing or undecryptable session", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    const load = ctx.auths[0].port.loadRefreshToken as () => Promise<string | undefined>;

    await expect(load()).resolves.toBeUndefined();
    ctx.i.states.set("auth.session", { val: "", ack: true });
    await expect(load()).resolves.toBeUndefined();
    // A session written by a different instance secret: decrypt throws, and an
    // escaping throw here would abort onReady before the device flow could run.
    ctx.i.states.set("auth.session", { val: "gAAAAA-not-ours", ack: true });
    await expect(load()).resolves.toBeUndefined();
    ctx.i.states.set("auth.session", { val: 42 as never, ack: true });
    await expect(load()).resolves.toBeUndefined();
  });
});

describe("Homeconnect sign-in wiring", () => {
  it("primes, syncs, subscribes and opens the stream once signed in", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();

    // Device trees move to the type-plate id scheme first, then renamed states
    // WITHIN a device — both BEFORE priming (the maps must only ever see current
    // ids), and priming BEFORE the REST sync: it fills the maps the write path
    // needs for an appliance that is offline right now.
    expect(ctx.syncs[0].migrateDeviceIds).toHaveBeenCalled();
    expect(ctx.syncs[0].migrateDeviceIds.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.syncs[0].migrateRenamedStates.mock.invocationCallOrder[0],
    );
    expect(ctx.syncs[0].migrateRenamedStates).toHaveBeenCalled();
    expect(ctx.syncs[0].migrateRenamedStates.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.syncs[0].primeFromObjects.mock.invocationCallOrder[0],
    );
    expect(ctx.syncs[0].primeFromObjects).toHaveBeenCalled();
    expect(ctx.syncs[0].primeFromObjects.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.syncs[0].syncAppliances.mock.invocationCallOrder[0],
    );
    expect(ctx.i.subscribed).toEqual(["*"]);
    expect(ctx.streams[0].start).toHaveBeenCalledTimes(1);
  });

  it("stamps every appliance unreachable before the first cloud call", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    const sync = ctx.syncs[0];

    // The appliance list can fail to arrive (expired token, no internet). Without
    // the stamp nothing would ever correct the previous run's "reachable" and the
    // whole tree would sit there green while the adapter knows nothing.
    expect(sync.markAllUnreachable).toHaveBeenCalledTimes(1);
    expect(sync.markAllUnreachable.mock.invocationCallOrder[0]).toBeLessThan(
      sync.syncAppliances.mock.invocationCallOrder[0],
    );
  });

  it("opens exactly one event stream, however often the sign-in completes", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    await ctx.auths[0].port.onSignedIn();
    // A second stream doubles every event and survives onUnload, which only ever
    // sees the newest one.
    expect(ctx.streams).toHaveLength(1);
  });

  it("publishes the verification URL and raises a notification for the user", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await (ctx.auths[0].port.setVerificationUrl as (u: string) => Promise<void>)("https://verify?code=1234");
    expect(ctx.i.states.get("auth.verificationUrl")).toEqual({ val: "https://verify?code=1234", ack: true });

    (ctx.auths[0].port.notify as (m: string) => void)("please sign in");
    expect(ctx.i.registerNotification).toHaveBeenCalledWith("homeconnect", "userActionRequired", "please sign in");
  });

  it("survives a js-controller without the notification subsystem", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.i.registerNotification.mockRejectedValue(new Error("no such scope"));
    // notifyUser is fire-and-forget from a sync caller: an unhandled rejection
    // here takes the whole adapter down over a cosmetic notification.
    expect(() => ctx.i.notifyUser("hi")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.i.log.debug).toHaveBeenCalledWith("Could not raise notification: no such scope");
    expect(ctx.i.log.error).not.toHaveBeenCalled();
  });

  it("routes stream events into the sync and reflects the connection state", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    const deps = ctx.streams[0].deps;

    (deps.onEvent as (e: unknown) => void)({ event: "STATUS", data: "{}", id: "" });
    expect(ctx.syncs[0].handleStreamEvent).toHaveBeenCalledWith({ event: "STATUS", data: "{}", id: "" });

    (deps.onConnected as (c: boolean) => void)(true);
    await Promise.resolve();
    expect(ctx.i.states.get("info.connection")).toEqual({ val: true, ack: true });
    (deps.onConnected as (c: boolean) => void)(false);
    await Promise.resolve();
    expect(ctx.i.states.get("info.connection")).toEqual({ val: false, ack: true });
  });

  it("gives the stream the CURRENT token, not the one from start-up", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    ctx.auths[0].accessToken = "REFRESHED";
    // A captured token would make every reconnect after the first refresh fail
    // with 401 until the adapter is restarted.
    expect((ctx.streams[0].deps.getAccessToken as () => string | undefined)()).toBe("REFRESHED");
  });
});

describe("Homeconnect REST reads", () => {
  it("sends the token and the system language, and unwraps the data", async () => {
    const ctx = setup();
    ctx.i.language = "de";
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(okResult({ status: [] }));

    await expect(ctx.i.apiGet("/api/x")).resolves.toEqual({ status: [] });
    expect(httpMock.getJson).toHaveBeenCalledWith("https://api.home-connect.com", "/api/x", "AT", "de-DE");
  });

  it("asks the API to decide the language when the system language is unmapped", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    expect(ctx.i.acceptLanguage()).toBeUndefined();
    ctx.i.language = "kl";
    expect(ctx.i.acceptLanguage()).toBeUndefined();
    ctx.i.language = "zh-cn";
    expect(ctx.i.acceptLanguage()).toBe("zh-CN");
  });

  it("does not call the API while there is no token", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.auths[0].accessToken = undefined;
    await expect(ctx.i.apiGet("/api/x")).resolves.toBeUndefined();
    expect(httpMock.getJson).not.toHaveBeenCalled();
  });

  it("refreshes once on a 401 and repeats the call with the fresh token", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValueOnce(failResult(401)).mockResolvedValueOnce(okResult({ ok: 1 }));
    ctx.auths[0].refreshNow.mockImplementation(async () => {
      ctx.auths[0].accessToken = "FRESH";
      return true;
    });

    await expect(ctx.i.apiGet("/api/x")).resolves.toEqual({ ok: 1 });
    expect(httpMock.getJson).toHaveBeenCalledTimes(2);
    expect(httpMock.getJson.mock.calls[1][2]).toBe("FRESH");
  });

  it("gives up after one 401 retry instead of looping", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(401));
    ctx.auths[0].refreshNow.mockResolvedValue(true);
    // Without the single-shot retry a permanently rejected token produces an
    // endless refresh/call loop against a rate-limited API.
    await expect(ctx.i.apiGet("/api/x")).resolves.toBeUndefined();
    expect(httpMock.getJson).toHaveBeenCalledTimes(2);
  });

  it("does not repeat the call when the refresh itself failed", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(401));
    ctx.auths[0].refreshNow.mockResolvedValue(false);
    await expect(ctx.i.apiGet("/api/x")).resolves.toBeUndefined();
    expect(httpMock.getJson).toHaveBeenCalledTimes(1);
  });
});

describe("Homeconnect rate limiting", () => {
  const NOW = 1_700_000_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("honours the Retry-After the API sent", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(429, { retryAfterMs: 5_000 }));
    await ctx.i.apiGet("/api/x");
    httpMock.getJson.mockClear();

    await expect(ctx.i.apiGet("/api/y")).resolves.toBeUndefined();
    expect(httpMock.getJson).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + 5_001);
    httpMock.getJson.mockResolvedValue(okResult({ back: true }));
    await expect(ctx.i.apiGet("/api/y")).resolves.toEqual({ back: true });
  });

  it("pauses even when the 429 carried no Retry-After", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(429));
    await ctx.i.apiGet("/api/x");
    httpMock.getJson.mockClear();

    // Hammering on through a 429 is how an app loses its Home Connect quota for
    // the rest of the day.
    await ctx.i.apiGet("/api/y");
    expect(httpMock.getJson).not.toHaveBeenCalled();
    vi.setSystemTime(NOW + 60_001);
    await ctx.i.apiGet("/api/y");
    expect(httpMock.getJson).toHaveBeenCalledTimes(1);
  });

  it("tells the user about a dropped write, but keeps a dropped read quiet", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(429, { retryAfterMs: 30_000 }));
    await ctx.i.apiGet("/api/x");
    ctx.i.log.warn.mockClear();
    ctx.i.log.debug.mockClear();

    await ctx.i.apiGet("/api/y");
    expect(ctx.i.log.warn).not.toHaveBeenCalled();
    expect(ctx.i.log.debug).toHaveBeenCalledWith(expect.stringContaining("REST paused"));

    // A dropped write is a lost user action — silently swallowing it leaves the
    // user staring at a button that did nothing.
    await expect(ctx.i.apiWrite({ method: "PUT", path: "/api/z", body: { key: "k" } })).resolves.toBeUndefined();
    expect(ctx.i.log.warn).toHaveBeenCalledWith(expect.stringContaining("PUT /api/z dropped"));
    expect(httpMock.putJson).not.toHaveBeenCalled();
  });

  it("warns once per failure category, then drops to debug, and says when it recovers", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(500));
    await ctx.i.apiGet("/api/x");
    await ctx.i.apiGet("/api/x");
    expect(ctx.i.log.warn.mock.calls.filter(c => String(c[0]).includes("/api/x failed"))).toHaveLength(1);
    expect(ctx.i.log.debug.mock.calls.filter(c => String(c[0]).includes("/api/x failed"))).toHaveLength(1);

    httpMock.getJson.mockResolvedValue(okResult());
    await ctx.i.apiGet("/api/x");
    expect(ctx.i.log.info).toHaveBeenCalledWith("GET /api/x succeeded again.");

    ctx.i.log.info.mockClear();
    await ctx.i.apiGet("/api/x");
    // Only the FIRST success after a failure is news. Announcing every routine
    // read as a recovery makes the info log useless.
    expect(ctx.i.log.info).not.toHaveBeenCalled();
  });

  it("says nothing at info about a call that never failed", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.i.log.info.mockClear();
    await ctx.i.apiGet("/api/fresh");
    expect(ctx.i.log.info).not.toHaveBeenCalled();
  });

  it("keeps an expected appliance answer out of the warnings entirely", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    // An idle appliance HAS no active program — the API ships that as an HTTP
    // error. Every adapter start next to an idle dishwasher used to warn.
    httpMock.getJson.mockResolvedValue(failResult(404, { error: "SDK.Error.NoProgramActive" }));
    await expect(ctx.i.apiGet("/api/a/programs/active")).resolves.toBeUndefined();
    expect(ctx.i.log.warn).not.toHaveBeenCalled();
    expect(ctx.i.log.debug).toHaveBeenCalledWith(expect.stringContaining("SDK.Error.NoProgramActive"));

    // And it never arms the recovery echo: the next success is routine, not news.
    httpMock.getJson.mockResolvedValue(okResult());
    ctx.i.log.info.mockClear();
    await ctx.i.apiGet("/api/a/programs/active");
    expect(ctx.i.log.info).not.toHaveBeenCalled();
  });
});

describe("Homeconnect REST writes", () => {
  it("routes PUT and DELETE to their transports", async () => {
    const ctx = setup();
    await ctx.i.onReady();

    await ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k", value: 1 } });
    expect(httpMock.putJson).toHaveBeenCalledWith("https://api.home-connect.com", "/api/p", "AT", {
      key: "k",
      value: 1,
    });

    await ctx.i.apiWrite({ method: "DELETE", path: "/api/d" });
    expect(httpMock.deleteJson).toHaveBeenCalledWith("https://api.home-connect.com", "/api/d", "AT");
    expect(httpMock.putJson).toHaveBeenCalledTimes(1);
  });

  it("returns the result so the caller can react to a 409", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.putJson.mockResolvedValue(failResult(409));
    // A rejected write logged as "ok" hides the one failure the user cares most
    // about — the button they just pressed.
    await ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } });
    expect(ctx.i.log.warn).toHaveBeenCalledWith(expect.stringContaining("PUT /api/p failed"));
    expect(ctx.i.log.debug).not.toHaveBeenCalledWith("PUT /api/p ok");

    // ApplianceSync retries a rejected program start with defaults — it can only
    // do that if the status actually comes back.
    await expect(ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } })).resolves.toMatchObject({
      status: 409,
      ok: false,
    });
  });

  it("says when a write works again after a failing spell", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.putJson.mockResolvedValue(failResult(500));
    const req: WriteRequest = { method: "PUT", path: "/api/p", body: { key: "k" } };
    await ctx.i.apiWrite(req);
    expect(ctx.i.log.warn).toHaveBeenCalledWith(expect.stringContaining("PUT /api/p failed"));

    httpMock.putJson.mockResolvedValue(okResult());
    ctx.i.log.info.mockClear();
    await ctx.i.apiWrite(req);
    // The user saw the warning; without this they have no way to know the button
    // works again.
    expect(ctx.i.log.info).toHaveBeenCalledWith("PUT /api/p succeeded again.");

    ctx.i.log.info.mockClear();
    await ctx.i.apiWrite(req);
    expect(ctx.i.log.info).not.toHaveBeenCalled();
  });

  it("retries a write once after a 401", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.putJson.mockResolvedValueOnce(failResult(401)).mockResolvedValueOnce(okResult());
    ctx.auths[0].refreshNow.mockImplementation(async () => {
      ctx.auths[0].accessToken = "FRESH";
      return true;
    });

    await expect(ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } })).resolves.toMatchObject({
      ok: true,
    });
    expect(httpMock.putJson.mock.calls[1][2]).toBe("FRESH");
  });

  it("sends nothing while there is no token", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.auths[0].accessToken = undefined;
    await expect(ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } })).resolves.toBeUndefined();
    expect(httpMock.putJson).not.toHaveBeenCalled();
  });
});

describe("Homeconnect state changes", () => {
  it("routes a user write and ignores its own confirmations", async () => {
    const ctx = setup();
    await ctx.i.onReady();

    ctx.i.onStateChange("homeconnect.0.oven.settings.powerState", { val: "off", ack: false });
    expect(ctx.syncs[0].handleWrite).toHaveBeenCalledWith("homeconnect.0.oven.settings.powerState", "off");

    ctx.syncs[0].handleWrite.mockClear();
    // An acked change is the adapter's own echo. Sending it back would turn every
    // confirmation into a new cloud write — an endless loop.
    ctx.i.onStateChange("homeconnect.0.oven.settings.powerState", { val: "off", ack: true });
    ctx.i.onStateChange("homeconnect.0.oven.settings.powerState", null);
    ctx.i.onStateChange("homeconnect.0.oven.settings.powerState", undefined);
    expect(ctx.syncs[0].handleWrite).not.toHaveBeenCalled();
  });

  it("ignores a write before the sign-in built the sync", async () => {
    const ctx = setup({ clientID: "" });
    await ctx.i.onReady();
    expect(() => ctx.i.onStateChange("homeconnect.0.x.y.z", { val: 1, ack: false })).not.toThrow();
  });
});

describe("Homeconnect onUnload", () => {
  it("stops both collaborators, reports disconnected and always calls back", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    const cb = vi.fn();

    await new Promise<void>(resolve => ctx.i.onUnload(() => (cb(), resolve())));
    expect(ctx.auths[0].stop).toHaveBeenCalledTimes(1);
    expect(ctx.streams[0].stop).toHaveBeenCalledTimes(1);
    expect(ctx.i.states.get("info.connection")).toEqual({ val: false, ack: true });
    expect(cb).toHaveBeenCalledTimes(1);
    // Dropping the references stops a late callback from reviving anything.
    expect(ctx.i.authCtl).toBeUndefined();
    expect(ctx.i.eventStream).toBeUndefined();
  });

  it("marks every appliance unreachable before reporting done", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    const sync = ctx.syncs[0];

    // Settle a turn LATER than the call — a write that resolves synchronously
    // would let this pass even with the callback fired first.
    const order: string[] = [];
    sync.markAllUnreachable.mockImplementation(
      async () => new Promise<void>(r => globalThis.setTimeout(() => (order.push("markers"), r()), 0)),
    );

    await new Promise<void>(resolve => ctx.i.onUnload(() => (order.push("callback"), resolve())));

    // Nothing else resets them, and the host's own reset writes to the wrong id —
    // a lost write leaves every appliance green while the adapter is off.
    expect(order).toEqual(["markers", "callback"]);
  });

  it("still reports done when the last write is rejected", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    ctx.syncs[0].markAllUnreachable.mockRejectedValue(new Error("states db down"));

    const cb = vi.fn();
    await new Promise<void>(resolve => ctx.i.onUnload(() => (cb(), resolve())));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ctx.i.log.debug).toHaveBeenCalledWith(expect.stringContaining("Final shutdown write failed"));
  });

  it("still calls back when a teardown step throws", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.auths[0].stop.mockImplementation(() => {
      throw new Error("boom");
    });
    const cb = vi.fn();
    // A missed callback is a SIGKILL — js-controller does not wait.
    expect(() => ctx.i.onUnload(cb)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unloads cleanly before anything was started", async () => {
    const ctx = setup();
    const cb = vi.fn();
    await new Promise<void>(resolve => ctx.i.onUnload(() => (cb(), resolve())));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stops the still-running start-up chain: no REST, no late event stream", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await new Promise<void>(resolve => ctx.i.onUnload(resolve));

    // The sign-in/sync chain is fire-and-forget. On a stop right after start it
    // used to keep syncing past the teardown and re-open the event stream —
    // whose timer the host then refuses ("setTimeout called, but adapter is
    // shutting down") while the tree filled with post-shutdown online markers.
    httpMock.getJson.mockClear();
    await expect(ctx.i.apiGet("/api/x")).resolves.toBeUndefined();
    expect(httpMock.getJson).not.toHaveBeenCalled();
    await expect(ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } })).resolves.toBeUndefined();
    expect(httpMock.putJson).not.toHaveBeenCalled();

    await ctx.auths[0].port.onSignedIn();
    expect(ctx.streams).toHaveLength(0);
  });
});

describe("Homeconnect port wiring", () => {
  it("builds the real collaborators when nothing replaces the seams", () => {
    // The seams exist only for these tests. If one pointed at the wrong class,
    // every test here would still pass while production started nothing.
    const i = internalOf(new Homeconnect());
    expect(typeof i.makeSync).toBe("function");
    expect(typeof i.makeAuthController).toBe("function");
    expect(typeof i.makeEventStream).toBe("function");
    const sync = (i.makeSync as (p: unknown) => object)({ namespace: "homeconnect.0", log: i.log });
    expect(sync.constructor.name).toBe("ApplianceSync");
    const stream = (i.makeEventStream as (d: unknown) => object)({ baseUrl: "https://x" });
    expect(stream.constructor.name).toBe("EventStream");
    const ctl = (i.makeAuthController as (a: unknown, p: unknown) => object)({}, { log: i.log });
    expect(ctl.constructor.name).toBe("AuthController");
  });

  it("hands the sync the adapter APIs its contract names", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    const port = ctx.syncs[0].port as unknown as {
      namespace: string;
      extendObject(id: string, o: unknown): Promise<unknown>;
      setState(id: string, s: unknown): Promise<unknown>;
      setStateChanged(id: string, s: unknown): Promise<unknown>;
      getState(id: string): Promise<unknown>;
      getObject(id: string): Promise<unknown>;
      setObjectNotExists(id: string, o: unknown): Promise<unknown>;
      delObject(id: string): Promise<unknown>;
      getForeignObjects(p: string, t: string): Promise<unknown>;
      apiGet(p: string): Promise<unknown>;
      apiWrite(r: WriteRequest): Promise<unknown>;
    };
    const a = ctx.i as unknown as Record<string, ReturnType<typeof vi.fn>>;

    expect(port.namespace).toBe("homeconnect.0");
    await port.extendObject("oven", { type: "device" });
    expect(ctx.i.objects.get("oven")).toMatchObject({ type: "device" });
    await port.setState("oven.x", { val: 1, ack: true });
    expect(ctx.i.states.get("oven.x")).toEqual({ val: 1, ack: true });
    // setStateChanged must NOT be wired to setState: the sync leans on it to keep
    // the object DB quiet when a value did not move.
    await port.setStateChanged("oven.y", { val: 2, ack: true });
    expect(a.setStateChangedAsync).toHaveBeenCalledWith("oven.y", { val: 2, ack: true });
    await expect(port.getState("oven.x")).resolves.toEqual({ val: 1, ack: true });
    await expect(port.getObject("oven")).resolves.toMatchObject({ type: "device" });
    await port.setObjectNotExists("fresh", { type: "state" });
    expect(ctx.i.objects.has("fresh")).toBe(true);
    // delObject must NOT be recursive here — the sync deletes single stale leaves.
    await port.delObject("oven.x");
    expect(a.delObjectAsync).toHaveBeenLastCalledWith("oven.x");
    await port.getForeignObjects("homeconnect.0.*", "device");
    expect(a.getForeignObjectsAsync).toHaveBeenCalledWith("homeconnect.0.*", "device");

    httpMock.getJson.mockResolvedValue(okResult({ v: 7 }));
    await expect(port.apiGet("/api/q")).resolves.toEqual({ v: 7 });
    await port.apiWrite({ method: "PUT", path: "/api/w", body: { key: "k" } });
    expect(httpMock.putJson).toHaveBeenCalled();
  });

  it("hands the sign-in the adapter's MANAGED timers", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    const port = ctx.auths[0].port as unknown as {
      setTimer(cb: () => void, ms: number): unknown;
      clearTimer(h: unknown): void;
      setIntervalTimer(cb: () => void, ms: number): unknown;
      clearIntervalTimer(h: unknown): void;
      setConnected(c: boolean): Promise<void>;
    };
    const a = ctx.i as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const cb = (): void => {};

    // Native timers are not cleared on unload — js-controller SIGKILLs over them.
    const t = port.setTimer(cb, 10);
    expect(a.setTimeout).toHaveBeenCalledWith(cb, 10);
    port.clearTimer(t);
    expect(a.clearTimeout).toHaveBeenCalledWith(t);
    const iv = port.setIntervalTimer(cb, 20);
    expect(a.setInterval).toHaveBeenCalledWith(cb, 20);
    port.clearIntervalTimer(iv);
    expect(a.clearInterval).toHaveBeenCalledWith(iv);

    await port.setConnected(true);
    expect(ctx.i.states.get("info.connection")).toEqual({ val: true, ack: true });
  });

  it("gives the event stream the adapter's logger and managed timers", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    await ctx.auths[0].port.onSignedIn();
    const deps = ctx.streams[0].deps as unknown as {
      baseUrl: string;
      log(level: "debug" | "info", msg: string): void;
      setTimer(cb: () => void, ms: number): unknown;
      clearTimer(h: unknown): void;
    };
    const a = ctx.i as unknown as Record<string, ReturnType<typeof vi.fn>>;

    expect(deps.baseUrl).toBe("https://api.home-connect.com");
    deps.log("info", "hello");
    expect(ctx.i.log.info).toHaveBeenCalledWith("hello");
    deps.log("debug", "quiet");
    expect(ctx.i.log.debug).toHaveBeenCalledWith("quiet");
    const t = deps.setTimer(() => {}, 30);
    expect(a.setTimeout).toHaveBeenCalled();
    deps.clearTimer(t);
    expect(a.clearTimeout).toHaveBeenCalledWith(t);
  });

  it("posts the OAuth form to the configured host", async () => {
    const ctx = setup();
    let poster: ((p: string, f: Record<string, string>) => Promise<unknown>) | undefined;
    const realMake = ctx.i.makeAuthController as (a: unknown, p: unknown) => unknown;
    ctx.i.makeAuthController = (auth: { post?: unknown }, p: unknown) => {
      poster = (auth as unknown as { post: (p: string, f: Record<string, string>) => Promise<unknown> }).post;
      return realMake(auth, p);
    };
    await ctx.i.onReady();
    await poster?.("/security/oauth/token", { grant_type: "refresh_token" });
    expect(httpMock.postForm).toHaveBeenCalledWith("https://api.home-connect.com", "/security/oauth/token", {
      grant_type: "refresh_token",
    });
  });

  it("does not re-issue a call when the refresh produced no usable token", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue(failResult(401));
    ctx.auths[0].refreshNow.mockImplementation(async () => {
      ctx.auths[0].accessToken = undefined;
      return true;
    });
    // A refresh that reports success but leaves no token would otherwise repeat
    // the call with `undefined` in the Authorization header.
    await expect(ctx.i.apiGet("/api/x")).resolves.toBeUndefined();
    expect(httpMock.getJson).toHaveBeenCalledTimes(1);

    ctx.auths[0].accessToken = "AT";
    httpMock.putJson.mockResolvedValue(failResult(401));
    await ctx.i.apiWrite({ method: "PUT", path: "/api/p", body: { key: "k" } });
    expect(httpMock.putJson).toHaveBeenCalledTimes(1);
  });

  it("does nothing on sign-in when the sync was never built", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    ctx.i.sync = undefined;
    await expect(ctx.auths[0].port.onSignedIn()).resolves.toBeUndefined();
    expect(ctx.i.subscribed).toEqual(["*"]);
  });

  it("names the failure when the API sent no message", async () => {
    const ctx = setup();
    await ctx.i.onReady();
    httpMock.getJson.mockResolvedValue({ status: 503, ok: false, data: undefined, error: undefined });
    await ctx.i.apiGet("/api/x");
    // "GET /api/x failed: undefined" is a bug report nobody can act on.
    expect(ctx.i.log.warn).toHaveBeenCalledWith("GET /api/x failed: unknown");
  });
});
