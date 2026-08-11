"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var main_exports = {};
__export(main_exports, {
  Homeconnect: () => Homeconnect
});
module.exports = __toCommonJS(main_exports);
var utils = __toESM(require("@iobroker/adapter-core"));
var import_oauth = require("./lib/oauth");
var import_http = require("./lib/http");
var import_appliance_sync = require("./lib/appliance-sync");
var import_event_stream = require("./lib/event-stream");
var import_pure_helpers = require("./lib/pure-helpers");
var import_log_dedup = require("./lib/log-dedup");
const DEFAULT_BASE_URL = "https://api.home-connect.com";
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1e3;
const AUTH_RETRY_MS = 30 * 1e3;
const SYSTEM_TO_BSH_LOCALE = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  pt: "pt-PT",
  nl: "nl-NL",
  fr: "fr-FR",
  it: "it-IT",
  es: "es-ES",
  pl: "pl-PL",
  uk: "uk-UA",
  "zh-cn": "zh-CN"
};
const NOTIFY_SCOPE = "homeconnect";
const NOTIFY_CATEGORY = "userActionRequired";
class Homeconnect extends utils.Adapter {
  auth;
  token;
  refreshTimer;
  deviceFlowTimer;
  authRetryTimer;
  eventStream;
  sync;
  /** In-flight token refresh, shared by concurrent 401 callers (re-armed after it settles). */
  refreshing;
  /** Epoch-ms until which REST calls are paused after a 429 (honours Retry-After). */
  restBlockedUntil = 0;
  /** warn-once-per-category dedup for REST failures (keyed on call source + status band). */
  restLog = new import_log_dedup.LogDedup();
  /**
   * @param options adapter options passed through by js-controller
   */
  constructor(options = {}) {
    super({
      ...options,
      name: "homeconnect"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /** Adapter start. Async body with a top-level try/catch (never a call-site .catch). */
  async onReady() {
    try {
      await this.setState("info.connection", { val: false, ack: true });
      const clientId = this.config.clientID;
      const clientSecret = this.config.clientSecret;
      if (!clientId || !clientSecret) {
        this.log.warn(
          "No Home Connect client ID / secret configured \u2014 open the adapter settings and enter your developer application credentials."
        );
        return;
      }
      this.sync = new import_appliance_sync.ApplianceSync(this.makePort());
      this.auth = new import_oauth.HomeConnectAuth(
        { clientId, clientSecret, baseUrl: DEFAULT_BASE_URL },
        (path, form) => (0, import_http.postForm)(DEFAULT_BASE_URL, path, form)
      );
      await this.authenticate(this.auth);
    } catch (e) {
      this.log.error(`onReady failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /** Build the port ApplianceSync talks to the adapter through. */
  makePort() {
    return {
      namespace: this.namespace,
      log: this.log,
      extendObject: (id, obj) => this.extendObject(id, obj),
      setState: (id, state) => this.setState(id, state),
      setStateChanged: (id, state) => this.setStateChangedAsync(id, state),
      getState: (id) => this.getStateAsync(id),
      delObject: (id) => this.delObjectAsync(id),
      getForeignObjects: (pattern, type) => this.getForeignObjectsAsync(pattern, type),
      apiGet: (path) => this.apiGet(path),
      apiWrite: (req) => this.apiWrite(req)
    };
  }
  /**
   * Obtain a valid access token: reuse the stored refresh token if there is one,
   * otherwise run the device flow. A refresh that fails because the token was
   * revoked (`invalid_grant`) drops to a fresh device-flow sign-in; a transient
   * failure (network / 5xx / timeout) keeps the stored token and just retries,
   * so a blip during a restart does not force the user to re-authorise.
   *
   * @param auth the configured OAuth flow driver
   */
  async authenticate(auth) {
    const refreshToken = await this.loadRefreshToken();
    if (refreshToken) {
      try {
        await this.applyToken(await auth.refresh(refreshToken));
        this.log.info("Home Connect: signed in (reused the stored login).");
        await this.onAuthenticated();
        return;
      } catch (e) {
        if (e instanceof import_oauth.OAuthError && e.oauthError === "invalid_grant") {
          this.log.warn("Stored login is no longer valid \u2014 a new device-flow sign-in is required.");
        } else {
          this.log.warn(`Stored login could not be refreshed (${(0, import_pure_helpers.errMessage)(e)}) \u2014 retrying, login kept.`);
          this.authRetryTimer = this.setTimeout(() => void this.authenticate(auth), AUTH_RETRY_MS);
          return;
        }
      }
    }
    await this.runDeviceFlow(auth);
  }
  /**
   * Read the refresh token out of `auth.session`, handling both our own encrypted
   * format and the previous adapter's cleartext JSON (so a version update keeps the login).
   *
   * @returns the refresh token, or undefined if none is stored
   */
  async loadRefreshToken() {
    const state = await this.getStateAsync("auth.session");
    const raw = typeof (state == null ? void 0 : state.val) === "string" ? state.val : "";
    if (raw.length === 0) {
      return void 0;
    }
    const direct = (0, import_oauth.extractRefreshToken)(raw);
    if (direct) {
      return direct;
    }
    try {
      return (0, import_oauth.extractRefreshToken)(this.decrypt(raw));
    } catch {
      return void 0;
    }
  }
  /**
   * Start the device flow: publish the verification URL, raise a persistent
   * notification the user cannot miss, then poll until the sign-in is approved
   * or the device code expires.
   *
   * @param auth the configured OAuth flow driver
   */
  async runDeviceFlow(auth) {
    var _a;
    const dev = await auth.startDeviceFlow();
    const url = (_a = dev.verificationUriComplete) != null ? _a : dev.verificationUri;
    await this.setState("auth.verificationUrl", { val: url, ack: true });
    this.log.info(`Home Connect sign-in required: open ${dev.verificationUri} and enter code ${dev.userCode}`);
    this.notifyUser(`Home Connect sign-in required: open ${dev.verificationUri} and enter code ${dev.userCode}`);
    this.pollDeviceFlow(auth, dev.deviceCode, dev.intervalMs, dev.expiresAt);
  }
  /**
   * One device-flow poll, rescheduled via a managed timer until it resolves,
   * fails, or the device code expires.
   *
   * @param auth the configured OAuth flow driver
   * @param deviceCode the device code to poll with
   * @param intervalMs the poll interval
   * @param expiresAt absolute epoch-ms after which the device code is dead
   */
  pollDeviceFlow(auth, deviceCode, intervalMs, expiresAt) {
    this.deviceFlowTimer = this.setTimeout(() => {
      void (async () => {
        if (Date.now() >= expiresAt) {
          this.log.warn("Home Connect sign-in timed out \u2014 restart the adapter to try again.");
          return;
        }
        try {
          const token = await auth.pollForToken(deviceCode);
          if (token) {
            await this.setState("auth.verificationUrl", { val: "", ack: true });
            await this.applyToken(token);
            this.log.info("Home Connect: signed in.");
            await this.onAuthenticated();
          } else {
            this.pollDeviceFlow(auth, deviceCode, intervalMs, expiresAt);
          }
        } catch (e) {
          this.log.error(`Home Connect sign-in failed: ${(0, import_pure_helpers.errMessage)(e)}`);
        }
      })();
    }, intervalMs);
  }
  /**
   * Persist a freshly obtained token (encrypted) and mark the service connected.
   *
   * @param token the token to store and use
   */
  async applyToken(token) {
    this.token = token;
    await this.setState("auth.session", { val: this.encrypt(JSON.stringify(token)), ack: true });
    await this.setState("info.connection", { val: true, ack: true });
  }
  /** Arm the periodic check that refreshes the access token before it expires. */
  armRefreshTimer() {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = this.setInterval(() => {
      if (this.token && (0, import_oauth.needsRefresh)(this.token, Date.now())) {
        void this.refreshNow();
      }
    }, REFRESH_CHECK_INTERVAL_MS);
  }
  /**
   * Refresh the access token now, sharing one in-flight attempt across concurrent
   * callers (the periodic timer and any 401 from a REST call). Re-armed after it
   * settles, so a later 401 can trigger a fresh attempt.
   *
   * @returns whether a fresh token was obtained
   */
  async refreshNow() {
    if (!this.auth || !this.token) {
      return false;
    }
    if (!this.refreshing) {
      const auth = this.auth;
      const refreshToken = this.token.refreshToken;
      this.refreshing = (async () => {
        try {
          await this.applyToken(await auth.refresh(refreshToken));
          this.log.debug("Home Connect: access token refreshed.");
          return true;
        } catch (e) {
          this.log.warn(`Home Connect token refresh failed: ${(0, import_pure_helpers.errMessage)(e)}`);
          await this.setState("info.connection", { val: false, ack: true });
          return false;
        } finally {
          this.refreshing = void 0;
        }
      })();
    }
    return this.refreshing;
  }
  /** After the first successful token: arm refresh, prime + build the tree, open the stream. */
  async onAuthenticated() {
    this.resolveUserNotification();
    this.armRefreshTimer();
    if (this.sync) {
      await this.sync.primeFromObjects();
      await this.sync.syncAppliances();
    }
    await this.subscribeStatesAsync("*");
    this.startEventStream();
  }
  /** Open the single persistent event stream (live updates), if not already running. */
  startEventStream() {
    if (this.eventStream) {
      return;
    }
    this.eventStream = new import_event_stream.EventStream({
      baseUrl: DEFAULT_BASE_URL,
      getAccessToken: () => {
        var _a;
        return (_a = this.token) == null ? void 0 : _a.accessToken;
      },
      onEvent: (ev) => {
        var _a;
        return (_a = this.sync) == null ? void 0 : _a.handleStreamEvent(ev);
      },
      onConnected: (connected) => void this.setState("info.connection", { val: connected, ack: true }),
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle)
    });
    this.eventStream.start();
  }
  /**
   * GET a Home Connect resource with the current access token. Retries once after
   * a 401 (token refreshed), honours a 429 Retry-After pause, and dedups failure
   * logging (first per category → warn, repeats → debug, recovery → info).
   *
   * @param path the endpoint path
   * @returns the unwrapped data, or undefined on failure
   */
  async apiGet(path) {
    if (!this.token || this.restPaused(path)) {
      return void 0;
    }
    const source = `GET ${path}`;
    let res = await (0, import_http.getJson)(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    if (res.status === 401 && await this.refreshNow() && this.token) {
      res = await (0, import_http.getJson)(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    }
    if (!res.ok) {
      this.handleRestFailure(source, res);
      return void 0;
    }
    this.restLog.recovered(source);
    return res.data;
  }
  /**
   * Send a resolved write to the Home Connect API (PUT/DELETE), with the same
   * 401-refresh + 429-pause + dedup handling as {@link apiGet}.
   *
   * @param req the resolved request
   * @returns the JSON result, or undefined if not signed in / paused
   */
  async apiWrite(req) {
    if (!this.token || this.restPaused(req.path)) {
      return void 0;
    }
    const source = `${req.method} ${req.path}`;
    let res = await this.sendWrite(req);
    if (res.status === 401 && await this.refreshNow() && this.token) {
      res = await this.sendWrite(req);
    }
    if (res.ok) {
      this.log.debug(`${source} ok`);
      this.restLog.recovered(source);
    } else {
      this.handleRestFailure(source, res);
    }
    return res;
  }
  /**
   * Perform the actual PUT/DELETE for a resolved request.
   *
   * @param req the resolved request
   * @returns the JSON result
   */
  sendWrite(req) {
    const token = this.token.accessToken;
    return req.method === "DELETE" ? (0, import_http.deleteJson)(DEFAULT_BASE_URL, req.path, token) : (0, import_http.putJson)(DEFAULT_BASE_URL, req.path, token, req.body);
  }
  /**
   * Whether REST is currently paused after a 429 (with a one-line debug note).
   *
   * @param path the path being attempted (for the log)
   * @returns whether the call should be skipped right now
   */
  restPaused(path) {
    if (Date.now() < this.restBlockedUntil) {
      this.log.debug(`REST paused (rate-limited) \u2014 skipping ${path}`);
      return true;
    }
    return false;
  }
  /**
   * Log a REST failure (deduped) and, on a 429, arm the Retry-After pause.
   *
   * @param source the call source key ("GET /status")
   * @param res the failed result
   */
  handleRestFailure(source, res) {
    var _a;
    if (res.status === 429 && res.retryAfterMs) {
      this.restBlockedUntil = Date.now() + res.retryAfterMs;
    }
    const level = this.restLog.note(source, (0, import_log_dedup.categorize)(res.status));
    this.log[level](`${source} failed: ${(_a = res.error) != null ? _a : "unknown"}`);
  }
  /**
   * Handle a state change: ignore our own confirmed (ack) updates, else route the
   * user's write to the Home Connect API (ApplianceSync owns the try/catch).
   *
   * @param id the full state id
   * @param state the new state (null on deletion)
   */
  onStateChange(id, state) {
    var _a;
    if (!state || state.ack) {
      return;
    }
    void ((_a = this.sync) == null ? void 0 : _a.handleWrite(id, state.val));
  }
  /**
   * The Accept-Language to request localized names with — the ioBroker system
   * language mapped to a Home Connect locale.
   *
   * @returns a BSH locale like "de-DE", or undefined to let the API default
   */
  acceptLanguage() {
    return this.language ? SYSTEM_TO_BSH_LOCALE[this.language] : void 0;
  }
  /**
   * Raise a persistent user-actionable notification (best effort — a missing
   * notification subsystem must never take the adapter down).
   *
   * @param message the user-facing message
   */
  notifyUser(message) {
    this.registerNotification(NOTIFY_SCOPE, NOTIFY_CATEGORY, message).catch(
      (e) => this.log.debug(`Could not raise notification: ${(0, import_pure_helpers.errMessage)(e)}`)
    );
  }
  /** Clear the sign-in notification once the adapter is authenticated. */
  resolveUserNotification() {
  }
  /**
   * Synchronous teardown — no await, call the callback immediately (SIGKILL otherwise).
   *
   * @param callback function to invoke once teardown is complete
   */
  onUnload(callback) {
    var _a;
    try {
      if (this.refreshTimer) {
        this.clearInterval(this.refreshTimer);
        this.refreshTimer = void 0;
      }
      if (this.deviceFlowTimer) {
        this.clearTimeout(this.deviceFlowTimer);
        this.deviceFlowTimer = void 0;
      }
      if (this.authRetryTimer) {
        this.clearTimeout(this.authRetryTimer);
        this.authRetryTimer = void 0;
      }
      (_a = this.eventStream) == null ? void 0 : _a.stop();
      this.eventStream = void 0;
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Homeconnect(options);
} else {
  (() => new Homeconnect())();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Homeconnect
});
//# sourceMappingURL=main.js.map
