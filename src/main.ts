import * as utils from "@iobroker/adapter-core";
import { HomeConnectAuth, extractRefreshToken, needsRefresh, type StoredToken } from "./lib/oauth";
import { getJson, postForm, putJson, deleteJson, type JsonResult } from "./lib/http";
import {
  transformItem,
  transformOptionDefinition,
  shortEnum,
  stateIdForKey,
  type BshOptionDefinition,
} from "./lib/value-transformer";
import { resolveWrite, type WriteContext, type WriteRequest } from "./lib/command-dispatch";
import { slugify } from "./lib/pure-helpers";
import { EventStream } from "./lib/event-stream";
import type { SseEvent } from "./lib/sse-parser";

/** Production API host (global EU/US region; China would be api.home-connect.cn). */
const DEFAULT_BASE_URL = "https://api.home-connect.com";
/** How often to check whether the access token is due for a refresh. */
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min
/** ioBroker system language → Home Connect locale for the Accept-Language header. */
const SYSTEM_TO_BSH_LOCALE: Partial<Record<string, string>> = {
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
  "zh-cn": "zh-CN",
};

/**
 * ioBroker.homeconnect — Home Connect / BSH home appliances (Bosch, Siemens,
 * NEFF, Gaggenau) via the Home Connect cloud API.
 *
 * Greenfield rewrite. Current scope: OAuth sign-in (device flow + token refresh,
 * token stored encrypted). The REST device tree, event stream and value
 * transformer are built on top of this in the following steps.
 */
export class Homeconnect extends utils.Adapter {
  private auth: HomeConnectAuth | undefined;
  private token: StoredToken | undefined;
  private refreshTimer: ioBroker.Interval | undefined;
  private deviceFlowTimer: ioBroker.Timeout | undefined;
  private eventStream: EventStream | undefined;
  /** haId → speaking device id, for routing stream events. */
  private readonly deviceIds = new Map<string, string>();
  /** speaking device id → haId, for routing writes back to the appliance. */
  private readonly haIds = new Map<string, string>();
  /** Namespace-relative state id → its BSH key + candidate values; also gates object creation. */
  private readonly knownStates = new Map<string, { bshKey?: string; bshValues?: string[] }>();
  /** device id → the option ids that came from the selected program's definition (writable, sent on start). */
  private readonly optionKeys = new Map<string, Set<string>>();

