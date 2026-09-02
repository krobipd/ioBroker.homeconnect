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
/**
 * Give up on a connect attempt that produced no response headers within this
 * window. The keep-alive watchdog only exists once the body streams — a
 * connect that hangs before that (TCP up, no answer) would otherwise never end,
 * and with it the whole live-update path.
 */
export const CONNECT_TIMEOUT_MS = 30_000;

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
  /**
   * Called when the stream endpoint rejects the token (401). The adapter
   * refreshes the token; the next attempt then carries the fresh one. Without
   * this, a token revoked server-side would keep the stream dead until the
   * periodic refresh notices the expiry — up to a day later.
   */
  onUnauthorized?: () => Promise<boolean>;
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
  private connectTimer: unknown;
  private failures = 0;
  /** Whether the "connected" info line was already logged this session (reconnects stay on debug). */
  private loggedConnected = false;
  /** Whether the current failing spell was already warned about (repeats → debug, recovery → info). */
  private failureWarned = false;
  /** The reason of the last failed connect attempt, cleared once the stream is up (for the connection test). */
  private lastFailure: string | undefined;

  /**
   * @param deps adapter-provided transport, callbacks, log and managed timers
   */
  constructor(private readonly deps: EventStreamDeps) {}

  /** Current epoch-ms (injected clock in tests, Date.now otherwise). */
  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** The reason the last connect attempt failed, or undefined while the stream is up / never failed. */
  get lastError(): string | undefined {
    return this.lastFailure;
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
    this.clearConnectTimer();
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
    const abort = new AbortController();
    this.abort = abort;
    let connectedAt: number | undefined;
    // Bound the connect phase: no headers within the window → abort → retry.
    this.connectTimer = this.deps.setTimer(() => {
      this.deps.log("debug", "event stream connect timed out.");
      abort.abort();
    }, CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(new URL(EVENTS_PATH, this.deps.baseUrl), {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: abort.signal,
      });
      this.clearConnectTimer();
      if (!res.ok || !res.body) {
        this.noteConnectFailure(`status ${res.status}`);
        if (res.status === 401 && this.deps.onUnauthorized) {
          // A rejected token: refresh it now so the retry can succeed, instead of
          // backing off against a token the server will never accept again.
          await this.deps.onUnauthorized();
        }
        return;
      }
      connectedAt = this.now();
      this.lastFailure = undefined;
      this.deps.onConnected(true);
      if (this.failureWarned) {
        // The user saw the warning; without this they cannot tell it recovered.
        this.deps.log("info", "Home Connect event stream connected again.");
        this.failureWarned = false;
      } else {
        // First connect of the session gets an info line; reconnects stay on
        // debug so a flapping stream can't spam the log.
        this.deps.log(this.loggedConnected ? "debug" : "info", "Home Connect event stream connected.");
      }
      this.loggedConnected = true;
      await this.pump(res.body);
    } catch (e) {
      this.clearConnectTimer();
      if (!this.stopped) {
        if (connectedAt === undefined) {
          this.noteConnectFailure(errMessage(e));
        } else {
          this.deps.log("debug", `event stream ended: ${errMessage(e)}`);
        }
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
      this.clearConnectTimer();
      this.abort = undefined;
    }
  }

  /**
   * Report a failed connect attempt: the first of a failing spell warns (the
   * user should know live updates are paused), repeats stay on debug, and the
   * next successful connect announces the recovery.
   *
   * @param reason what went wrong ("status 503", a transport error)
   */
  private noteConnectFailure(reason: string): void {
    this.lastFailure = reason;
    const level = this.failureWarned ? "debug" : "warn";
    this.deps.log(level, `event stream connect failed (${reason}) — live updates are paused until it reconnects.`);
    this.failureWarned = true;
  }

  /** Cancel the connect-phase watchdog. */
  private clearConnectTimer(): void {
    if (this.connectTimer) {
      this.deps.clearTimer(this.connectTimer);
      this.connectTimer = undefined;
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
