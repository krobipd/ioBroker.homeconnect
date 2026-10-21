"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var import_node_path = require("node:path");
var utils = __toESM(require("@iobroker/adapter-core"));
var import_adapter_core = require("@iobroker/adapter-core");
var import_oauth = require("./lib/oauth");
var import_http = require("./lib/http");
var import_appliance_sync = require("./lib/appliance-sync");
var import_auth_controller = require("./lib/auth-controller");
var import_enum_carry = require("./lib/enum-carry");
var import_event_stream = require("./lib/event-stream");
var import_err_text = require("./lib/err-text");
var import_pure_helpers = require("./lib/pure-helpers");
var import_sign_in_help = require("./lib/sign-in-help");
var import_native_key_migration = require("./lib/native-key-migration");
var import_settings_migrations = require("./lib/settings-migrations");
var import_log_dedup = require("./lib/log-dedup");
var import_log_once = require("./lib/log-once");
var import_api_limits = require("./lib/api-limits");
var import_request_budget = require("./lib/request-budget");
var import_object_mirror = require("./lib/object-mirror");
var import_i18n = require("./lib/i18n");
var import_log_ring = require("./lib/diagnostics/log-ring");
var import_report_jobs = require("./lib/diagnostics/report-jobs");
var import_report_source = require("./lib/diagnostics/report-source");
var import_traffic_recorder = require("./lib/diagnostics/traffic-recorder");
const DEFAULT_BASE_URL = "https://api.home-connect.com";
const RATE_PAUSE_FALLBACK_MS = 6e4;
function requestGapMs() {
  return (0, import_api_limits.minimumGapMs)();
}
function requestsPerMinute() {
  return (0, import_api_limits.declaredLimit)(60);
}
const ERROR_STREAK_LIMIT = 8;
const STREAM_OUTAGE_RESYNC_MS = 6e4;
const RECONNECT_SYNC_COOLDOWN_MS = 60 * 6e4;
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
const NO_PROGRAM_ANSWERS = /* @__PURE__ */ new Set(["SDK.Error.NoProgramActive", "SDK.Error.NoProgramSelected"]);
const BUSY_ANSWERS = /* @__PURE__ */ new Set(["SDK.Error.WrongOperationState", "SDK.Error.ProgramNotAvailable"]);
const UNSUPPORTED_ANSWERS = /* @__PURE__ */ new Set(["SDK.Error.UnsupportedProgram"]);
const NOT_READY_ANSWERS = /* @__PURE__ */ new Set(["SDK.Error.HomeAppliance.Connection.Initialization.Failed"]);
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
   * The ioBroker system language (`system.config.language`), read once in onReady.
   * `this.language` stays empty for an adapter that does not declare
   * `useFormatDate` (js-controller 7.2.2) — reading it left every value label
   * English and never sent an Accept-Language to the cloud.
   */
  systemLanguage;
  /**
   * The own objects as the database holds them, read once in onReady: a write that
   * would change nothing is left out (tooling round 61 — `extendObject` always
   * writes and notifies every subscriber).
   */
  objectMirror = new import_object_mirror.ObjectMirror("");
  /** The objects without an object type the database held at the start (decision 48). */
  untypedAtStart = [];
  /**
   * The own states' last values, read once in onReady: a read-only state is compared
   * here instead of in the database (tooling round 62 — `setStateChangedAsync` reads
   * the state on every call).
   */
  stateMirror = new import_object_mirror.StateMirror();
  /** The start has read its own objects and states: from here on a marker write compares in memory. */
  ownStatesRead = false;
  /** Send times of the requests within the last minute (see {@link requestsPerMinute}). */
  sentAt = [];
  /** Where the send times of the last minute outlive a restart (request-budget.ts); empty until onReady knows it. */
  budgetFile = "";
  /** Epoch-ms of the last request sent (see {@link requestGapMs}). */
  lastSentAt = 0;
  /** Requests waiting for their place; a user's write stands before every waiting read. */
  slotQueue = [];
  /** Whether {@link pumpSlots} is handing out places right now. */
  pumping = false;
  /** Whether this run already said that the request budget spreads the reads out. */
  budgetNoted = false;
  /** Successive requests that ended in an error (see {@link ERROR_STREAK_LIMIT}). */
  errorStreak = 0;
  /**
   * Set the moment onUnload runs. The sign-in/sync chain is fire-and-forget; on
   * a stop right after start it would otherwise keep syncing past the teardown
   * and even re-open the event stream — whose timer the host then refuses with
   * "setTimeout called, but adapter is shutting down".
   */
  terminating = false;
  /** warn-once-per-category dedup for REST failures (keyed on the endpoint kind of the call, category from the status band). */
  /** REST failures: said once per endpoint kind and category, repeats on debug, the return once on info (fleet master). */
  restLog = new import_log_once.LogOnce({
    debug: (message) => this.log.debug(message),
    info: (message) => this.log.info(message),
    warn: (message) => this.log.warn(message),
    error: (message) => this.log.error(message)
  });
  /**
   * The two halves of `info.connection`, owned here so the flag has ONE writer:
   * the sign-in (a usable token) and the live event stream. Either half alone
   * used to write the flag — a routine token refresh flipped it green while the
   * stream was down, and the next reconnect attempt flipped it back.
   */
  signedIn = false;
  streamUp = false;
  /** Epoch-ms the event stream went down, while it is down (undefined = up / never dropped). */
  streamDownSince;
  /** Whether the stream was up at least once this run — the first connect needs no re-read. */
  streamEverUp = false;
  /** Epoch-ms of the last outage re-read, for the cooldown. */
  lastReconnectSync = 0;
  /** The deferred outage re-read, while one is waiting out the cooldown. */
  resyncTimer;
  /** When this run started — the diagnostics report says it. */
  startedAt = Date.now();
  /** The adapter's last log lines at every level — what a diagnostics report shows of the past. */
  logRing = new import_log_ring.LogRing();
  /** Every answer Home Connect gave, per appliance and for the account, for the diagnostics report (memory only). */
  recorder = new import_traffic_recorder.TrafficRecorder();
  /** Answers the admin's diagnostics card (list the appliances, read one and hand back its report). */
  diagnostics = new import_report_jobs.ReportJobs(new import_report_source.HomeConnectReportSource(this.reportHost()));
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
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      this.logRing.hook(this.log);
      this.on("message", this.onMessage.bind(this));
      if (await (0, import_native_key_migration.migrateNativeKeys)(this, import_settings_migrations.SETTINGS_MIGRATIONS, import_err_text.errText)) {
        return;
      }
      await this.readOwnObjects();
      await this.readOwnStates();
      this.ownStatesRead = true;
      this.takeOverRequestBudget();
      await this.setStateIfChanged("info.connection", { val: false, ack: true });
      await this.setStateIfChanged("auth.signedIn", { val: false, ack: true });
      await this.setStateIfChanged("auth.lastError", { val: "Unknown", ack: true });
      await this.refreshManifestObjects();
      this.systemLanguage = await this.readSystemLanguage();
      const sync = this.makeSync(this.makePort());
      this.sync = sync;
      const steps = [
        ["legacy cleanup", () => sync.sortOutLegacyTrees()],
        ["device id migration", () => sync.migrateDeviceIds()],
        ["datapoint migration", () => sync.migrateRenamedStates()],
        ["history migration", () => sync.migrateHistoryRuns()],
        ["leftover cleanup", () => this.dropUntypedObjects()],
        ["priming", () => sync.primeFromObjects()],
        ["reachable stamp", () => sync.markAllUnreachable()]
      ];
      for (const [name, step] of steps) {
        if (this.terminating) {
          this.log.debug(`start-up stopped before the ${name} \u2014 the adapter is shutting down.`);
          return;
        }
        try {
          await step();
        } catch (e) {
          if (this.terminating) {
            this.log.debug(`start-up chain stopped at the ${name}: ${(0, import_err_text.errText)(e)}`);
          } else {
            this.log.error(`Start-up failed at the ${name}: ${(0, import_err_text.errText)(e)}`);
          }
          return;
        }
      }
      const clientId = typeof this.config.clientID === "string" ? this.config.clientID.trim() : "";
      const clientSecret = typeof this.config.clientSecret === "string" ? this.config.clientSecret.trim() : "";
      if (!clientId) {
        this.log.warn(
          "No Home Connect Client ID configured \u2014 open the adapter settings and enter the Client ID of your developer application."
        );
        return;
      }
      if (!(0, import_sign_in_help.looksLikeClientId)(clientId)) {
        this.log.warn(
          `The Client ID does not look like one of Home Connect (64 hexadecimal characters, this one has ${clientId.length} characters) \u2014 copy it again from the developer portal.`
        );
      }
      const auth = new import_oauth.HomeConnectAuth(
        { clientId, clientSecret, baseUrl: DEFAULT_BASE_URL },
        (path, form) => this.sendForm(path, form)
      );
      this.authCtl = this.makeAuthController(auth, this.makeAuthPort());
      await this.authCtl.start();
    } catch (e) {
      this.log.error(`onReady failed: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Give the instance's own objects (the manifest's `instanceObjects`) their
   * current name and explanation on EVERY start.
   *
   * js-controller does apply the manifest at each start, but with
   * `preserve: { common: ["name"] }` — so a renamed datapoint reaches new
   * installations only, while an existing tree keeps whatever the version that
   * first created it wrote. Neither the manifest, nor a test, nor a gate shows
   * that; only the real tree of an updated installation does. The adapter owns
   * its datapoints, so it writes them itself.
   *
   * The ids stand at the call, spelled out, instead of in a loop over a table:
   * that is what makes the connection to the manifest greppable — and it is what
   * the fleet's consistency gate reads to prove every manifest object is
   * actually reached.
   *
   * Texts come from `admin/i18n`, the same source the manifest is generated
   * from, so the two can never drift apart. The two channels have nothing to
   * explain and get no description.
   */
  async refreshManifestObjects() {
    const t = (key) => import_adapter_core.I18n.getTranslatedObject(key);
    const text = (name, desc) => ({
      common: desc === void 0 ? { name: t(name) } : { name: t(name), desc: t(desc) }
    });
    const own = this.objectMirror;
    try {
      let patch = text("authChannel");
      if (!own.covers("auth", patch)) {
        await this.extendObject("auth", patch);
        own.wrote("auth", patch);
      }
      patch = text("session", "sessionDesc");
      if (!own.covers("auth.session", patch)) {
        await this.extendObject("auth.session", patch);
        own.wrote("auth.session", patch);
      }
      patch = text("verificationUrl", "verificationUrlDesc");
      if (!own.covers("auth.verificationUrl", patch)) {
        await this.extendObject("auth.verificationUrl", patch);
        own.wrote("auth.verificationUrl", patch);
      }
      patch = text("signedIn", "signedInDesc");
      if (!own.covers("auth.signedIn", patch)) {
        await this.extendObject("auth.signedIn", patch);
        own.wrote("auth.signedIn", patch);
      }
      patch = text("lastError", "lastErrorDesc");
      if (!own.covers("auth.lastError", patch)) {
        await this.extendObject("auth.lastError", patch);
        own.wrote("auth.lastError", patch);
      }
      patch = text("channelInfo");
      if (!own.covers("info", patch)) {
        await this.extendObject("info", patch);
        own.wrote("info", patch);
      }
      patch = text("connection", "connectionDesc");
      if (!own.covers("info.connection", patch)) {
        await this.extendObject("info.connection", patch);
        own.wrote("info.connection", patch);
      }
      patch = text("devicesTotal", "devicesTotalDesc");
      if (!own.covers("info.devicesTotal", patch)) {
        await this.extendObject("info.devicesTotal", patch);
        own.wrote("info.devicesTotal", patch);
      }
      patch = text("devicesOnline", "devicesOnlineDesc");
      if (!own.covers("info.devicesOnline", patch)) {
        await this.extendObject("info.devicesOnline", patch);
        own.wrote("info.devicesOnline", patch);
      }
      patch = text("devicesAllOnline", "devicesAllOnlineDesc");
      if (!own.covers("info.devicesAllOnline", patch)) {
        await this.extendObject("info.devicesAllOnline", patch);
        own.wrote("info.devicesAllOnline", patch);
      }
    } catch (e) {
      this.log.debug(`Could not refresh the manifest object names: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Read the own tree once — one list call, not a read per object — so every later
   * write can be compared first. Unread (an error), every write goes out as before.
   */
  async readOwnObjects() {
    this.objectMirror = new import_object_mirror.ObjectMirror(this.namespace);
    try {
      const list = await this.getObjectListAsync({
        startkey: `${this.namespace}.`,
        endkey: `${this.namespace}.\u9999`
      });
      this.objectMirror.load(list.rows);
      this.untypedAtStart = this.objectMirror.untyped();
    } catch (e) {
      this.log.debug(`Could not read the own objects \u2014 every object write goes out: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Delete the objects without an object type in the own namespace (decision 48). The adapter never writes
   * one; they are leftovers another writer created by extending an id that did not exist — e.g. under the
   * device id an appliance had before 1.24.0. The object is only deleted, nothing on it is read.
   */
  async dropUntypedObjects() {
    let dropped = 0;
    for (const id of this.untypedAtStart) {
      await this.delObjectAsync(id);
      this.objectMirror.forget(id);
      dropped++;
    }
    if (dropped > 0) {
      this.log.info(`Removed ${dropped} leftover object(s) without an object type.`);
    }
  }
  /** Read the own states once — one bulk call — so a read-only state is never read back to compare it. */
  async readOwnStates() {
    var _a;
    try {
      this.stateMirror.load((_a = await this.getStatesAsync("*")) != null ? _a : {});
    } catch (e) {
      this.log.debug(`Could not read the own states \u2014 every read-only state write goes out: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * One sign-in request (device code, token poll, refresh): it goes to the same host Home Connect counts per minute,
   * so it takes a place in the request budget — ahead of waiting reads, like a user's write.
   *
   * @param path the OAuth endpoint path
   * @param form the form fields
   * @returns the answer, or a transport failure when the adapter shut down while it waited
   */
  async sendForm(path, form) {
    var _a;
    const paused = this.restBlockedUntil - Date.now();
    if (paused > 0 && !this.terminating) {
      try {
        await this.delay(paused);
      } catch {
      }
    }
    if (this.terminating || !await this.spaceRequests(true)) {
      return {
        status: 0,
        ok: false,
        body: { error: "network_error", error_description: "the adapter is shutting down" }
      };
    }
    const res = await this.sent((0, import_http.postForm)(DEFAULT_BASE_URL, path, form));
    const code = (0, import_pure_helpers.isRecord)(res.body) && typeof res.body.error === "string" ? res.body.error : void 0;
    this.recorder.token(path, res.status, code);
    if (res.status === 429) {
      this.armRatePause((_a = res.retryAfterMs) != null ? _a : RATE_PAUSE_FALLBACK_MS);
    }
    return res;
  }
  /**
   * Take over the send times of the last minute a previous process of this instance left in its data folder.
   */
  takeOverRequestBudget() {
    var _a;
    try {
      this.budgetFile = (0, import_node_path.join)(utils.getAbsoluteInstanceDataDir(this), "request-times.json");
      this.sentAt = (0, import_request_budget.readSentTimes)(this.budgetFile, Date.now());
      this.lastSentAt = (_a = this.sentAt.at(-1)) != null ? _a : 0;
    } catch (e) {
      this.log.debug(`Could not read the request budget of the previous run: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /** Leave the send times of the last minute for the next process of this instance. */
  handOverRequestBudget() {
    try {
      (0, import_request_budget.writeSentTimes)(this.budgetFile, this.sentAt, Date.now());
    } catch (e) {
      this.log.debug(`Could not keep the request budget for the next run: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Read one of the own states: a read-only one from what the start-up read and the adapter's own writes hold (the
   * adapter is its only writer — one bulk read at the start, never one by one), a writable one from the database,
   * where a user's write may stand.
   *
   * @param id the namespace-relative or full own id
   * @returns the state, or null when there is none
   */
  async readState(id) {
    if (this.objectMirror.readOnly(id)) {
      const held = this.stateMirror.held(this.objectMirror.fullId(id));
      if (held !== void 0) {
        return held;
      }
    }
    return this.getStateAsync(id);
  }
  /**
   * Write a state only when its value changes. A read-only state is written by the
   * adapter alone and compared in memory; a writable one goes through
   * `setStateChangedAsync`, whose database compare also sees a user's write.
   *
   * @param id the namespace-relative or full own id
   * @param state the state to write
   * @returns what the write returned, or undefined when nothing was written
   */
  async setStateIfChanged(id, state) {
    const full = this.objectMirror.fullId(id);
    if (!this.objectMirror.readOnly(id)) {
      const result2 = await this.setStateChangedAsync(id, state);
      this.stateMirror.remember(full, state);
      return result2;
    }
    if (!this.stateMirror.differs(full, state)) {
      return void 0;
    }
    const result = await this.setState(id, state);
    this.stateMirror.remember(full, state);
    return result;
  }
  /**
   * Write a state every time (a token, a link, a measured value) and hold what was written.
   *
   * @param id the namespace-relative or full own id
   * @param state the state to write
   * @returns what the write returned
   */
  async setStateRemembered(id, state) {
    const result = await this.setState(id, state);
    this.stateMirror.remember(this.objectMirror.fullId(id), state);
    return result;
  }
  /**
   * `extendObject` for ApplianceSync: left out when it would change nothing.
   *
   * @param id the namespace-relative id
   * @param patch what to merge into the object
   * @returns what extendObject returned, or undefined when nothing was written
   */
  async extendChangedObject(id, patch) {
    if (this.objectMirror.covers(id, patch)) {
      return void 0;
    }
    const result = await this.extendObject(id, patch);
    this.objectMirror.wrote(id, patch);
    return result;
  }
  /** Build the port ApplianceSync talks to the adapter through. */
  makePort() {
    return {
      namespace: this.namespace,
      log: this.log,
      language: this.systemLanguage,
      extendObject: (id, obj) => this.extendChangedObject(id, obj),
      setState: (id, state) => this.setStateRemembered(id, state),
      setStateChanged: (id, state) => this.setStateIfChanged(id, state),
      getState: (id) => this.readState(id),
      getObject: (id) => this.getObjectAsync(id),
      delObject: async (id) => {
        await this.delObjectAsync(id);
        this.objectMirror.forget(id);
        this.stateMirror.forget(this.objectMirror.fullId(id), false);
      },
      delState: async (id) => {
        await this.delStateAsync(id);
        this.stateMirror.forget(this.objectMirror.fullId(id), false);
      },
      delObjectRecursive: async (id) => {
        await this.delObjectAsync(id, { recursive: true });
        this.objectMirror.forgetTree(id);
        this.stateMirror.forget(this.objectMirror.fullId(id), true);
      },
      getForeignObjects: (pattern, type) => this.getForeignObjectsAsync(pattern, type),
      getAdapterObjects: () => this.getAdapterObjectsAsync(),
      getForeignStates: (pattern) => this.getForeignStatesAsync(pattern),
      setForeignObject: async (id, obj) => {
        const result = await this.setForeignObject(id, obj);
        if (id.startsWith(`${this.namespace}.`)) {
          this.objectMirror.replaced(id, obj);
        }
        return result;
      },
      extendForeignObject: async (id, patch) => {
        const own = id.startsWith(`${this.namespace}.`);
        if (own && this.objectMirror.covers(id, patch)) {
          return void 0;
        }
        const result = await this.extendForeignObjectAsync(id, patch);
        if (own) {
          this.objectMirror.wrote(id, patch);
        }
        return result;
      },
      setForeignState: async (id, state) => {
        const result = await this.setForeignStateAsync(id, state);
        this.stateMirror.remember(id, state);
        return result;
      },
      getAliases: () => this.getForeignObjectsAsync("alias.*", "state"),
      getEnums: async () => {
        var _a;
        return (_a = await this.getForeignObjectsAsync("enum.*", "enum")) != null ? _a : {};
      },
      deleteTreeCarryingEnums: (root, carry) => this.deleteTreeCarryingEnums(root, carry),
      apiGet: (path) => this.apiGet(path),
      errorBudgetLeft: () => this.errorStreak < ERROR_STREAK_LIMIT,
      apiWrite: (req) => this.apiWrite(req),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle)
    };
  }
  /**
   * Delete a whole tree and carry the room and function assignments of its objects to the ids that
   * take their place — through the fleet helper, in its order: the assignments are read first, the
   * tree is deleted, the new ids are written last. The delete removes the old ids from every enum,
   * written back from the adapter's enum cache, and would take away an id written before it.
   *
   * @param root the namespace-relative root that goes away
   * @param carry old full id → the full ids that take its place
   * @returns how many room/function entries now list one of the new ids
   */
  async deleteTreeCarryingEnums(root, carry) {
    const carried = await (0, import_enum_carry.moveAllWithEnums)(
      this,
      (oldId) => {
        var _a;
        return (_a = carry.get(oldId)) != null ? _a : [];
      },
      () => this.deleteLeavesFirst(root),
      import_err_text.errText
    );
    this.objectMirror.forgetTree(root);
    this.stateMirror.forget(this.objectMirror.fullId(root), true);
    return carried.reduce((n, c) => n + c.newIds.length, 0);
  }
  /**
   * Delete a tree from its deepest objects up, the root last. A recursive delete takes the root first
   * (js-controller 7.2.2 `_delForeignObject` → `_deleteObjects`), and the root of a device move carries its
   * journal (`native.movingTo`): a stop in the middle would leave the moved datapoints behind with nothing that
   * says where they belong. Deleting the root last keeps the journal until the tree below it is gone.
   *
   * @param root the namespace-relative root that goes away
   */
  async deleteLeavesFirst(root) {
    const full = `${this.namespace}.${root}`;
    const list = await this.getObjectListAsync({ startkey: `${full}.`, endkey: `${full}.\u9999` });
    const below = list.rows.map((row) => row.id).filter((id) => id.startsWith(`${full}.`));
    below.sort((a, b) => b.split(".").length - a.split(".").length);
    for (const id of below) {
      await this.delForeignObjectAsync(id);
    }
    if (await this.getObjectAsync(root)) {
      await this.delObjectAsync(root);
    }
  }
  /** Build the port the AuthController drives the sign-in lifecycle through. */
  makeAuthPort() {
    return {
      log: this.log,
      loadRefreshToken: () => this.loadRefreshToken(),
      saveToken: (token) => this.saveToken(token),
      setVerificationUrl: async (url) => {
        await this.setStateRemembered("auth.verificationUrl", { val: url, ack: true });
      },
      setConnected: async (connected) => {
        this.signedIn = connected;
        await this.publishConnection();
      },
      setProblem: async (text) => {
        await this.setStateIfChanged("auth.lastError", { val: text, ack: true });
      },
      clearStoredLogin: async () => {
        await this.setStateRemembered("auth.session", { val: "", ack: true });
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
    const state = await this.readState("auth.session");
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
      this.log.warn(
        "The stored Home Connect login cannot be read on this system (it was saved by another ioBroker installation) \u2014 a new sign-in is required."
      );
      return void 0;
    }
  }
  /**
   * Persist a freshly obtained token, encrypted.
   *
   * @param token the token to store
   */
  async saveToken(token) {
    await this.setStateRemembered("auth.session", { val: this.encrypt(JSON.stringify(token)), ack: true });
  }
  /**
   * After a successful sign-in (the first one, and every re-sign-in at runtime):
   * read the appliances, subscribe, open the stream. The local steps (migrations,
   * priming, the unreachable stamp) ran once in onReady.
   *
   * Every step is gated on `terminating`. The chain is fire-and-forget, each of
   * its steps takes a while, and a stop right after start would otherwise let
   * the sync keep WRITING OBJECTS after onUnload already reported done — the
   * class of defect observed live on v1.12.0 (host warning "setTimeout called,
   * but adapter is shutting down", online markers written after the teardown).
   */
  async onAuthenticated() {
    const sync = this.sync;
    let current = "appliance sync";
    try {
      if (this.terminating) {
        return;
      }
      if (sync) {
        try {
          await sync.syncAppliances();
        } catch (e) {
          if (this.terminating) {
            this.log.debug(`start-up chain stopped at the ${current}: ${(0, import_err_text.errText)(e)}`);
            return;
          }
          this.log.error(`Setting up the appliances failed: ${(0, import_err_text.errText)(e)} \u2014 live updates start anyway.`);
        }
        if (this.terminating) {
          return;
        }
      }
      current = "state subscription";
      await this.subscribeStatesAsync("*");
      this.startEventStream();
    } catch (e) {
      if (this.terminating) {
        this.log.debug(`start-up chain stopped at the ${current}: ${(0, import_err_text.errText)(e)}`);
        return;
      }
      this.log.error(`Start-up failed at the ${current}: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Open the single persistent event stream (live updates). If it already runs
   * — a re-sign-in at runtime comes through here again — a pending reconnect
   * backoff is cut short instead: the fresh token is what it was waiting for.
   */
  startEventStream() {
    if (this.terminating) {
      return;
    }
    if (this.eventStream) {
      this.eventStream.reconnectNow();
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
        this.recorder.stream(ev);
        (_a = this.sync) == null ? void 0 : _a.handleStreamEvent(ev);
      },
      onConnected: (connected, quietSince) => {
        var _a;
        this.recorder.streamState(connected ? "opened" : "lost", connected ? void 0 : (_a = this.eventStream) == null ? void 0 : _a.lastError);
        this.streamUp = connected;
        void this.publishConnection();
        this.noteStreamState(connected, quietSince);
      },
      onUnauthorized: () => {
        var _a, _b;
        return (_b = (_a = this.authCtl) == null ? void 0 : _a.refreshNow()) != null ? _b : Promise.resolve(false);
      },
      // One daily quota for the stream and REST: a 429 on the stream pauses REST too.
      onRateLimited: (ms) => this.armRatePause(ms),
      takeSlot: () => this.spaceRequests(),
      markSent: () => this.markSent(),
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (handle) => this.clearTimeout(handle)
    });
    this.eventStream.start();
  }
  /**
   * Track the event stream's up/down edges and re-read the appliances after an
   * outage that was long enough to have lost something.
   *
   * The stream is the update path, but Home Connect sends no snapshot when it
   * comes back (API research §4.5) — so without this the tree silently keeps its
   * pre-outage values while `info.connection` turns green again, and only a
   * `CONNECTED` event for that very appliance or an adapter restart would ever
   * correct it. An appliance that was online the whole time sends neither.
   *
   * @param connected whether the stream is up now
   * @param quietSince on a down-report after the keep-alive watchdog fired: when the stream went silent
   */
  noteStreamState(connected, quietSince) {
    var _a;
    if (!connected) {
      (_a = this.streamDownSince) != null ? _a : this.streamDownSince = quietSince != null ? quietSince : Date.now();
      return;
    }
    const downSince = this.streamDownSince;
    this.streamDownSince = void 0;
    if (!this.streamEverUp) {
      this.streamEverUp = true;
      return;
    }
    if (downSince === void 0) {
      return;
    }
    const outageMs = Date.now() - downSince;
    if (outageMs < STREAM_OUTAGE_RESYNC_MS) {
      this.log.debug(`event stream was down for ${Math.round(outageMs / 1e3)} s \u2014 too short to re-read.`);
      return;
    }
    this.scheduleReconnectSync(outageMs);
  }
  /**
   * Run the outage re-read now, or defer it to the end of the cooldown window —
   * the daily request quota is what the cooldown protects, and dropping the
   * re-read instead of deferring it would leave the tree stale exactly when it
   * must not be.
   *
   * @param outageMs how long the stream was down (for the log line)
   */
  scheduleReconnectSync(outageMs) {
    if (this.terminating || this.resyncTimer) {
      return;
    }
    const sinceLast = Date.now() - this.lastReconnectSync;
    if (sinceLast >= RECONNECT_SYNC_COOLDOWN_MS) {
      void this.runReconnectSync(outageMs);
      return;
    }
    const deferBy = RECONNECT_SYNC_COOLDOWN_MS - sinceLast;
    this.log.debug(`re-read after the stream outage deferred by ${Math.round(deferBy / 1e3)} s (request quota).`);
    this.resyncTimer = this.setTimeout(() => {
      this.resyncTimer = void 0;
      void this.runReconnectSync(outageMs, deferBy);
    }, deferBy);
  }
  /**
   * Re-read every appliance after a stream outage (own try/catch — fire-and-forget).
   *
   * @param outageMs how long the stream was down (for the log line)
   * @param heldBackMs how long the cooldown deferred the re-read (0 = ran at once)
   */
  async runReconnectSync(outageMs, heldBackMs = 0) {
    if (this.terminating || !this.sync) {
      return;
    }
    try {
      if (await this.sync.syncAppliances()) {
        this.lastReconnectSync = Date.now();
        const heldBack = heldBackMs <= 0 ? "" : heldBackMs < 6e4 ? ` (held back ${Math.max(1, Math.round(heldBackMs / 1e3))} s to protect the daily request quota)` : ` (held back ${Math.round(heldBackMs / 6e4)} min to protect the daily request quota)`;
        this.log.debug(
          `Live updates were interrupted for ${Math.round(outageMs / 1e3)} s \u2014 re-read the appliances${heldBack}.`
        );
      }
    } catch (e) {
      this.log.warn(`re-reading the appliances after the stream outage failed: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Write `info.connection` from its two halves: signed in AND the live stream
   * up. Only then do values actually flow; a valid token with a dead stream is
   * an instance that shows stale data.
   */
  async publishConnection() {
    try {
      await this.setStateIfChanged("auth.signedIn", { val: this.signedIn, ack: true });
      await this.setStateIfChanged("info.connection", { val: this.signedIn && this.streamUp, ack: true });
    } catch (e) {
      this.log.debug(`Could not write info.connection: ${(0, import_err_text.errText)(e)}`);
    }
  }
  /**
   * Messages from the settings panel: "Test connection" (`checkConnection`),
   * "Request a new sign-in link" (`requestSignIn`) and "Reset sign-in" (`resetLogin`).
   * Async body with a top-level try/catch; every command answers, so the panel
   * never waits on a message that fell through.
   *
   * @param obj the incoming message
   */
  async onMessage(obj) {
    try {
      if (obj.command === "diagnostics") {
        const answer = await this.diagnostics.handle(obj.message);
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
        return;
      }
      if (obj.command === "checkConnection") {
        const answer = await this.checkConnection();
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
        return;
      }
      if (obj.command === "requestSignIn" || obj.command === "resetLogin") {
        const authCtl = this.authCtl;
        const answer = authCtl ? { result: obj.command === "resetLogin" ? await authCtl.resetLogin() : await authCtl.requestSignIn() } : { error: "No Client ID configured \u2014 enter it above and save first." };
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
        return;
      }
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, { error: `Unknown command: ${String(obj.command)}` }, obj.callback);
      }
    } catch (e) {
      this.log.error(`onMessage failed: ${(0, import_err_text.errText)(e)}`);
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, { error: (0, import_err_text.errText)(e) }, obj.callback);
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
    var _a, _b, _c, _d, _e, _f;
    if (typeof this.config.clientID !== "string" || this.config.clientID.trim().length === 0) {
      return { error: (0, import_i18n.tText)("ctNoClientId") };
    }
    if (!((_a = this.authCtl) == null ? void 0 : _a.accessToken)) {
      const url = (_b = await this.getStateAsync("auth.verificationUrl")) == null ? void 0 : _b.val;
      return {
        error: typeof url === "string" && url.length > 0 ? (0, import_i18n.tText)("ctNotSignedInLink") : (0, import_i18n.tText)("ctNotSignedIn")
      };
    }
    if (Date.now() < this.restBlockedUntil) {
      const seconds = Math.ceil((this.restBlockedUntil - Date.now()) / 1e3);
      return { error: (0, import_i18n.tText)("ctRatePaused", seconds) };
    }
    const sent = this.authCtl.accessToken;
    if (!await this.spaceRequests(true)) {
      return { error: (0, import_i18n.tText)("ctShuttingDown") };
    }
    let res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, "/api/homeappliances", sent, this.acceptLanguage()));
    if (res.status === 401) {
      const fresh = await this.tokenAfter401(sent);
      if (fresh && await this.spaceRequests(true)) {
        res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, "/api/homeappliances", fresh, this.acceptLanguage()));
      }
    }
    this.countAnswer(res);
    this.record("GET", "/api/homeappliances", res);
    if (res.status === 429) {
      this.armRatePause((_c = res.retryAfterMs) != null ? _c : RATE_PAUSE_FALLBACK_MS);
      return { error: (0, import_i18n.tText)("ctRateLimited", (0, import_http.rateLimitText)(res.description, res.retryAfterMs)) };
    }
    if (res.status === 401 || res.status === 403) {
      return { error: (0, import_i18n.tText)("ctLoginRejected", res.status) };
    }
    if (res.status === 0) {
      return { error: (0, import_i18n.tText)("ctUnreachable", (_d = res.error) != null ? _d : "network error") };
    }
    if (!res.ok) {
      return {
        error: (0, import_i18n.tText)(
          "ctHttpError",
          res.status,
          `${(_e = res.error) != null ? _e : "unknown error"}${res.description ? ` (${res.description})` : ""}`
        )
      };
    }
    const list = (0, import_pure_helpers.isRecord)(res.data) && Array.isArray(res.data.homeappliances) ? res.data.homeappliances : void 0;
    if (!list) {
      return { error: (0, import_i18n.tText)("ctNoList") };
    }
    const online = list.filter((a) => (0, import_pure_helpers.isRecord)(a) && a.connected === true).length;
    const stream = this.streamUp ? (0, import_i18n.tText)("ctStreamUp") : (0, import_i18n.tText)("ctStreamDown", ((_f = this.eventStream) == null ? void 0 : _f.lastError) ? ` (${this.eventStream.lastError})` : "");
    return { result: (0, import_i18n.tText)("ctResult", list.length, online, stream) };
  }
  /**
   * Keep one REST answer for the diagnostics report.
   *
   * @param method the HTTP method
   * @param path the request path
   * @param res the answer
   * @param body what a write sent
   */
  record(method, path, res, body) {
    this.recorder.rest({
      method,
      path,
      status: res.status,
      ...res.data !== void 0 ? { data: res.data } : {},
      ...res.error !== void 0 ? { error: res.error } : {},
      ...res.description !== void 0 ? { description: res.description } : {},
      ...body !== void 0 ? { body } : {}
    });
  }
  /**
   * GET one resource for the diagnostics report's live read: through the request budget, the 401 refresh and the 429
   * pause like every request, but without a word to the sync (no "not ready" re-read, no refused-definition booking)
   * and without a log line of the REST dedup — a report changes nothing in the adapter (DB-02).
   *
   * @param path the request path
   * @returns the answer; status 0 when none came or no request could go out
   */
  async readRaw(path) {
    var _a, _b;
    const token = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (this.terminating || !token || Date.now() < this.restBlockedUntil || !await this.spaceRequests()) {
      return { path, status: 0, error: "no request went out" };
    }
    let res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, path, token, this.acceptLanguage()));
    if (res.status === 401) {
      const fresh = await this.tokenAfter401(token);
      if (fresh && await this.spaceRequests()) {
        res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, path, fresh, this.acceptLanguage()));
      }
    }
    this.countAnswer(res);
    if (res.status === 429) {
      this.armRatePause((_b = res.retryAfterMs) != null ? _b : RATE_PAUSE_FALLBACK_MS);
    }
    return {
      path,
      status: res.status,
      ...res.data !== void 0 ? { data: res.data } : {},
      ...res.error !== void 0 ? { error: res.error } : {},
      ...res.description !== void 0 ? { description: res.description } : {}
    };
  }
  /**
   * What the diagnostics report reads of this adapter — live, so a report shows the state of the moment. Built in the
   * constructor, so everything that js-controller gives the adapter later (log, host, version) is read when asked.
   *
   * @returns the host surface
   */
  reportHost() {
    const adapter = this;
    return {
      get namespace() {
        return adapter.namespace;
      },
      get version() {
        var _a;
        return (_a = adapter.version) != null ? _a : "unknown";
      },
      get hostName() {
        var _a;
        return (_a = adapter.host) != null ? _a : "";
      },
      get systemLanguage() {
        return adapter.systemLanguage;
      },
      get log() {
        return adapter.log;
      },
      startedAt: this.startedAt,
      logRing: this.logRing,
      recorder: this.recorder,
      appliances: () => {
        var _a, _b;
        return ((_b = (_a = this.sync) == null ? void 0 : _a.reportAppliances()) != null ? _b : []).map((a) => ({
          id: a.id,
          haId: a.haId,
          name: a.name,
          connected: a.reachable && this.signedIn && this.streamUp
        }));
      },
      config: () => {
        var _a;
        return {
          clientIdSet: typeof this.config.clientID === "string" && this.config.clientID.trim().length > 0,
          clientIdForm: (0, import_sign_in_help.looksLikeClientId)(String((_a = this.config.clientID) != null ? _a : "").trim()),
          clientSecretSet: typeof this.config.clientSecret === "string" && this.config.clientSecret.length > 0
        };
      },
      adapterState: () => {
        var _a, _b;
        const now = Date.now();
        return {
          signedIn: this.signedIn,
          streamUp: this.streamUp,
          streamEverUp: this.streamEverUp,
          streamDownSince: this.streamDownSince !== void 0 ? new Date(this.streamDownSince).toISOString() : void 0,
          streamLastError: (_a = this.eventStream) == null ? void 0 : _a.lastError,
          restPausedForS: this.restBlockedUntil > now ? Math.ceil((this.restBlockedUntil - now) / 1e3) : 0,
          requestsLastMinute: this.sentAt.filter((t) => now - t < 6e4).length,
          errorStreak: this.errorStreak,
          lastReconnectSync: this.lastReconnectSync > 0 ? new Date(this.lastReconnectSync).toISOString() : void 0,
          signInLastError: (_b = this.stateMirror.held("auth.lastError")) == null ? void 0 : _b.val
        };
      },
      applianceState: (id) => {
        var _a, _b;
        return (_b = (_a = this.sync) == null ? void 0 : _a.reportState(id)) != null ? _b : {};
      },
      secrets: () => {
        var _a, _b, _c, _d, _e, _f;
        const link = (_a = this.stateMirror.held("auth.verificationUrl")) == null ? void 0 : _a.val;
        const userCode = typeof link === "string" ? (_b = /[?&](?:user_)?code=([^&]+)/.exec(link)) == null ? void 0 : _b[1] : void 0;
        return [
          (_d = (_c = this.authCtl) == null ? void 0 : _c.accessToken) != null ? _d : "",
          String((_e = this.config.clientID) != null ? _e : ""),
          String((_f = this.config.clientSecret) != null ? _f : ""),
          typeof link === "string" ? link : "",
          userCode != null ? userCode : ""
        ];
      },
      liveReadBlocked: () => {
        var _a;
        const now = Date.now();
        if (this.terminating) {
          return "the adapter is shutting down";
        }
        if (!((_a = this.authCtl) == null ? void 0 : _a.accessToken)) {
          return "not signed in to Home Connect";
        }
        if (this.restBlockedUntil > now) {
          return `Home Connect blocks requests for another ${Math.ceil((this.restBlockedUntil - now) / 1e3)} s`;
        }
        if (this.errorStreak >= ERROR_STREAK_LIMIT) {
          return `${this.errorStreak} error answers in a row \u2014 requests wait (Home Connect blocks after 10)`;
        }
        return void 0;
      },
      readRaw: (path) => this.readRaw(path),
      getForeignObjectAsync: (id) => this.getForeignObjectAsync(id),
      getForeignStatesAsync: (pattern) => this.getForeignStatesAsync(pattern),
      getObjectViewAsync: (design, search, params) => this.getObjectViewAsync(design, search, params)
    };
  }
  /**
   * GET a Home Connect resource with the current access token. Retries once after
   * a 401 (token refreshed), honours a 429 Retry-After pause, and dedups failure
   * logging (first per category → warn, repeats → debug, recovery → info).
   *
   * @param path the endpoint path
   * @returns the unwrapped data; `null` when the appliance answered that there is
   *   none (no program selected / active); `undefined` when nothing is known —
   *   a failure, the rate-limit pause, or a busy appliance
   */
  async apiGet(path) {
    var _a, _b, _c, _d;
    const token = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (this.terminating || !token || this.restPaused(path)) {
      return void 0;
    }
    const source = `GET ${path}`;
    if (!await this.spaceRequests() || this.restPaused(path)) {
      return void 0;
    }
    let res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, path, token, this.acceptLanguage()));
    if (res.status === 401) {
      const fresh = await this.tokenAfter401(token);
      if (fresh && await this.spaceRequests()) {
        res = await this.sent((0, import_http.getJson)(DEFAULT_BASE_URL, path, fresh, this.acceptLanguage()));
      }
    }
    this.countAnswer(res);
    this.record("GET", path, res);
    if (!res.ok) {
      const answer = res.error;
      if (answer !== void 0 && NOT_READY_ANSWERS.has(answer)) {
        this.log.debug(`${source}: ${answer} (the appliance is still initializing)`);
        (_b = this.sync) == null ? void 0 : _b.noteNotReady(path);
        return void 0;
      }
      if (answer !== void 0 && (NO_PROGRAM_ANSWERS.has(answer) || BUSY_ANSWERS.has(answer) || UNSUPPORTED_ANSWERS.has(answer))) {
        this.restLog.recovered((0, import_log_dedup.restLogKey)(source), `${source} succeeded: ${answer} (a normal appliance answer).`);
        if (UNSUPPORTED_ANSWERS.has(answer)) {
          (_c = this.sync) == null ? void 0 : _c.noteUnsupportedProgram(path);
        }
        return NO_PROGRAM_ANSWERS.has(answer) ? null : void 0;
      }
      this.handleRestFailure(source, res);
      if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
        (_d = this.sync) == null ? void 0 : _d.noteRefused(path);
      }
      return void 0;
    }
    this.restLog.recovered((0, import_log_dedup.restLogKey)(source), `${source} succeeded.`);
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
    var _a;
    if (this.terminating) {
      return void 0;
    }
    const source = `${req.method} ${req.path}`;
    const token = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (!token) {
      this.restLog.report(
        (0, import_log_dedup.restLogKey)(source),
        `${source} dropped \u2014 not signed in to Home Connect (a new sign-in is pending).`,
        { kind: "auth" }
      );
      return void 0;
    }
    if (this.dropWhilePaused(source)) {
      return void 0;
    }
    if (!await this.spaceRequests(true) || this.dropWhilePaused(source)) {
      return void 0;
    }
    let res = await this.sent(this.sendWrite(req, token));
    if (res.status === 401) {
      const fresh = await this.tokenAfter401(token);
      if (fresh && await this.spaceRequests(true)) {
        res = await this.sent(this.sendWrite(req, fresh));
      }
    }
    this.countAnswer(res);
    this.record(req.method, req.path, res, req.body);
    if (res.ok) {
      this.restLog.recovered((0, import_log_dedup.restLogKey)(source), `${source} succeeded.`);
    } else {
      this.handleRestFailure(source, res);
    }
    return res;
  }
  /**
   * Drop a user write while REST is paused after a 429 — visibly (deduped): a
   * dropped write is a lost user action.
   *
   * @param source the call source ("PUT /…")
   * @returns whether the write was dropped
   */
  dropWhilePaused(source) {
    if (Date.now() >= this.restBlockedUntil) {
      return false;
    }
    const seconds = Math.ceil((this.restBlockedUntil - Date.now()) / 1e3);
    this.restLog.report(
      (0, import_log_dedup.restLogKey)(source),
      `${source} dropped \u2014 Home Connect REST is paused (rate limit) for another ${seconds} s.`,
      { kind: "rate" }
    );
    return true;
  }
  /**
   * Pause REST for at least `ms` from now. Never shortens a pause already
   * running: a later 429 without Retry-After (60 s) used to cut a long
   * daily-quota pause down to a minute.
   *
   * @param ms the pause in ms
   */
  armRatePause(ms) {
    this.restBlockedUntil = Math.max(this.restBlockedUntil, Date.now() + ms);
  }
  /**
   * The token to retry with after a 401. If another caller refreshed while this
   * request was on its way, the current token already is the fresh one — a
   * second refresh would only spend the token endpoint's own quota.
   *
   * @param sent the access token the rejected request carried
   * @returns the token to retry with, or undefined when there is none
   */
  async tokenAfter401(sent) {
    var _a, _b, _c;
    const current = (_a = this.authCtl) == null ? void 0 : _a.accessToken;
    if (current && current !== sent) {
      return current;
    }
    return await ((_b = this.authCtl) == null ? void 0 : _b.refreshNow()) ? (_c = this.authCtl) == null ? void 0 : _c.accessToken : void 0;
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
   * Take a place for one request: at least {@link requestGapMs} after the previous one and at most
   * {@link requestsPerMinute} in any minute. Callers queue up; a user's write goes before every waiting read, so a
   * button does not wait behind the first read of all appliances.
   *
   * @param write whether the request carries a user action (a write or the connection test)
   * @returns false when the adapter started shutting down during the wait — the request must not go out then
   */
  spaceRequests(write = false) {
    return new Promise((resolve) => {
      const firstRead = write ? this.slotQueue.findIndex((entry) => !entry.write) : -1;
      this.slotQueue.splice(firstRead === -1 ? this.slotQueue.length : firstRead, 0, { write, resolve });
      void this.pumpSlots();
    });
  }
  /**
   * Stamp a request that just went out: called with the transport call as its argument, so the call has started — and
   * reached fetch, which every transport calls before its first await — when the stamp is taken, in the same synchronous
   * step (tooling round 140). The counted time then never lies before the moment the request left, and every declared
   * window holds without a reserve. Raises the stamp {@link pumpSlots} reserved when it handed out the place: the pump
   * waits at least one gap after a hand-out, so the last send time is this request's.
   *
   * @param call the transport call that was just started
   * @returns the same call
   */
  sent(call) {
    this.markSent();
    return call;
  }
  /** Raise the reserved send time to now — {@link sent} for a transport that calls fetch itself (the event stream). */
  markSent() {
    this.lastSentAt = Date.now();
    this.sentAt.splice(-1, 1, this.lastSentAt);
  }
  /**
   * Hand out the places in queue order, waiting out the gap and the minute budget between them. A hand-out reserves the
   * place with its own time; the caller raises it to the moment its request went out ({@link sent}).
   */
  async pumpSlots() {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (this.slotQueue.length > 0) {
        const now = Date.now();
        this.sentAt = this.sentAt.filter((at) => now - at < 6e4);
        const budgetWait = this.sentAt.length >= requestsPerMinute() ? this.sentAt[0] + 6e4 - now : 0;
        const pause = Math.max(this.lastSentAt + requestGapMs() - now, budgetWait);
        if (budgetWait > 0 && !this.budgetNoted) {
          this.budgetNoted = true;
          this.log.info(
            `Home Connect allows ${requestsPerMinute()} requests per minute \u2014 reading the appliances is spread over the next minutes; the datapoints fill in as they arrive.`
          );
        }
        if (pause > 0 && !this.terminating) {
          await this.delay(pause);
          continue;
        }
        const next = this.slotQueue.shift();
        if (this.terminating) {
          next == null ? void 0 : next.resolve(false);
          continue;
        }
        this.lastSentAt = Date.now();
        this.sentAt.push(this.lastSentAt);
        next == null ? void 0 : next.resolve(true);
      }
    } catch (e) {
      this.log.debug(`request queue stopped: ${(0, import_err_text.errText)(e)}`);
      for (const entry of this.slotQueue.splice(0)) {
        entry.resolve(false);
      }
    } finally {
      this.pumping = false;
    }
  }
  /**
   * Keep count of successive requests that ended in an error — Home Connect blocks after ten.
   *
   * @param res the answer of a request that went out
   */
  countAnswer(res) {
    if (res.status >= 400) {
      this.errorStreak++;
    } else if (res.ok) {
      this.errorStreak = 0;
    }
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
      this.armRatePause((_a = res.retryAfterMs) != null ? _a : RATE_PAUSE_FALLBACK_MS);
    }
    const why = res.status === 429 ? `${(0, import_http.rateLimitText)(res.description, res.retryAfterMs)} \u2014 the adapter waits and continues by itself` : `${(_b = res.error) != null ? _b : "unknown"}${res.description ? ` (${res.description})` : ""}`;
    this.restLog.report((0, import_log_dedup.restLogKey)(source), `${source} failed: ${why}`, { kind: (0, import_log_dedup.categorize)(res.status) });
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
    return this.systemLanguage ? SYSTEM_TO_BSH_LOCALE[this.systemLanguage] : void 0;
  }
  /**
   * The system language from `system.config` — the fleet pattern (CLAUDE_PATTERNS.md,
   * "User-Texte lokalisieren"). Unreadable: none — the labels fall back to English
   * and the cloud picks its language itself.
   *
   * @returns an ioBroker language code, or undefined
   */
  async readSystemLanguage() {
    var _a;
    try {
      const config = await this.getForeignObjectAsync("system.config");
      const language = (_a = config == null ? void 0 : config.common) == null ? void 0 : _a.language;
      return typeof language === "string" && language.length > 0 ? language : void 0;
    } catch (e) {
      this.log.debug(`reading the system language failed: ${(0, import_err_text.errText)(e)} \u2014 labels in English`);
      return void 0;
    }
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
      (e) => this.log.debug(`Could not raise notification: ${(0, import_err_text.errText)(e)}`)
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
      this.handOverRequestBudget();
      this.signedIn = false;
      this.streamUp = false;
      const authCtl = this.authCtl;
      authCtl == null ? void 0 : authCtl.stop();
      this.authCtl = void 0;
      (_a = this.eventStream) == null ? void 0 : _a.stop();
      this.eventStream = void 0;
      (_b = this.sync) == null ? void 0 : _b.stop();
      if (this.resyncTimer) {
        this.clearTimeout(this.resyncTimer);
        this.resyncTimer = void 0;
      }
      const writes = this.ownStatesRead ? [
        this.setStateIfChanged("info.connection", { val: false, ack: true }),
        this.setStateIfChanged("auth.signedIn", { val: false, ack: true }),
        // Off: nothing to report (the fleet's reason-text rule) — the next start asks again.
        this.setStateIfChanged("auth.lastError", { val: "Unknown", ack: true })
      ] : [];
      if (authCtl) {
        writes.push(authCtl.settle().then(() => authCtl.persistPendingToken()));
      }
      if (this.sync) {
        writes.push(this.sync.markAllUnreachable());
      }
      void Promise.allSettled(writes).then((results) => {
        for (const r of results) {
          if (r.status === "rejected") {
            this.log.debug(`Final shutdown write failed: ${(0, import_err_text.errText)(r.reason)}`);
          }
        }
      }).finally(() => callback());
      return;
    } catch {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = Object.assign((options) => new Homeconnect(options), {
    Homeconnect
  });
} else {
  (() => new Homeconnect())();
}
//# sourceMappingURL=main.js.map
