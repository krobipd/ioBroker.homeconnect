import { describe, it, expect, vi, afterEach } from "vitest";
import { EventStream, type EventStreamDeps } from "./event-stream";

afterEach(() => vi.unstubAllGlobals());

/** A managed-timer + clock harness the adapter would otherwise provide. */
function harness(overrides: Partial<EventStreamDeps> = {}): {
  deps: EventStreamDeps;
  timers: Array<{ cb: () => void; ms: number; handle: object }>;
  clock: { t: number };
  connected: boolean[];
  logs: Array<{ level: string; msg: string }>;
  fireReconnect: () => void;
} {
  const timers: Array<{ cb: () => void; ms: number; handle: object }> = [];
  const clock = { t: 0 };
  const connected: boolean[] = [];
  const logs: Array<{ level: string; msg: string }> = [];
  const deps: EventStreamDeps = {
    baseUrl: "https://api.home-connect.com",
    getAccessToken: () => "TOKEN",
    onEvent: () => {},
    onConnected: c => connected.push(c),
    log: (level, msg) => logs.push({ level, msg }),
    setTimer: (cb, ms) => {
      const handle = {};
      timers.push({ cb, ms, handle });
      return handle;
    },
    clearTimer: handle => {
      const i = timers.findIndex(t => t.handle === handle);
      if (i >= 0) {
        timers.splice(i, 1);
      }
    },
    now: () => clock.t,
    ...overrides,
  };
  // After each attempt settles (keep-alive already cleared), the sole remaining timer is the reconnect.
  const fireReconnect = (): void => {
    const t = timers[timers.length - 1];
    if (t) {
      timers.splice(timers.indexOf(t), 1);
      t.cb();
    }
  };
  return { deps, timers, clock, connected, logs, fireReconnect };
}

/** Let the async connect/pump chain settle. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));

/** A response body whose single read bumps the clock by `ms` then ends (a connection that lasted `ms`). */
function bodyLasting(clock: { t: number }, ms: number): ReadableStream<Uint8Array> {
  return {
    getReader: () => ({
      read: () => {
        clock.t += ms;
        return Promise.resolve({ done: true, value: undefined });
      },
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

describe("EventStream reconnect/backoff", () => {
  it("does not fetch without a token and backs off", async () => {
    const h = harness({ getAccessToken: () => undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    // one reconnect scheduled at the 5s minimum (failures == 1 → MIN * 2^0? no: 2^1 = 10s)
    expect(h.timers.at(-1)?.ms).toBe(10_000);
  });

  it("schedules a reconnect and marks disconnected when the connect fails", async () => {
    const h = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }));
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    expect(h.connected).toContain(false); // scheduleReconnect reported disconnected
    expect(h.timers.at(-1)?.ms).toBe(10_000); // failures == 1
  });

  it("grows the backoff while the connection keeps flapping (short-lived)", async () => {
    const h = harness();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: bodyLasting(h.clock, 2_000) })));
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(10_000); // 1 short connection → failures 1 → 5000*2^1
    h.fireReconnect();
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(20_000); // failures 2
    h.fireReconnect();
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(40_000); // failures 3
  });

  it("resets the backoff after a stable connection", async () => {
    const h = harness();
    // first a flap to raise failures, then a healthy 70s connection resets it
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: bodyLasting(h.clock, ++calls === 1 ? 2_000 : 70_000) })),
    );
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(10_000); // flap → failures 1
    h.fireReconnect();
    await flush();
    expect(h.timers.at(-1)?.ms).toBe(5_000); // stable 70s → failures reset → MIN
  });

  it("logs 'connected' at info once, then reconnects stay on debug", async () => {
    const h = harness();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: bodyLasting(h.clock, 70_000) })));
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    h.fireReconnect();
    await flush();
    const connectedLogs = h.logs.filter(l => l.msg.includes("connected"));
    expect(connectedLogs[0]).toMatchObject({ level: "info" });
    expect(connectedLogs[1]).toMatchObject({ level: "debug" });
  });

  it("stop() cancels the pending reconnect and does not reconnect", async () => {
    const h = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }));
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    expect(h.timers.length).toBe(1);
    es.stop();
    expect(h.timers.length).toBe(0);
  });

  it("aborts the connection when the keep-alive watchdog fires", async () => {
    const h = harness();
    // a body whose read never resolves — the connection stays 'up' until aborted
    const body = { getReader: () => ({ read: () => new Promise(() => {}) }) } as unknown as ReadableStream<Uint8Array>;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    vi.stubGlobal("fetch", fetchMock);
    const es = new EventStream(h.deps);
    es.start();
    await flush();
    // while connected: the keep-alive timer is armed (it is the only pending timer)
    const keepAlive = h.timers.at(-1);
    expect(keepAlive?.ms).toBe(90_000);
    keepAlive?.cb(); // fire the watchdog
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(true);
    es.stop();
  });
});
