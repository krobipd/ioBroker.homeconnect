// Home Connect event stream — one persistent Server-Sent-Events connection that
// replaces the old adapter's per-appliance polling and its leaky `eventsource`
// listeners. Uses Node 22 `fetch` streaming + the pure SseParser; timers are
// injected so the adapter owns them (managed, cleared on unload).

import { SseParser, type SseEvent } from "./sse-parser";
import { errMessage } from "./pure-helpers";

/** SSE endpoint for all appliances (the "all" stream also carries PAIRED/DEPAIRED). */
const EVENTS_PATH = "/api/homeappliances/events";
/** Consider the connection dead if no traffic (incl. KEEP-ALIVE) arrives within this window (> 55 s heartbeat). */
const KEEPALIVE_TIMEOUT_MS = 90_000;
/** Reconnect backoff bounds. */
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;
/** A connection that stayed up at least this long counts as healthy → reset the backoff. */
const STABLE_CONNECTION_MS = 60_000;

/** Everything the stream needs from the adapter, injected for testability + managed timers. */
export interface EventStreamDeps {
  /** Region base URL. */
  baseUrl: string;
  /** The current access token, or undefined if not signed in yet. */
  getAccessToken: () => string | undefined;
  /** Called with each non-KEEP-ALIVE event. */
  onEvent: (event: SseEvent) => void;
  /** Called when the connection goes up (true) or down (false). */
  onConnected: (connected: boolean) => void;
  /** Log sink. */
  log: (level: "debug" | "info" | "warn", msg: string) => void;
  /** Schedule a callback (the adapter's managed setTimeout). */
  setTimer: (cb: () => void, ms: number) => unknown;
  /** Cancel a scheduled callback (the adapter's managed clearTimeout). */
  clearTimer: (handle: unknown) => void;
  /** Clock, injectable for deterministic tests (defaults to Date.now). */
  now?: () => number;
}

/** A persistent, self-reconnecting Home Connect event-stream connection. */
export class EventStream {
  private stopped = true;
  private abort: AbortController | undefined;
  private keepAliveTimer: unknown;
  private reconnectTimer: unknown;
  private failures = 0;
  /** Whether the "connected" info line was already logged this session (reconnects stay on debug). */
  private loggedConnected = false;

  /**
   * @param deps adapter-provided transport, callbacks, log and managed timers
   */
  constructor(private readonly deps: EventStreamDeps) {}

  /** Current epoch-ms (injected clock in tests, Date.now otherwise). */
  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Open the stream and keep it open (reconnecting on drop) until {@link stop}. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.failures = 0;
    this.loggedConnected = false;
    this.connect();
  }

  /** Stop the stream and cancel all pending timers (synchronous, for onUnload). */
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.abort = undefined;
    this.clearKeepAlive();
    if (this.reconnectTimer) {
      this.deps.clearTimer(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /** Run one connection attempt, then schedule a reconnect when it ends. */
  private connect(): void {
    if (this.stopped) {
      return;
    }
    void this.streamOnce().then(
      () => this.scheduleReconnect(),
      () => this.scheduleReconnect(),
    );
  }

  /** Wait out the backoff, then connect again. */
  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    this.deps.onConnected(false);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.failures);
    this.reconnectTimer = this.deps.setTimer(() => this.connect(), delay);
  }

  /** One connection: stream frames to the parser until it closes or errors. */
  private async streamOnce(): Promise<void> {
    const token = this.deps.getAccessToken();
    if (!token) {
      this.failures++;
      return;
    }
    this.abort = new AbortController();
    let connectedAt: number | undefined;
    try {
      const res = await fetch(new URL(EVENTS_PATH, this.deps.baseUrl), {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: this.abort.signal,
      });
      if (!res.ok || !res.body) {
        this.deps.log("debug", `event stream connect failed (status ${res.status})`);
        return;
      }
      connectedAt = this.now();
      this.deps.onConnected(true);
      // First connect of the session gets an info line; reconnects stay on debug
      // so a flapping stream can't spam the log.
      this.deps.log(this.loggedConnected ? "debug" : "info", "Home Connect event stream connected.");
      this.loggedConnected = true;
      await this.pump(res.body);
    } catch (e) {
      if (!this.stopped) {
        this.deps.log("debug", `event stream ended: ${errMessage(e)}`);
      }
    } finally {
      // A connection that stayed up a while is healthy → reset the backoff. A
      // connect that never came up, or dropped almost immediately (flapping),
      // grows it — so a broken stream backs off instead of reconnecting every 5 s.
      if (connectedAt !== undefined && this.now() - connectedAt >= STABLE_CONNECTION_MS) {
        this.failures = 0;
      } else {
        this.failures++;
      }
      this.clearKeepAlive();
      this.abort = undefined;
    }
  }

  /**
   * Read the response body to completion, decoding + parsing SSE frames and
   * dispatching every non-KEEP-ALIVE event; a stalled stream is aborted by the
   * keep-alive timer.
   *
   * @param body the fetch response body stream
   */
  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    this.armKeepAlive();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      this.armKeepAlive();
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        if (ev.event !== "KEEP-ALIVE") {
          this.deps.onEvent(ev);
        }
      }
    }
  }

  /** (Re)start the keep-alive watchdog — abort the connection if it fires. */
  private armKeepAlive(): void {
    this.clearKeepAlive();
    this.keepAliveTimer = this.deps.setTimer(() => {
      this.deps.log("debug", "event stream keep-alive timed out — reconnecting.");
      this.abort?.abort();
    }, KEEPALIVE_TIMEOUT_MS);
  }

  /** Cancel the keep-alive watchdog. */
  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      this.deps.clearTimer(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }
}
