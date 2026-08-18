import { describe, it, expect } from "vitest";
import { AuthController, type AuthPort, SLOW_DOWN_STEP_MS, AUTH_RETRY_MS } from "./auth-controller";
import { HomeConnectAuth, type FormPostResult, type StoredToken } from "./oauth";

const TOKEN_BODY = { access_token: "AT", refresh_token: "RT", expires_in: 86_400, scope: "Monitor Control" };
const DEVICE_BODY = {
  device_code: "DC",
  user_code: "1234",
  verification_uri: "https://verify",
  verification_uri_complete: "https://verify?code=1234",
  interval: 5,
  expires_in: 600,
};

const ok = (body: unknown): FormPostResult => ({ status: 200, ok: true, body });
const fail = (status: number, body: unknown): FormPostResult => ({ status, ok: false, body });

interface Harness {
  ctl: AuthController;
  timers: Array<{ cb: () => void; ms: number; handle: object; interval: boolean }>;
  logs: Array<{ level: string; msg: string }>;
  clock: { t: number };
  calls: Array<{ path: string; form: Record<string, string> }>;
  port: FakeAuthPort;
}

/** A recording in-memory AuthPort — no adapter, no network, injected timers + clock. */
class FakeAuthPort implements AuthPort {
  refreshToken: string | undefined;
  readonly savedTokens: StoredToken[] = [];
  readonly urls: string[] = [];
  readonly connected: boolean[] = [];
  readonly notifications: string[] = [];
  signedIn = 0;

  constructor(
    private readonly timers: Array<{ cb: () => void; ms: number; handle: object; interval: boolean }>,
    private readonly logs: Array<{ level: string; msg: string }>,
    private readonly clock: { t: number },
  ) {}

  readonly log = {
    debug: (msg: string) => this.logs.push({ level: "debug", msg }),
    info: (msg: string) => this.logs.push({ level: "info", msg }),
    warn: (msg: string) => this.logs.push({ level: "warn", msg }),
    error: (msg: string) => this.logs.push({ level: "error", msg }),
    silly: (msg: string) => this.logs.push({ level: "silly", msg }),
  } as unknown as ioBroker.Logger;

  loadRefreshToken(): Promise<string | undefined> {
    return Promise.resolve(this.refreshToken);
  }
  saveToken(token: StoredToken): Promise<void> {
    this.savedTokens.push(token);
    return Promise.resolve();
  }
  setVerificationUrl(url: string): Promise<void> {
    this.urls.push(url);
    return Promise.resolve();
  }
  setConnected(connected: boolean): Promise<void> {
    this.connected.push(connected);
    return Promise.resolve();
  }
  notify(message: string): void {
    this.notifications.push(message);
  }
  onSignedIn(): Promise<void> {
    this.signedIn++;
    return Promise.resolve();
  }
  setTimer(cb: () => void, ms: number): unknown {
    const handle = {};
    this.timers.push({ cb, ms, handle, interval: false });
    return handle;
  }
  clearTimer(handle: unknown): void {
    const i = this.timers.findIndex(t => t.handle === handle);
    if (i >= 0) {
      this.timers.splice(i, 1);
    }
  }
  setIntervalTimer(cb: () => void, ms: number): unknown {
    const handle = {};
    this.timers.push({ cb, ms, handle, interval: true });
    return handle;
  }
  clearIntervalTimer(handle: unknown): void {
    this.clearTimer(handle);
  }
  now = (): number => this.clock.t;
}

/**
 * Build a controller with a queued-response OAuth transport and fake timers.
 *
 * @param results the queued form-POST results, consumed in call order
 * @returns the harness pieces
 */
function harness(results: FormPostResult[]): Harness {
  const clock = { t: 1_700_000_000_000 };
  const calls: Array<{ path: string; form: Record<string, string> }> = [];
  let i = 0;
  const auth = new HomeConnectAuth(
    { clientId: "cid", clientSecret: "sec", baseUrl: "https://api.home-connect.com" },
    (path, form) => {
      calls.push({ path, form });
      const r = results[i++];
      if (!r) {
        throw new Error("harness: no more queued results");
      }
      return Promise.resolve(r);
    },
    () => clock.t,
  );
  const timers: Array<{ cb: () => void; ms: number; handle: object; interval: boolean }> = [];
  const logs: Array<{ level: string; msg: string }> = [];
  const port = new FakeAuthPort(timers, logs, clock);
  return { ctl: new AuthController(auth, port), timers, logs, clock, calls, port };
}

/** Fire the most recently scheduled one-shot timer (the pending poll/retry). */
function firePending(h: Harness): void {
  const t = [...h.timers].reverse().find(x => !x.interval);
  if (!t) {
    throw new Error("no pending one-shot timer");
  }
  h.timers.splice(h.timers.indexOf(t), 1);
  t.cb();
}