  /**
   * @param options adapter options passed through by js-controller
   */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "homeconnect",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /** Adapter start. Async body with a top-level try/catch (never a call-site .catch). */
  private async onReady(): Promise<void> {
    try {
      await this.setState("info.connection", { val: false, ack: true });

      const clientId = this.config.clientID;
      const clientSecret = this.config.clientSecret;
      if (!clientId || !clientSecret) {
        this.log.warn(
          "No Home Connect client ID / secret configured — open the adapter settings and enter your developer application credentials.",
        );
        return;
      }

      this.auth = new HomeConnectAuth({ clientId, clientSecret, baseUrl: DEFAULT_BASE_URL }, (path, form) =>
        postForm(DEFAULT_BASE_URL, path, form),
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
  private async authenticate(auth: HomeConnectAuth): Promise<void> {
    const refreshToken = await this.loadRefreshToken();
    if (refreshToken) {
      try {
        await this.applyToken(await auth.refresh(refreshToken));
        this.log.info("Home Connect: signed in (reused the stored login).");
        await this.onAuthenticated();
        return;
      } catch (e) {
        this.log.warn(
          `Stored login could not be refreshed (${e instanceof Error ? e.message : String(e)}); a new device-flow sign-in is required.`,
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
  private async loadRefreshToken(): Promise<string | undefined> {
    const state = await this.getStateAsync("auth.session");
    const raw = typeof state?.val === "string" ? state.val : "";
    if (raw.length === 0) {
      return undefined;
    }
    // Previous adapter: cleartext JSON — extractRefreshToken reads it directly.
    const direct = extractRefreshToken(raw);
    if (direct) {
      return direct;
    }
    // Our format: encrypted JSON.
    try {
      return extractRefreshToken(this.decrypt(raw));
    } catch {
      return undefined;
    }
  }

  /**
   * Start the device flow: publish the verification URL for the user, then poll
   * (via a managed timer) until the sign-in is approved or the device code expires.
   *
   * @param auth the configured OAuth flow driver
   */
  private async runDeviceFlow(auth: HomeConnectAuth): Promise<void> {
    const dev = await auth.startDeviceFlow();
    await this.setState("auth.verificationUrl", {
      val: dev.verificationUriComplete ?? dev.verificationUri,
      ack: true,
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
  private pollDeviceFlow(auth: HomeConnectAuth, deviceCode: string, intervalMs: number, expiresAt: number): void {
    this.deviceFlowTimer = this.setTimeout(() => {
      void (async () => {
        if (Date.now() >= expiresAt) {
          this.log.warn("Home Connect sign-in timed out — restart the adapter to try again.");
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
  private async applyToken(token: StoredToken): Promise<void> {
    this.token = token;
    await this.setState("auth.session", { val: this.encrypt(JSON.stringify(token)), ack: true });
    await this.setState("info.connection", { val: true, ack: true });
  }

  /** Arm the periodic check that refreshes the access token before it expires. */
  private armRefreshTimer(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = this.setInterval(() => {
      void (async () => {
        if (!this.token || !this.auth || !needsRefresh(this.token, Date.now())) {
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
  private async onAuthenticated(): Promise<void> {
    this.armRefreshTimer();
    await this.syncAppliances();
    await this.subscribeStatesAsync("*");
    this.startEventStream();
  }

  /** Open the single persistent event stream (live updates), if not already running. */
  private startEventStream(): void {
    if (this.eventStream) {
      return;
    }
    this.eventStream = new EventStream({
      baseUrl: DEFAULT_BASE_URL,
      getAccessToken: () => this.token?.accessToken,
      onEvent: ev => this.handleStreamEvent(ev),
      onConnected: connected => void this.setState("info.connection", { val: connected, ack: true }),
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: handle => this.clearTimeout(handle as ioBroker.Timeout),
    });
    this.eventStream.start();
  }

  /**
   * Route a stream event to its device's states: parse the JSON payload and
   * apply each item under the speaking tree.
   *
   * @param event the parsed SSE event
   */
  private handleStreamEvent(event: SseEvent): void {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isRecord(payload)) {
      return;
    }
    // Home Connect sometimes omits the SSE id; then the haId is in the payload (issue #88).
    const haId = event.id || (typeof payload.haId === "string" ? payload.haId : undefined);
    if (!haId) {
      return;
    }
    const deviceId = this.deviceIds.get(haId);

    // A device coming (back) online, or a newly paired one: (re)build its data tree.
    // Without this an appliance that was offline at adapter start never gets its
    // status / programs / command buttons — there is no polling re-sync by design.
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
  private async syncAppliances(): Promise<void> {
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
  private async syncAppliance(a: Record<string, unknown>): Promise<void> {
    const haId = typeof a.haId === "string" ? a.haId : undefined;
    if (!haId) {
      return;
    }
    const name = typeof a.name === "string" && a.name.length > 0 ? a.name : haId;
    const deviceId = slugify(name);
    this.deviceIds.set(haId, deviceId);
    this.haIds.set(deviceId, haId);
    await this.extendObject(deviceId, {
      type: "device",
      common: { name },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber },
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
  private async syncApplianceData(deviceId: string, haId: string): Promise<void> {
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
  private async syncItems(deviceId: string, haId: string, subpath: string, arrayKey: string): Promise<void> {
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
  private async applyBshItem(deviceId: string, raw: Record<string, unknown>): Promise<void> {
    if (typeof raw.key !== "string") {
      return;
    }
    const t = transformItem({
      key: raw.key,
      value: raw.value,
      unit: typeof raw.unit === "string" ? raw.unit : undefined,
      constraints: isRecord(raw.constraints)
        ? {
            min: numberOrUndef(raw.constraints.min),
            max: numberOrUndef(raw.constraints.max),
            allowedvalues: stringArrayOrUndef(raw.constraints.allowedvalues),
          }
        : undefined,
    });
    const fullId = `${deviceId}.${t.channel}.${t.id}`;
    if (!this.knownStates.has(fullId)) {
      await this.extendObject(`${deviceId}.${t.channel}`, { type: "channel", common: { name: t.channel }, native: {} });
      await this.extendObject(fullId, {
        type: "state",
        common: t.common,
        native: { bshKey: raw.key, bshValues: t.bshValues },
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
  private async syncPrograms(deviceId: string, haId: string): Promise<void> {
    const avail = await this.apiGet(`/api/homeappliances/${haId}/programs/available`);
    const availableKeys =
      isRecord(avail) && Array.isArray(avail.programs)
        ? avail.programs
            .filter(isRecord)
            .map(p => p.key)
            .filter((k): k is string => typeof k === "string")
        : [];

    const selected = await this.apiGet(`/api/homeappliances/${haId}/programs/selected`);
    const selectedKey = isRecord(selected) && typeof selected.key === "string" ? selected.key : "";
    if (selectedKey.length > 0 || availableKeys.length > 0) {
      await this.applyBshItem(deviceId, {
        key: "BSH.Common.Root.SelectedProgram",
        value: selectedKey,
        constraints: { allowedvalues: availableKeys },
      });
    }
    // Load the selected program's option definitions (writable, with constraints)
    // BEFORE any value touches options.* — otherwise knownStates locks in the
    // read-only version the stream/value path would create first.
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
  private async applyProgramOptions(deviceId: string, options: unknown): Promise<void> {
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
  private async loadProgramOptions(deviceId: string, haId: string, programKey: string): Promise<void> {
    const def = await this.apiGet(`/api/homeappliances/${haId}/programs/available/${programKey}`);
    const options = isRecord(def) && Array.isArray(def.options) ? def.options : [];
    const fresh = new Set<string>();
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
  private async applyOptionDefinition(deviceId: string, raw: Record<string, unknown>): Promise<string | undefined> {
    if (typeof raw.key !== "string") {
      return undefined;
    }
    const opt: BshOptionDefinition = {
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : undefined,
      type: typeof raw.type === "string" ? raw.type : undefined,
      unit: typeof raw.unit === "string" ? raw.unit : undefined,
      constraints: isRecord(raw.constraints)
        ? {
            min: numberOrUndef(raw.constraints.min),
            max: numberOrUndef(raw.constraints.max),
            allowedvalues: stringArrayOrUndef(raw.constraints.allowedvalues),
            displayvalues: stringArrayOrUndef(raw.constraints.displayvalues),
            default: raw.constraints.default,
          }
        : undefined,
    };
    const t = transformOptionDefinition(opt);
    const fullId = `${deviceId}.options.${t.id}`;
    const isNew = !this.knownStates.has(fullId);
    // extendObject is unconditional so a program change refreshes the constraints,
    // but the default value is seeded only on first creation — a re-sync must not
    // overwrite a value the user configured (the live value is restored right after
    // from selected.options, which may not list every option).
    await this.extendObject(`${deviceId}.options`, { type: "channel", common: { name: "options" }, native: {} });
    await this.extendObject(fullId, {
      type: "state",
      common: t.common,
      native: { bshKey: opt.key, bshValues: t.bshValues },
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
  private async ensureCommands(deviceId: string, haId: string): Promise<void> {
    const data = await this.apiGet(`/api/homeappliances/${haId}/commands`);
    const commands = isRecord(data) && Array.isArray(data.commands) ? data.commands : [];
    for (const raw of commands) {
      if (isRecord(raw) && typeof raw.key === "string") {
        const id = stateIdForKey(raw.key).id;
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
  private async ensureButton(
    deviceId: string,
    channel: string,
    id: string,
    name: string,
    bshKey?: string,
  ): Promise<void> {
    const fullId = `${deviceId}.${channel}.${id}`;
    if (this.knownStates.has(fullId)) {
      return;
    }
    await this.extendObject(`${deviceId}.${channel}`, { type: "channel", common: { name: channel }, native: {} });
    await this.extendObject(fullId, {
      type: "state",
      common: { name, type: "boolean", role: "button", read: false, write: true },
      native: bshKey ? { bshKey } : {},
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
  private async apiGet(path: string): Promise<unknown> {
    if (!this.token) {
      return undefined;
    }
    const res = await getJson(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    if (!res.ok) {
      this.log.debug(`GET ${path} failed: ${res.error ?? "unknown"}`);
      return undefined;
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
  private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
    // ack:true = our own confirmed update (every stream/REST/write echo). Only a
    // user write (ack:false) may reach the cloud — else each update would re-PUT.
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
  private async handleWrite(id: string, value: ioBroker.StateValue): Promise<void> {
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
    const ctx: WriteContext = { haId, channel, id: stateId, bshKey: meta?.bshKey, bshValues: meta?.bshValues, value };
    if (channel === "programs" && stateId === "start") {
      ctx.selectedProgramKey = await this.resolveSelectedProgramKey(slug);
      ctx.selectedOptions = await this.collectSelectedOptions(slug);
    }
    const req = resolveWrite(ctx);
    if (req) {
      const res = await this.apiWrite(req);
      await this.postWrite(channel, stateId, slug, haId, req, res);
      // Confirm a successful non-button write (ack:true): the appliance took it, and
      // selected/options may emit no NOTIFY — without a confirmation the same value
      // written twice produces no change event the second time and would be dropped.
      if (res?.ok && !this.isMomentaryButton(channel, stateId)) {
        await this.setState(rel, { val: value, ack: true });
      }
    } else {
      this.log.debug(`Write to ${rel} ignored (no matching Home Connect command).`);
    }
    // Momentary buttons (commands, start/stop) hold no state — reset to false so
    // the next press is a real change and fires again.
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
  private isMomentaryButton(channel: string, stateId: string): boolean {
    return channel === "commands" || (channel === "programs" && (stateId === "start" || stateId === "stop"));
  }

  /**
   * Resolve the full BSH key of the currently selected program (payload of the start button).
   *
   * @param slug the device id segment
   * @returns the full program key, or undefined if none is selected / resolvable
   */
  private async resolveSelectedProgramKey(slug: string): Promise<string | undefined> {
    const st = await this.getStateAsync(`${slug}.programs.selectedProgram`);
    const short = typeof st?.val === "string" ? st.val : "";
    if (short.length === 0) {
      return undefined;
    }
    return this.knownStates.get(`${slug}.programs.selectedProgram`)?.bshValues?.find(v => shortEnum(v) === short);
  }

  /**
   * Send a resolved write to the Home Connect API and log the outcome.
   *
   * @param req the resolved request
   */
  private async apiWrite(req: WriteRequest): Promise<JsonResult | undefined> {
    if (!this.token) {
      return undefined;
    }
    const res =
      req.method === "DELETE"
        ? await deleteJson(DEFAULT_BASE_URL, req.path, this.token.accessToken)
        : await putJson(DEFAULT_BASE_URL, req.path, this.token.accessToken, req.body);
    if (res.ok) {
      this.log.debug(`${req.method} ${req.path} ok`);
    } else {
      this.log.warn(`${req.method} ${req.path} failed: ${res.error ?? "unknown"}`);
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
  private async postWrite(
    channel: string,
    stateId: string,
    slug: string,
    haId: string,
    req: WriteRequest,
    res: JsonResult | undefined,
  ): Promise<void> {
    if (!res) {
      return;
    }
    if (channel === "programs" && stateId === "selectedProgram" && res.ok && req.body?.key) {
      await this.loadProgramOptions(slug, haId, req.body.key);
      return;
    }
    if (channel === "programs" && stateId === "start" && res.status === 409 && req.body?.options) {
      this.log.info("Program did not start with the selected options — retrying with defaults.");
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
  private async collectSelectedOptions(slug: string): Promise<Array<{ key: string; value: ioBroker.StateValue }>> {
    const result: Array<{ key: string; value: ioBroker.StateValue }> = [];
    const ids = this.optionKeys.get(slug);
    if (!ids) {
      return result;
    }
    for (const id of ids) {
      const relId = `${slug}.options.${id}`;
      const meta = this.knownStates.get(relId);
      if (!meta?.bshKey) {
        continue;
      }
      const st = await this.getStateAsync(relId);
      if (!st || st.val === null || st.val === undefined) {
        continue;
      }
      const value =
        meta.bshValues && meta.bshValues.length > 0 ? meta.bshValues.find(v => shortEnum(v) === st.val) : st.val;
      if (value !== undefined && value !== null) {
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
  private acceptLanguage(): string | undefined {
    if (this.config.language) {
      return this.config.language;
    }
    return this.language ? SYSTEM_TO_BSH_LOCALE[this.language] : undefined;
  }

  /**
   * Synchronous teardown — no await, call the callback immediately (SIGKILL otherwise).
   *
   * @param callback function to invoke once teardown is complete
   */
  private onUnload(callback: () => void): void {
    try {
      if (this.refreshTimer) {
        this.clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
      }
      if (this.deviceFlowTimer) {
        this.clearTimeout(this.deviceFlowTimer);
        this.deviceFlowTimer = undefined;
      }
      this.eventStream?.stop();
      this.eventStream = undefined;
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch {
      callback();
    }
  }
}

/**
 * Type guard for a plain (non-array) object.
 *
 * @param v the value to test
 * @returns whether v is a record
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * A number, or undefined for anything else.
 *
 * @param v the value to test
 * @returns the number, or undefined
 */
function numberOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * The string elements of an array, or undefined for a non-array.
 *
 * @param v the value to test
 * @returns the string array, or undefined
 */
function stringArrayOrUndef(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Homeconnect(options);
} else {
  // Start the instance directly
  (() => new Homeconnect())();
}
