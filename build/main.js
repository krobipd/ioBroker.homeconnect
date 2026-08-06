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
var import_command_dispatch = require("./lib/command-dispatch");
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
  /** speaking device id → haId, for routing writes back to the appliance. */
  haIds = /* @__PURE__ */ new Map();
  /** Namespace-relative state id → its BSH key + candidate values; also gates object creation. */
  knownStates = /* @__PURE__ */ new Map();
  /** device id → the option ids that came from the selected program's definition (writable, sent on start). */
  optionKeys = /* @__PURE__ */ new Map();
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
    if (!haId) {
      return;
    }
    const deviceId = this.deviceIds.get(haId);
    if (event.event === "CONNECTED" || event.event === "PAIRED") {
      if (deviceId) {
        void this.syncApplianceData(deviceId, haId);
      } else {
        void this.syncAppliances();
      }
      return;
    }
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
    this.haIds.set(deviceId, haId);
    await this.extendObject(deviceId, {
      type: "device",
      common: { name },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber }
    });
    if (a.connected === true) {
      await this.syncApplianceData(deviceId, haId);
    }
  }
  /**
   * Sync a connected appliance's full data tree: status, settings, programs and
   * command buttons. Run on start for connected appliances, and again from a
   * CONNECTED / PAIRED stream event for one that was offline before.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async syncApplianceData(deviceId, haId) {
    await this.syncItems(deviceId, haId, "/status", "status");
    await this.syncItems(deviceId, haId, "/settings", "settings");
    await this.syncPrograms(deviceId, haId);
    await this.ensureCommands(deviceId, haId);
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
      constraints: isRecord(raw.constraints) ? {
        min: numberOrUndef(raw.constraints.min),
        max: numberOrUndef(raw.constraints.max),
        allowedvalues: stringArrayOrUndef(raw.constraints.allowedvalues)
      } : void 0
    });
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    if (!this.knownStates.has(fullId)) {
      await this.extendObject(`${deviceId}.${t.channel}`, { type: "channel", common: { name: t.channel }, native: {} });
      await this.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: raw.key, bshValues: t.bshValues }
      });
      this.knownStates.set(fullId, { bshKey: raw.key, bshValues: t.bshValues });
    }
    await this.setStateChangedAsync(fullId, { val: t.value, ack: true });
  }
  /**
   * Read active + selected + available programs into the tree: the selected program
   * becomes a writable dropdown (candidates from /programs/available), the active
   * program a read-only state (explicitly empty when nothing runs), both programs'
   * options land under `options.*`, and start / stop buttons are created.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async syncPrograms(deviceId, haId) {
    const avail = await this.apiGet(`/api/homeappliances/${haId}/programs/available`);
    const availableKeys = isRecord(avail) && Array.isArray(avail.programs) ? avail.programs.filter(isRecord).map((p) => p.key).filter((k) => typeof k === "string") : [];
    const selected = await this.apiGet(`/api/homeappliances/${haId}/programs/selected`);
    const selectedKey = isRecord(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || availableKeys.length > 0) {
      await this.applyBshItem(deviceId, {
        key: "BSH.Common.Root.SelectedProgram",
        value: selectedKey,
        constraints: { allowedvalues: availableKeys }
      });
    }
    if (selectedKey.length > 0) {
      await this.loadProgramOptions(deviceId, haId, selectedKey);
    }
    if (isRecord(selected)) {
      await this.applyProgramOptions(deviceId, selected.options);
    }
    const active = await this.apiGet(`/api/homeappliances/${haId}/programs/active`);
    const activeKey = isRecord(active) && typeof active.key === "string" ? active.key : "";
    await this.applyBshItem(deviceId, { key: "BSH.Common.Root.ActiveProgram", value: activeKey });
    if (isRecord(active)) {
      await this.applyProgramOptions(deviceId, active.options);
    }
    await this.ensureButton(deviceId, "programs", "start", "Start selected program");
    await this.ensureButton(deviceId, "programs", "stop", "Stop active program");
  }
  /**
   * Apply a program's `options[]` array (each a status-like item) under `options.*`.
   *
   * @param deviceId the id-safe device path segment
   * @param options the options array from a program response
   */
  async applyProgramOptions(deviceId, options) {
    if (!Array.isArray(options)) {
      return;
    }
    for (const raw of options) {
      if (isRecord(raw)) {
        await this.applyBshItem(deviceId, raw);
      }
    }
  }
  /**
   * Load a program's option definitions (`/programs/available/{programKey}`) and
   * create them as writable option states. Definitions of a previously selected
   * program that this one no longer has are removed, so a program change leaves no
   * stale (wrong-constraint) options behind.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   * @param programKey the full program key to load definitions for
   */
  async loadProgramOptions(deviceId, haId, programKey) {
    const def = await this.apiGet(`/api/homeappliances/${haId}/programs/available/${programKey}`);
    const options = isRecord(def) && Array.isArray(def.options) ? def.options : [];
    const fresh = /* @__PURE__ */ new Set();
    for (const raw of options) {
      if (isRecord(raw)) {
        const id = await this.applyOptionDefinition(deviceId, raw);
        if (id) {
          fresh.add(id);
        }
      }
    }
    const previous = this.optionKeys.get(deviceId);
    if (previous) {
      for (const id of previous) {
        if (!fresh.has(id)) {
          const relId = `${deviceId}.options.${id}`;
          await this.delObjectAsync(relId);
          this.knownStates.delete(relId);
        }
      }
    }
    this.optionKeys.set(deviceId, fresh);
  }
  /**
   * Create one writable option state from its definition. Always (re-)extends the
   * object so a program change updates its constraints for a key shared with the
   * previous program.
   *
   * @param deviceId the id-safe device path segment
   * @param raw the raw option definition
   * @returns the option's state id, or undefined if it had no key
   */
  async applyOptionDefinition(deviceId, raw) {
    if (typeof raw.key !== "string") {
      return void 0;
    }
    const opt = {
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : void 0,
      type: typeof raw.type === "string" ? raw.type : void 0,
      unit: typeof raw.unit === "string" ? raw.unit : void 0,
      constraints: isRecord(raw.constraints) ? {
        min: numberOrUndef(raw.constraints.min),
        max: numberOrUndef(raw.constraints.max),
        allowedvalues: stringArrayOrUndef(raw.constraints.allowedvalues),
        displayvalues: stringArrayOrUndef(raw.constraints.displayvalues),
        default: raw.constraints.default
      } : void 0
    };
    const t = (0, import_value_transformer.transformOptionDefinition)(opt);
    const fullId = `${deviceId}.options.${t.id}`;
    const isNew = !this.knownStates.has(fullId);
    await this.extendObject(`${deviceId}.options`, { type: "channel", common: { name: "options" }, native: {} });
    await this.extendObject(fullId, {
      type: "state",
      common: t.common,
      native: { bshKey: opt.key, bshValues: t.bshValues }
    });
    this.knownStates.set(fullId, { bshKey: opt.key, bshValues: t.bshValues });
    if (isNew) {
      await this.setStateChangedAsync(fullId, { val: t.value, ack: true });
    }
    return t.id;
  }
  /**
   * Create the available commands as momentary buttons under `commands.*`.
   *
   * @param deviceId the id-safe device path segment
   * @param haId the appliance's haId
   */
  async ensureCommands(deviceId, haId) {
    const data = await this.apiGet(`/api/homeappliances/${haId}/commands`);
    const commands = isRecord(data) && Array.isArray(data.commands) ? data.commands : [];
    for (const raw of commands) {
      if (isRecord(raw) && typeof raw.key === "string") {
        const id = (0, import_value_transformer.stateIdForKey)(raw.key).id;
        const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id;
        await this.ensureButton(deviceId, "commands", id, name, raw.key);
      }
    }
  }
  /**
   * Create a momentary button state (boolean, role "button", write-only) once.
   *
   * @param deviceId the id-safe device path segment
   * @param channel the channel the button lives under (programs / commands)
   * @param id the button's state id
   * @param name the human-readable name
   * @param bshKey the BSH command key, for command buttons (omitted for start/stop)
   */
  async ensureButton(deviceId, channel, id, name, bshKey) {
    const fullId = `${deviceId}.${channel}.${id}`;
    if (this.knownStates.has(fullId)) {
      return;
    }
    await this.extendObject(`${deviceId}.${channel}`, { type: "channel", common: { name: channel }, native: {} });
    await this.extendObject(fullId, {
      type: "state",
      common: { name, type: "boolean", role: "button", read: false, write: true },
      native: bshKey ? { bshKey } : {}
    });
    this.knownStates.set(fullId, { bshKey });
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
   * Handle a state change: ignore our own confirmed (ack) updates, else route the
   * user's write to the Home Connect API.
   *
   * @param id the full state id
   * @param state the new state (null on deletion)
   */
  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    void this.handleWrite(id, state.val);
  }
  /**
   * Resolve a user write into a Home Connect request and send it.
   *
   * @param id the full (namespace-qualified) state id
   * @param value the written value
   */
  async handleWrite(id, value) {
    const prefix = `${this.namespace}.`;
    const rel = id.startsWith(prefix) ? id.slice(prefix.length) : id;
    const parts = rel.split(".");
    const slug = parts[0];
    const channel = parts[1];
    const stateId = parts.slice(2).join(".");
    if (!slug || !channel || stateId.length === 0) {
      return;
    }
    const haId = this.haIds.get(slug);
    if (!haId) {
      return;
    }
    const meta = this.knownStates.get(rel);
    const ctx = { haId, channel, id: stateId, bshKey: meta == null ? void 0 : meta.bshKey, bshValues: meta == null ? void 0 : meta.bshValues, value };
    if (channel === "programs" && stateId === "start") {
      ctx.selectedProgramKey = await this.resolveSelectedProgramKey(slug);
      ctx.selectedOptions = await this.collectSelectedOptions(slug);
    }
    const req = (0, import_command_dispatch.resolveWrite)(ctx);
    if (req) {
      const res = await this.apiWrite(req);
      await this.postWrite(channel, stateId, slug, haId, req, res);
      if ((res == null ? void 0 : res.ok) && !this.isMomentaryButton(channel, stateId)) {
        await this.setState(rel, { val: value, ack: true });
      }
    } else {
      this.log.debug(`Write to ${rel} ignored (no matching Home Connect command).`);
    }
    if (this.isMomentaryButton(channel, stateId)) {
      await this.setStateChangedAsync(rel, { val: false, ack: true });
    }
  }
  /**
   * Whether a state is a momentary button — a press that carries no lasting value.
   *
   * @param channel the state's channel
   * @param stateId the within-channel id
   * @returns whether it is a command / program-start / program-stop button
   */
  isMomentaryButton(channel, stateId) {
    return channel === "commands" || channel === "programs" && (stateId === "start" || stateId === "stop");
  }
  /**
   * Resolve the full BSH key of the currently selected program (payload of the start button).
   *
   * @param slug the device id segment
   * @returns the full program key, or undefined if none is selected / resolvable
   */
  async resolveSelectedProgramKey(slug) {
    var _a, _b;
    const st = await this.getStateAsync(`${slug}.programs.selectedProgram`);
    const short = typeof (st == null ? void 0 : st.val) === "string" ? st.val : "";
    if (short.length === 0) {
      return void 0;
    }
    return (_b = (_a = this.knownStates.get(`${slug}.programs.selectedProgram`)) == null ? void 0 : _a.bshValues) == null ? void 0 : _b.find((v) => (0, import_value_transformer.shortEnum)(v) === short);
  }
  /**
   * Send a resolved write to the Home Connect API and log the outcome.
   *
   * @param req the resolved request
   */
  async apiWrite(req) {
    var _a;
    if (!this.token) {
      return void 0;
    }
    const res = req.method === "DELETE" ? await (0, import_http.deleteJson)(DEFAULT_BASE_URL, req.path, this.token.accessToken) : await (0, import_http.putJson)(DEFAULT_BASE_URL, req.path, this.token.accessToken, req.body);
    if (res.ok) {
      this.log.debug(`${req.method} ${req.path} ok`);
    } else {
      this.log.warn(`${req.method} ${req.path} failed: ${(_a = res.error) != null ? _a : "unknown"}`);
    }
    return res;
  }
  /**
   * Follow-up after a write was sent: a program change reloads its option
   * definitions; a program start the appliance rejected because of the sent options
   * (409) is retried once with defaults. A non-409 failure (401, …) is a real error
   * and is not retried.
   *
   * @param channel the written state's channel
   * @param stateId the within-channel id
   * @param slug the device id segment
   * @param haId the appliance's haId
   * @param req the request that was sent
   * @param res the result, or undefined if nothing was sent
   */
  async postWrite(channel, stateId, slug, haId, req, res) {
    var _a, _b;
    if (!res) {
      return;
    }
    if (channel === "programs" && stateId === "selectedProgram" && res.ok && ((_a = req.body) == null ? void 0 : _a.key)) {
      await this.loadProgramOptions(slug, haId, req.body.key);
      return;
    }
    if (channel === "programs" && stateId === "start" && res.status === 409 && ((_b = req.body) == null ? void 0 : _b.options)) {
      this.log.info("Program did not start with the selected options \u2014 retrying with defaults.");
      await this.apiWrite({ method: "PUT", path: req.path, body: { key: req.body.key } });
    }
  }
  /**
   * Collect the selected program's option values, resolved back to their BSH values,
   * to send with a program start. Only the definition options are collected — the
   * read-only display options (RemainingProgramTime, ProgramProgress, …) are not in
   * the set, and sending them is exactly what the appliance rejects.
   *
   * @param slug the device id segment
   * @returns the option key/value pairs for the start body
   */
  async collectSelectedOptions(slug) {
    const result = [];
    const ids = this.optionKeys.get(slug);
    if (!ids) {
      return result;
    }
    for (const id of ids) {
      const relId = `${slug}.options.${id}`;
      const meta = this.knownStates.get(relId);
      if (!(meta == null ? void 0 : meta.bshKey)) {
        continue;
      }
      const st = await this.getStateAsync(relId);
      if (!st || st.val === null || st.val === void 0) {
        continue;
      }
      const value = meta.bshValues && meta.bshValues.length > 0 ? meta.bshValues.find((v) => (0, import_value_transformer.shortEnum)(v) === st.val) : st.val;
      if (value !== void 0 && value !== null) {
        result.push({ key: meta.bshKey, value });
      }
    }
    return result;
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
function stringArrayOrUndef(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : void 0;
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