/** Let the async chains settle. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));

describe("AuthController start-up", () => {
  it("reuses the stored login and wires up the adapter", async () => {
    const h = harness([ok(TOKEN_BODY)]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(h.ctl.accessToken).toBe("AT");
    expect(h.port.savedTokens).toHaveLength(1);
    expect(h.port.signedIn).toBe(1);
    expect(h.port.connected).toContain(true);
    expect(h.timers.some(t => t.interval)).toBe(true); // refresh check armed
  });

  it("drops to the device flow when the stored login is revoked (invalid_grant)", async () => {
    const h = harness([fail(400, { error: "invalid_grant" }), ok(DEVICE_BODY)]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(h.port.urls).toContain("https://verify?code=1234");
    expect(h.port.notifications).toHaveLength(1);
    expect(h.timers.at(-1)?.ms).toBe(5_000); // device-flow poll pending
  });

  it("keeps the login and retries after a transient refresh failure", async () => {
    const h = harness([fail(500, {})]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(h.calls).toHaveLength(1); // no device_authorization call
    expect(h.timers.at(-1)?.ms).toBe(AUTH_RETRY_MS);
    expect(h.port.notifications).toHaveLength(0);
  });

  it("doubles the start-up retry delay per consecutive failure", async () => {
    const h = harness([fail(500, {}), fail(500, {}), fail(500, {})]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(h.timers.at(-1)?.ms).toBe(AUTH_RETRY_MS); // 30 s
    h.clock.t += 31_000;
    firePending(h);
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(AUTH_RETRY_MS * 2); // 60 s
    h.clock.t += 61_000;
    firePending(h);
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(AUTH_RETRY_MS * 4); // 120 s
  });
});

describe("AuthController device flow", () => {
  it("signs in once the user approved and clears the verification URL", async () => {
    const h = harness([ok(DEVICE_BODY), ok(TOKEN_BODY)]);
    await h.ctl.start();
    firePending(h);
    await flush();
    expect(h.ctl.accessToken).toBe("AT");
    expect(h.port.signedIn).toBe(1);
    expect(h.port.urls.at(-1)).toBe(""); // cleared after approval
  });

  it("grows the poll interval on a slow_down answer", async () => {
    const h = harness([ok(DEVICE_BODY), fail(400, { error: "slow_down" })]);
    await h.ctl.start();
    expect(h.timers.at(-1)?.ms).toBe(5_000);
    firePending(h);
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(5_000 + SLOW_DOWN_STEP_MS);
  });

  it("requests a fresh sign-in link when the code expires unused", async () => {
    const h = harness([ok(DEVICE_BODY), ok({ ...DEVICE_BODY, user_code: "5678" })]);
    await h.ctl.start();
    h.clock.t += 601_000; // past expires_in = 600 s
    firePending(h);
    await flush();
    expect(h.port.urls.at(-2)).toBe(""); // stale link cleared…
    expect(h.port.urls.at(-1)).toBe("https://verify?code=1234"); // …fresh link published
    expect(h.timers.at(-1)?.ms).toBe(5_000); // polling again
    expect(h.port.notifications).toHaveLength(1); // announced only once per episode
  });

  it("requests a fresh sign-in link after a terminal poll error (denied)", async () => {
    const h = harness([ok(DEVICE_BODY), fail(400, { error: "access_denied" }), ok(DEVICE_BODY)]);
    await h.ctl.start();
    firePending(h);
    await flush();
    expect(h.port.urls.at(-2)).toBe("");
    expect(h.port.urls.at(-1)).toBe("https://verify?code=1234");
    expect(h.port.notifications).toHaveLength(1);
  });
});

describe("AuthController runtime refresh", () => {
  it("starts a fresh sign-in when the login is revoked while running", async () => {
    const h = harness([ok(TOKEN_BODY), fail(400, { error: "invalid_grant" }), ok(DEVICE_BODY)]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(await h.ctl.refreshNow()).toBe(false);
    await flush();
    expect(h.ctl.accessToken).toBeUndefined(); // dead token dropped
    expect(h.port.connected).toContain(false);
    expect(h.port.urls).toContain("https://verify?code=1234"); // new sign-in link is out
  });

  it("warns once about a transient refresh failure, then drops to debug, and keeps the token", async () => {
    const h = harness([ok(TOKEN_BODY), fail(500, {}), fail(500, {})]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(await h.ctl.refreshNow()).toBe(false);
    h.clock.t += 31_000; // past the 30 s back-off
    expect(await h.ctl.refreshNow()).toBe(false);
    const failures = h.logs.filter(l => l.msg.includes("token refresh failed"));
    expect(failures.map(l => l.level)).toEqual(["warn", "debug"]);
    expect(h.ctl.accessToken).toBe("AT"); // login kept for the next attempt
  });

  it("backs off between failed refresh attempts (token endpoint has its own quota)", async () => {
    const h = harness([ok(TOKEN_BODY), fail(500, {}), fail(500, {})]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    expect(await h.ctl.refreshNow()).toBe(false);
    const callsAfterFirst = h.calls.length;
    // Within the back-off window: no new hit on the token endpoint.
    expect(await h.ctl.refreshNow()).toBe(false);
    expect(h.calls.length).toBe(callsAfterFirst);
    // After the window: a fresh attempt goes out.
    h.clock.t += 31_000;
    expect(await h.ctl.refreshNow()).toBe(false);
    expect(h.calls.length).toBe(callsAfterFirst + 1);
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    const h = harness([ok(TOKEN_BODY), ok({ ...TOKEN_BODY, access_token: "AT2" })]);
    h.port.refreshToken = "OLD";
    await h.ctl.start();
    const [a, b] = await Promise.all([h.ctl.refreshNow(), h.ctl.refreshNow()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(h.calls).toHaveLength(2); // one start refresh + ONE shared runtime refresh
    expect(h.ctl.accessToken).toBe("AT2");
  });

  it("stop() cancels all pending timers", async () => {
    const h = harness([ok(DEVICE_BODY)]);
    await h.ctl.start();
    expect(h.timers.length).toBeGreaterThan(0);
    h.ctl.stop();
    expect(h.timers).toHaveLength(0);
  });
});
