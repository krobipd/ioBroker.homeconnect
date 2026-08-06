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
var import_value_transformer = require("./lib/value-transformer");
var import_pure_helpers = require("./lib/pure-helpers");
var import_event_stream = require("./lib/event-stream");
const DEFAULT_BASE_URL = "https://api.home-connect.com";
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1e3;
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
class Homeconnect extends utils.Adapter {
  auth;
  token;
  refreshTimer;
  deviceFlowTimer;
  eventStream;
  /** haId → speaking device id, for routing stream events. */
  deviceIds = /* @__PURE__ */ new Map();
  /** State ids already created this session, so events only create an object once. */
  knownStates = /* @__PURE__ */ new Set();
  /**
   * @param options adapter options passed through by js-controller
   */
  constructor(options = {}) {
    super({
      ...options,
      name: "homeconnect"
    });
    this.on("ready", this.onReady.bind(this));
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
      this.auth = new import_oauth.HomeConnectAuth(
        { clientId, clientSecret, baseUrl: DEFAULT_BASE_URL },
        (path, form) => (0, import_http.postForm)(DEFAULT_BASE_URL, path, form)
      );
      await this.authenticate(this.auth);
    } catch (e) {
      this.log.error(`onReady failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /**
   * Obtain a valid access token: reuse the refresh token already in `auth.session`
   * (from this or the previous adapter version) if there is one, otherwise run the
   * device flow. On success the token is stored encrypted and a refresh timer armed.
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
        this.log.warn(
          `Stored login could not be refreshed (${e instanceof Error ? e.message : String(e)}); a new device-flow sign-in is required.`
        );
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
   * Start the device flow: publish the verification URL for the user, then poll
   * (via a managed timer) until the sign-in is approved or the device code expires.
   *
   * @param auth the configured OAuth flow driver
   */
  async runDeviceFlow(auth) {
    var _a;
    const dev = await auth.startDeviceFlow();
    await this.setState("auth.verificationUrl", {
      val: (_a = dev.verificationUriComplete) != null ? _a : dev.verificationUri,
      ack: true
    });
    this.log.info(`Home Connect sign-in required: open ${dev.verificationUri} and enter code ${dev.userCode}`);
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
          this.log.error(`Home Connect sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
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
      void (async () => {
        if (!this.token || !this.auth || !(0, import_oauth.needsRefresh)(this.token, Date.now())) {
          return;
        }
        try {
          await this.applyToken(await this.auth.refresh(this.token.refreshToken));
          this.log.debug("Home Connect: access token refreshed.");
        } catch (e) {
          this.log.warn(`Home Connect token refresh failed: ${e instanceof Error ? e.message : String(e)}`);
          await this.setState("info.connection", { val: false, ack: true });
        }
      })();
    }, REFRESH_CHECK_INTERVAL_MS);
  }
  /** After the first successful token: arm the refresh timer, build the device tree, open the event stream. */
  async onAuthenticated() {
    this.armRefreshTimer();
    await this.syncAppliances();
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
      onEvent: (ev) => this.handleStreamEvent(ev),
      onConnected: (connected) => void this.setState("info.connection", { val: connected, ack: true }),
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle)
    });
    this.eventStream.start();
  }
  /**
   * Route a stream event to its device's states: parse the JSON payload and
   * apply each item under the speaking tree.
   *
   * @param event the parsed SSE event
   */
  handleStreamEvent(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isRecord(payload)) {
      return;
    }
    const haId = event.id || (typeof payload.haId === "string" ? payload.haId : void 0);
    const deviceId = haId ? this.deviceIds.get(haId) : void 0;
    if (!deviceId) {
      return;
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const raw of items) {
      if (isRecord(raw)) {
        void this.applyBshItem(deviceId, raw);
      }
    }
  }
  /** Fetch the paired appliances and build/update their object tree. */
  async syncAppliances() {
    const data = await this.apiGet("/api/homeappliances");
    const list = isRecord(data) && Array.isArray(data.homeappliances) ? data.homeappliances : [];
    for (const raw of list) {
      if (isRecord(raw)) {
        await this.syncAppliance(raw);
      }
    }
    this.log.info(`Home Connect: ${list.length} appliance(s) found.`);
  }
  /**
   * Build the object tree for one appliance under a speaking id and sync its
   * status + settings (only when the appliance is currently connected).
   *
   * @param a the appliance record from /api/homeappliances
   */
  async syncAppliance(a) {
    const haId = typeof a.haId === "string" ? a.haId : void 0;
    if (!haId) {
      return;
    }
    const name = typeof a.name === "string" && a.name.length > 0 ? a.name : haId;
    const deviceId = (0, import_pure_helpers.slugify)(name);
    this.deviceIds.set(haId, deviceId);
    await this.extendObject(deviceId, {
      type: "device",
      common: { name },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber }
    });
    if (a.connected === true) {
      await this.syncItems(deviceId, haId, "/status", "status");
      await this.syncItems(deviceId, haId, "/settings", "settings");
    }
  }
  /**
   * Fetch a status/settings list, transform each item, and create the object +
   * set the value under the speaking channel/id.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param subpath the endpoint sub-path, e.g. "/status"
   * @param arrayKey the array field in the response body, e.g. "status"
   */
  async syncItems(deviceId, haId, subpath, arrayKey) {
    const data = await this.apiGet(`/api/homeappliances/${haId}${subpath}`);
    const items = isRecord(data) && Array.isArray(data[arrayKey]) ? data[arrayKey] : [];
    for (const raw of items) {
      if (isRecord(raw)) {
        await this.applyBshItem(deviceId, raw);
      }
    }
  }
  /**
   * Transform one raw BSH item and write it under the device's speaking tree,
   * creating the channel + state object only once (then only updating the value —
   * events would otherwise rewrite objects on every tick, the old adapter's #387).
   *
   * @param deviceId the id-safe device path segment
   * @param raw the raw status / setting / event item
   */
  async applyBshItem(deviceId, raw) {
    if (typeof raw.key !== "string") {
      return;
    }
    const t = (0, import_value_transformer.transformItem)({
      key: raw.key,
      value: raw.value,
      unit: typeof raw.unit === "string" ? raw.unit : void 0,
      constraints: isRecord(raw.constraints) ? { min: numberOrUndef(raw.constraints.min), max: numberOrUndef(raw.constraints.max) } : void 0
    });
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    if (!this.knownStates.has(fullId)) {
      await this.extendObject(`${deviceId}.${t.channel}`, { type: "channel", common: { name: t.channel }, native: {} });
      await this.extendObject(fullId, { type: "state", common: t.common, native: { bshKey: raw.key } });
      this.knownStates.add(fullId);
    }
    await this.setStateChangedAsync(fullId, { val: t.value, ack: true });
  }
  /**
   * GET a Home Connect resource with the current access token; returns the
   * unwrapped `data`, or undefined (with a debug log) on any failure.
   *
   * @param path the endpoint path
   * @returns the unwrapped data, or undefined
   */
  async apiGet(path) {
    var _a;
    if (!this.token) {
      return void 0;
    }
    const res = await (0, import_http.getJson)(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    if (!res.ok) {
      this.log.debug(`GET ${path} failed: ${(_a = res.error) != null ? _a : "unknown"}`);
      return void 0;
    }
    return res.data;
  }
  /**
   * The Accept-Language to request localized names with — a configured override,
   * else the ioBroker system language mapped to a Home Connect locale.
   *
   * @returns a BSH locale like "de-DE", or undefined to let the API default
   */
  acceptLanguage() {
    if (this.config.language) {
      return this.config.language;
    }
    return this.language ? SYSTEM_TO_BSH_LOCALE[this.language] : void 0;
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
      (_a = this.eventStream) == null ? void 0 : _a.stop();
      this.eventStream = void 0;
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch {
      callback();
    }
  }
}
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function numberOrUndef(v) {
  return typeof v === "number" ? v : void 0;
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
