"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var event_stream_exports = {};
__export(event_stream_exports, {
  CONNECT_TIMEOUT_MS: () => CONNECT_TIMEOUT_MS,
  EventStream: () => EventStream
});
module.exports = __toCommonJS(event_stream_exports);
var import_sse_parser = require("./sse-parser");
var import_pure_helpers = require("./pure-helpers");
const EVENTS_PATH = "/api/homeappliances/events";
const KEEPALIVE_TIMEOUT_MS = 9e4;
const RECONNECT_MIN_MS = 5e3;
const RECONNECT_MAX_MS = 5 * 6e4;
const STABLE_CONNECTION_MS = 6e4;
const CONNECT_TIMEOUT_MS = 3e4;
class EventStream {
  /**
   * @param deps adapter-provided transport, callbacks, log and managed timers
   */
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  stopped = true;
  abort;
  keepAliveTimer;
  reconnectTimer;
  connectTimer;
  failures = 0;
  /** Whether the "connected" info line was already logged this session (reconnects stay on debug). */
  loggedConnected = false;
  /** Whether the current failing spell was already warned about (repeats → debug, recovery → info). */
  failureWarned = false;
  /** The reason of the last failed connect attempt, cleared once the stream is up (for the connection test). */
  lastFailure;
  /** Current epoch-ms (injected clock in tests, Date.now otherwise). */
  now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }
  /** The reason the last connect attempt failed, or undefined while the stream is up / never failed. */
  get lastError() {
    return this.lastFailure;
  }
  /** Open the stream and keep it open (reconnecting on drop) until {@link stop}. */
  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.failures = 0;
    this.loggedConnected = false;
    this.connect();
  }
  /** Stop the stream and cancel all pending timers (synchronous, for onUnload). */
  stop() {
    var _a;
    this.stopped = true;
    (_a = this.abort) == null ? void 0 : _a.abort();
    this.abort = void 0;
    this.clearKeepAlive();
    this.clearConnectTimer();
    if (this.reconnectTimer) {
      this.deps.clearTimer(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
  }
  /** Run one connection attempt, then schedule a reconnect when it ends. */
  connect() {
    if (this.stopped) {
      return;
    }
    void this.streamOnce().then(
      () => this.scheduleReconnect(),
      () => this.scheduleReconnect()
    );
  }
  /** Wait out the backoff, then connect again. */
  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    this.deps.onConnected(false);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.failures);
    this.reconnectTimer = this.deps.setTimer(() => this.connect(), delay);
  }
  /** One connection: stream frames to the parser until it closes or errors. */
  async streamOnce() {
    const token = this.deps.getAccessToken();
    if (!token) {
      this.failures++;
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    let connectedAt;
    this.connectTimer = this.deps.setTimer(() => {
      this.deps.log("debug", "event stream connect timed out.");
      abort.abort();
    }, CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(new URL(EVENTS_PATH, this.deps.baseUrl), {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: abort.signal
      });
      this.clearConnectTimer();
      if (!res.ok || !res.body) {
        this.noteConnectFailure(`status ${res.status}`);
        if (res.status === 401 && this.deps.onUnauthorized) {
          await this.deps.onUnauthorized();
        }
        return;
      }
      connectedAt = this.now();
      this.lastFailure = void 0;
      this.deps.onConnected(true);
      if (this.failureWarned) {
        this.deps.log("info", "Home Connect event stream connected again.");
        this.failureWarned = false;
      } else {
        this.deps.log(this.loggedConnected ? "debug" : "info", "Home Connect event stream connected.");
      }
      this.loggedConnected = true;
      await this.pump(res.body);
    } catch (e) {
      this.clearConnectTimer();
      if (!this.stopped) {
        if (connectedAt === void 0) {
          this.noteConnectFailure((0, import_pure_helpers.errMessage)(e));
        } else {
          this.deps.log("debug", `event stream ended: ${(0, import_pure_helpers.errMessage)(e)}`);
        }
      }
    } finally {
      if (connectedAt !== void 0 && this.now() - connectedAt >= STABLE_CONNECTION_MS) {
        this.failures = 0;
      } else {
        this.failures++;
      }
      this.clearKeepAlive();
      this.clearConnectTimer();
      this.abort = void 0;
    }
  }
  /**
   * Report a failed connect attempt: the first of a failing spell warns (the
   * user should know live updates are paused), repeats stay on debug, and the
   * next successful connect announces the recovery.
   *
   * @param reason what went wrong ("status 503", a transport error)
   */
  noteConnectFailure(reason) {
    this.lastFailure = reason;
    const level = this.failureWarned ? "debug" : "warn";
    this.deps.log(level, `event stream connect failed (${reason}) \u2014 live updates are paused until it reconnects.`);
    this.failureWarned = true;
  }
  /** Cancel the connect-phase watchdog. */
  clearConnectTimer() {
    if (this.connectTimer) {
      this.deps.clearTimer(this.connectTimer);
      this.connectTimer = void 0;
    }
  }
  /**
   * Read the response body to completion, decoding + parsing SSE frames and
   * dispatching every non-KEEP-ALIVE event; a stalled stream is aborted by the
   * keep-alive timer.
   *
   * @param body the fetch response body stream
   */
  async pump(body) {
    const parser = new import_sse_parser.SseParser();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    this.armKeepAlive();
    for (; ; ) {
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
  armKeepAlive() {
    this.clearKeepAlive();
    this.keepAliveTimer = this.deps.setTimer(() => {
      var _a;
      this.deps.log("debug", "event stream keep-alive timed out \u2014 reconnecting.");
      (_a = this.abort) == null ? void 0 : _a.abort();
    }, KEEPALIVE_TIMEOUT_MS);
  }
  /** Cancel the keep-alive watchdog. */
  clearKeepAlive() {
    if (this.keepAliveTimer) {
      this.deps.clearTimer(this.keepAliveTimer);
      this.keepAliveTimer = void 0;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CONNECT_TIMEOUT_MS,
  EventStream
});
//# sourceMappingURL=event-stream.js.map
