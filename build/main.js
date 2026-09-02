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
var import_node_path = require("node:path");
var utils = __toESM(require("@iobroker/adapter-core"));
var import_adapter_core = require("@iobroker/adapter-core");
var import_oauth = require("./lib/oauth");
var import_http = require("./lib/http");
var import_appliance_sync = require("./lib/appliance-sync");
var import_auth_controller = require("./lib/auth-controller");
var import_legacy_cleanup = require("./lib/legacy-cleanup");
var import_event_stream = require("./lib/event-stream");
var import_pure_helpers = require("./lib/pure-helpers");
var import_log_dedup = require("./lib/log-dedup");
const DEFAULT_BASE_URL = "https://api.home-connect.com";
const RATE_PAUSE_FALLBACK_MS = 6e4;
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
const EXPECTED_BSH_ANSWERS = /* @__PURE__ */ new Set([
  "SDK.Error.NoProgramActive",
  "SDK.Error.NoProgramSelected",
  "SDK.Error.WrongOperationState"
]);
class Homeconnect extends utils.Adapter {
  // Construction seams for the three collaborators. Production uses the real
  // classes; the orchestration tests swap them for fakes so onReady's wiring, the
  // REST paths and the teardown are testable without a network. Behaviour is
  // unchanged — same constructors, same arguments.
  makeSync = (port) => new import_appliance_sync.ApplianceSync(port);
  makeAuthController = (auth, port) => new import_auth_controller.AuthController(auth, port);
  makeEventStream = (deps) => new import_event_stream.EventStream(deps);
  authCtl;
  eventStream;
  sync;
  /** Epoch-ms until which REST calls are paused after a 429 (honours Retry-After). */
  restBlockedUntil = 0;
  /**
   * Set the moment onUnload runs. The sign-in/sync chain is fire-and-forget; on
   * a stop right after start it would otherwise keep syncing past the teardown
   * and even re-open the event stream — whose timer the host then refuses with
   * "setTimeout called, but adapter is shutting down".
   */
  terminating = false;
  /** warn-once-per-category dedup for REST failures (keyed on call source + status band). */
  restLog = new import_log_dedup.LogDedup();
  /**
   * The two halves of `info.connection`, owned here so the flag has ONE writer:
   * the sign-in (a usable token) and the live event stream. Either half alone
   * used to write the flag — a routine token refresh flipped it green while the
   * stream was down, and the next reconnect attempt flipped it back.
   */
  signedIn = false;
  streamUp = false;
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
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /** Adapter start. Async body with a top-level try/catch (never a call-site .catch). */
  async onReady() {
    try {
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      const clientId = this.config.clientID;
      const clientSecret = this.config.clientSecret;
      if (!clientId || !clientSecret) {
        this.log.warn(
          "No Home Connect client ID / secret configured \u2014 open the adapter settings and enter your developer application credentials."
        );
        return;
      }
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      await this.cleanupLegacyObjects();
      this.sync = this.makeSync(this.makePort());
      const auth = new import_oauth.HomeConnectAuth(
        { clientId, clientSecret, baseUrl: DEFAULT_BASE_URL },
        (path, form) => (0, import_http.postForm)(DEFAULT_BASE_URL, path, form)
      );
      this.authCtl = this.makeAuthController(auth, this.makeAuthPort());
      await this.authCtl.start();
    } catch (e) {
      this.log.error(`onReady failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * Remove the previous adapter generation's object trees (raw haId roots with
   * underscored BSH keys) — an update must clean up after itself, the user does
   * not delete objects by hand. Runs before priming, so legacy states never
   * enter the in-memory maps; self-terminating (nothing left → nothing planned).
   */
  async cleanupLegacyObjects() {
    const objects = await this.getAdapterObjectsAsync();
    const prefix = `${this.namespace}.`;
    const relative = {};
    for (const [id, obj] of Object.entries(objects)) {
      if (id.startsWith(prefix)) {
        relative[id.slice(prefix.length)] = { type: obj == null ? void 0 : obj.type, native: obj == null ? void 0 : obj.native };
      }
    }
    const roots = (0, import_legacy_cleanup.planLegacyCleanup)(relative);
    for (const root of roots) {
      await this.delObjectAsync(root, { recursive: true }).catch(
        (e) => this.log.debug(`legacy cleanup: could not delete ${root}: ${(0, import_pure_helpers.errMessage)(e)}`)
      );
    }
    if (roots.length > 0) {
      this.log.info(
        `Removed ${roots.length} object tree(s) of the previous adapter generation \u2014 the new device tree replaces them; your sign-in is kept.`
      );
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
      getObject: (id) => this.getObjectAsync(id),
      setObjectNotExists: (id, obj) => this.setObjectNotExistsAsync(id, obj),
      delObject: (id) => this.delObjectAsync(id),
      delObjectRecursive: (id) => this.delObjectAsync(id, { recursive: true }),
      getForeignObjects: (pattern, type) => this.getForeignObjectsAsync(pattern, type),
      apiGet: (path) => this.apiGet(path),
      apiWrite: (req) => this.apiWrite(req)
    };
  }
  /** Build the port the AuthController drives the sign-in lifecycle through. */
  makeAuthPort() {
    return {
      log: this.log,
      loadRefreshToken: () => this.loadRefreshToken(),
      saveToken: (token) => this.saveToken(token),
      setVerificationUrl: async (url) => {
        await this.setState("auth.verificationUrl", { val: url, ack: true });
      },
      setConnected: async (connected) => {
        this.signedIn = connected;
        await this.publishConnection();
      },
      notify: (message) => this.notifyUser(message),
      onSignedIn: () => this.onAuthenticated(),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle),
      setIntervalTimer: (cb, ms) => this.setInterval(cb, ms),
      clearIntervalTimer: (handle) => this.clearInterval(handle)
    };
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
   * Persist a freshly obtained token, encrypted.
   *
   * @param token the token to store
   */
  async saveToken(token) {
    await this.setState("auth.session", { val: this.encrypt(JSON.stringify(token)), ack: true });
  }
  /** After a successful sign-in: prime + build the tree, subscribe, open the stream. */
  async onAuthenticated() {
    if (this.sync) {
      await this.sync.migrateDeviceIds();
      await this.sync.migrateRenamedStates();
      await this.sync.primeFromObjects();
      await this.sync.markAllUnreachable();
      await this.sync.syncAppliances();
    }
    await this.subscribeStatesAsync("*");
    this.startEventStream();
  }
  /** Open the single persistent event stream (live updates), if not already running. */
  startEventStream() {
    if (this.eventStream || this.terminating) {
      return;
    }
    this.eventStream = this.makeEventStream({
      baseUrl: DEFAULT_BASE_URL,
      getAccessToken: () => {
        var _a;
        return (_a = this.authCtl) == null ? void 0 : _a.accessToken;
      },
      onEvent: (ev) => {
        var _a;
        return (_a = this.sync) == null ? void 0 : _a.handleStreamEvent(ev);
      },
      onConnected: (connected) => {
        this.streamUp = connected;
        void this.publishConnection();
      },
      onUnauthorized: () => {
        var _a, _b;
        return (_b = (_a = this.authCtl) == null ? void 0 : _a.refreshNow()) != null ? _b : Promise.resolve(false);
      },
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle)
    });
    this.eventStream.start();
  }
  /**
   * Write `info.connection` from its two halves: signed in AND the live stream
   * up. Only then do values actually flow; a valid token with a dead stream is
   * an instance that shows stale data.
   */
  async publishConnection() {
    try {
      await this.setStateChangedAsync("auth.signedIn", { val: this.signedIn, ack: true });
      await this.setStateChangedAsync("info.connection", { val: this.signedIn && this.streamUp, ack: true });
    } catch (e) {
      this.log.debug(`Could not write info.connection: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
  /**
   * Messages from the admin (the settings panel's "Test connection" button).
   * Async body with a top-level try/catch; every command answers, so the panel
   * never waits on a message that fell through.
   *
   * @param obj the incoming message
   */
  async onMessage(obj) {
    try {
      if (obj.command === "checkConnection") {
        const answer = await this.checkConnection();
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
        return;
      }
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, { error: `Unknown command: ${String(obj.command)}` }, obj.callback);
      }
    } catch (e) {
      this.log.error(`onMessage failed: ${(0, import_pure_helpers.errMessage)(e)}`);
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, { error: (0, import_pure_helpers.errMessage)(e) }, obj.callback);
      }
    }
  }
  /**
   * The connection test behind the settings panel's button. Every word of the
   * answer is backed by something actually checked right now: a real request
   * to Home Connect with the current token (refreshed once on a 401), the
   * appliance count from THAT answer, and the live state of the event stream.
   * What cannot be checked is said, not assumed — a rate-limit pause is
   * reported as such instead of spending a call the quota does not have.
   *
   * @returns `{ result }` on success, `{ error }` otherwise (the admin's sendTo contract)
   */
  async checkConnection() {
    var _a, _b, _c, _d, _e;
    if (!this.config.clientID || !this.config.clientSecret) {
      return { error: "No Client ID / Client Secret configured \u2014 enter them above and save first." };
    }
    if (!((_a = this.authCtl) == null ? void 0 : _a.accessToken)) {
      const url = (_b = await this.getStateAsync("auth.verificationUrl")) == null ? void 0 : _b.val;
      return {
        error: typeof url === "string" && url.length > 0 ? "Not signed in yet \u2014 open the sign-in link and confirm the code, then test again." : "Not signed in \u2014 no Home Connect login is stored; the adapter requests a sign-in link at start."
      };
    }
    if (Date.now() < this.restBlockedUntil) {
      const seconds = Math.ceil((this.restBlockedUntil - Date.now()) / 1e3);
      return { error: `Home Connect REST is paused after a rate limit for another ${seconds} s \u2014 try again later.` };
    }
    let res = await (0, import_http.getJson)(DEFAULT_BASE_URL, "/api/homeappliances", this.authCtl.accessToken, this.acceptLanguage());
    if (res.status === 401) {
      const refreshed = await this.authCtl.refreshNow();
      const fresh = this.authCtl.accessToken;
      if (refreshed && fresh) {
        res = await (0, import_http.getJson)(DEFAULT_BASE_URL, "/api/homeappliances", fresh, this.acceptLanguage());
      }
    }
    if (res.status === 401 || res.status === 403) {
      return { error: `Home Connect rejected the login (HTTP ${res.status}) \u2014 a new sign-in is required.` };
    }
    if (res.status === 0) {
      return { error: `Home Connect is not reachable: ${(_c = res.error) != null ? _c : "network error"}` };
    }
    if (!res.ok) {
      return { error: `Home Connect answered HTTP ${res.status}: ${(_d = res.error) != null ? _d : "unknown error"}` };
    }
    const list = (0, import_pure_helpers.isRecord)(res.data) && Array.isArray(res.data.homeappliances) ? res.data.homeappliances : void 0;
    if (!list) {
      return {
        error: "Home Connect answered, but not with an appliance list \u2014 the API shape is not what the adapter expects."
      };
    }
    const online = list.filter((a) => (0, import_pure_helpers.isRecord)(a) && a.connected === true).length;
    const stream = this.streamUp ? "Live updates: connected." : `Live updates: NOT connected${((_e = this.eventStream) == null ? void 0 : _e.lastError) ? ` (${this.eventStream.lastError})` : ""} \u2014 the adapter keeps retrying.`;
    return {
      result: `Signed in \u2014 Home Connect listed ${list.length} appliance(s), ${online} of them connected right now. ${stream}`
    };
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
    var _a, _b, _c;
    const token = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (this.terminating || !token || this.restPaused(path)) {
      return void 0;
    }
    const source = `GET ${path}`;
    let res = await (0, import_http.getJson)(DEFAULT_BASE_URL, path, token, this.acceptLanguage());
    if (res.status === 401 && await ((_b = this.authCtl) == null ? void 0 : _b.refreshNow())) {
      const fresh = (_c = this.authCtl) == null ? void 0 : _c.accessToken;
      if (fresh) {
        res = await (0, import_http.getJson)(DEFAULT_BASE_URL, path, fresh, this.acceptLanguage());
      }
    }
    if (!res.ok) {
      if (res.error !== void 0 && EXPECTED_BSH_ANSWERS.has(res.error)) {
        this.log.debug(`${source}: ${res.error} (a normal appliance answer, not an error)`);
      } else {
        this.handleRestFailure(source, res);
      }
      return void 0;
    }
    if (this.restLog.recovered(source)) {
      this.log.info(`${source} succeeded again.`);
    }
    return res.data;
  }
  /**
   * Send a resolved write to the Home Connect API (PUT/DELETE), with the same
   * 401-refresh + 429-pause + dedup handling as {@link apiGet}. Unlike the
   * routine sync reads, a write dropped during a rate-limit pause is a lost
   * user action — it gets a visible (deduped) log line.
   *
   * @param req the resolved request
   * @returns the JSON result, or undefined if not signed in / paused
   */
  async apiWrite(req) {
    var _a, _b, _c;
    const token = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (this.terminating || !token) {
      return void 0;
    }
    const source = `${req.method} ${req.path}`;
    if (Date.now() < this.restBlockedUntil) {
      const seconds = Math.ceil((this.restBlockedUntil - Date.now()) / 1e3);
      const level = this.restLog.note(source, "rate");
      this.log[level](`${source} dropped \u2014 Home Connect REST is paused (rate limit) for another ${seconds} s.`);
      return void 0;
    }
    let res = await this.sendWrite(req, token);
    if (res.status === 401 && await ((_b = this.authCtl) == null ? void 0 : _b.refreshNow())) {
      const fresh = (_c = this.authCtl) == null ? void 0 : _c.accessToken;
      if (fresh) {
        res = await this.sendWrite(req, fresh);
      }
    }
    if (res.ok) {
      this.log.debug(`${source} ok`);
      if (this.restLog.recovered(source)) {
        this.log.info(`${source} succeeded again.`);
      }
    } else {
      this.handleRestFailure(source, res);
    }
    return res;
  }
  /**
   * Perform the actual PUT/DELETE for a resolved request.
   *
   * @param req the resolved request
   * @param token the access token to send with
   * @returns the JSON result
   */
  sendWrite(req, token) {
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
   * Log a REST failure (deduped) and, on a 429, arm the Retry-After pause —
   * falling back to a fixed pause when the header is missing, so a 429 always
   * pauses.
   *
   * @param source the call source key ("GET /status")
   * @param res the failed result
   */
  handleRestFailure(source, res) {
    var _a, _b;
    if (res.status === 429) {
      this.restBlockedUntil = Date.now() + ((_a = res.retryAfterMs) != null ? _a : RATE_PAUSE_FALLBACK_MS);
    }
    const level = this.restLog.note(source, (0, import_log_dedup.categorize)(res.status));
    this.log[level](`${source} failed: ${(_b = res.error) != null ? _b : "unknown"}`);
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
   * notification subsystem must never take the adapter down). js-controller has
   * no adapter API to clear a raised notification; a completed sign-in simply
   * stops re-raising it.
   *
   * @param message the user-facing message
   */
  notifyUser(message) {
    this.registerNotification(NOTIFY_SCOPE, NOTIFY_CATEGORY, message).catch(
      (e) => this.log.debug(`Could not raise notification: ${(0, import_pure_helpers.errMessage)(e)}`)
    );
  }
  /**
   * Teardown: stop the collaborators synchronously, then report done only once
   * the final marker writes have landed (the host grants the full stopTimeout;
   * a callback fired before the writes would lose them).
   *
   * @param callback function to invoke once teardown is complete
   */
  onUnload(callback) {
    var _a, _b;
    try {
      this.terminating = true;
      this.signedIn = false;
      this.streamUp = false;
      (_a = this.authCtl) == null ? void 0 : _a.stop();
      this.authCtl = void 0;
      (_b = this.eventStream) == null ? void 0 : _b.stop();
      this.eventStream = void 0;
      const writes = [this.setState("info.connection", { val: false, ack: true })];
      if (this.sync) {
        writes.push(this.sync.markAllUnreachable());
      }
      void Promise.all(writes).catch((e) => {
        this.log.debug(`Final shutdown write failed: ${(0, import_pure_helpers.errMessage)(e)}`);
      }).finally(() => callback());
      return;
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
