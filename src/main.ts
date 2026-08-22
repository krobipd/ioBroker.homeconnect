import * as utils from "@iobroker/adapter-core";
import { HomeConnectAuth, extractRefreshToken, type StoredToken } from "./lib/oauth";
import { getJson, postForm, putJson, deleteJson, type JsonResult } from "./lib/http";
import { ApplianceSync, type AdapterPort } from "./lib/appliance-sync";
import { AuthController, type AuthPort } from "./lib/auth-controller";
import { planLegacyCleanup } from "./lib/legacy-cleanup";
import type { WriteRequest } from "./lib/command-dispatch";
import { EventStream } from "./lib/event-stream";
import { errMessage } from "./lib/pure-helpers";
import { LogDedup, categorize } from "./lib/log-dedup";

/** Production API host (global EU/US region; China would be api.home-connect.cn). */
const DEFAULT_BASE_URL = "https://api.home-connect.com";
/** Pause REST this long after a 429 that carries no Retry-After header. */
const RATE_PAUSE_FALLBACK_MS = 60_000;
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

/** Notification scope + category (declared in io-package.json `notifications`). */
const NOTIFY_SCOPE = "homeconnect";
const NOTIFY_CATEGORY = "userActionRequired";

/**
 * ioBroker.homeconnect — Home Connect / BSH home appliances (Bosch, Siemens,
 * NEFF, Gaggenau) via the Home Connect cloud API. Greenfield TypeScript rewrite:
 * OAuth device flow, a speaking device tree, a single live event stream, and a
 * write path that turns state changes back into Home Connect commands.
 */
export class Homeconnect extends utils.Adapter {
  // Construction seams for the three collaborators. Production uses the real
  // classes; the orchestration tests swap them for fakes so onReady's wiring, the
  // REST paths and the teardown are testable without a network. Behaviour is
  // unchanged — same constructors, same arguments.
  private makeSync: (port: AdapterPort) => ApplianceSync = port => new ApplianceSync(port);
  private makeAuthController: (auth: HomeConnectAuth, port: AuthPort) => AuthController = (auth, port) =>
    new AuthController(auth, port);
  private makeEventStream: (deps: ConstructorParameters<typeof EventStream>[0]) => EventStream = deps =>
    new EventStream(deps);

  private authCtl: AuthController | undefined;
  private eventStream: EventStream | undefined;
  private sync: ApplianceSync | undefined;
  /** Epoch-ms until which REST calls are paused after a 429 (honours Retry-After). */
  private restBlockedUntil = 0;
  /** warn-once-per-category dedup for REST failures (keyed on call source + status band). */
  private readonly restLog = new LogDedup();

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
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });

      const clientId = this.config.clientID;
      const clientSecret = this.config.clientSecret;
      if (!clientId || !clientSecret) {
        this.log.warn(
          "No Home Connect client ID / secret configured — open the adapter settings and enter your developer application credentials.",
        );
        return;
      }

      await this.cleanupLegacyObjects();

      this.sync = this.makeSync(this.makePort());
      const auth = new HomeConnectAuth({ clientId, clientSecret, baseUrl: DEFAULT_BASE_URL }, (path, form) =>
        postForm(DEFAULT_BASE_URL, path, form),
      );
      this.authCtl = this.makeAuthController(auth, this.makeAuthPort());
      await this.authCtl.start();
    } catch (e) {
      this.log.error(`onReady failed: ${errMessage(e)}`);
    }
  }

  /**
   * Remove the previous adapter generation's object trees (raw haId roots with
   * underscored BSH keys) — an update must clean up after itself, the user does
   * not delete objects by hand. Runs before priming, so legacy states never
   * enter the in-memory maps; self-terminating (nothing left → nothing planned).
   */
  private async cleanupLegacyObjects(): Promise<void> {
    const objects = await this.getAdapterObjectsAsync();
    const prefix = `${this.namespace}.`;
    const relative: Record<string, { type?: string; native?: unknown }> = {};
    for (const [id, obj] of Object.entries(objects)) {
      if (id.startsWith(prefix)) {
        relative[id.slice(prefix.length)] = { type: obj?.type, native: obj?.native };
      }
    }
    const roots = planLegacyCleanup(relative);
    for (const root of roots) {
      await this.delObjectAsync(root, { recursive: true }).catch((e: unknown) =>
        this.log.debug(`legacy cleanup: could not delete ${root}: ${errMessage(e)}`),
      );
    }
    if (roots.length > 0) {
      this.log.info(
        `Removed ${roots.length} object tree(s) of the previous adapter generation — the speaking device tree replaces them; your sign-in is kept.`,
      );
    }
  }

  /** Build the port ApplianceSync talks to the adapter through. */
  private makePort(): AdapterPort {
    return {
      namespace: this.namespace,
      log: this.log,
      extendObject: (id, obj) => this.extendObject(id, obj),
      setState: (id, state) => this.setState(id, state),
      setStateChanged: (id, state) => this.setStateChangedAsync(id, state),
      getState: id => this.getStateAsync(id),
      getObject: id => this.getObjectAsync(id),
      setObjectNotExists: (id, obj) => this.setObjectNotExistsAsync(id, obj as ioBroker.SettableObject),
      delObject: id => this.delObjectAsync(id),
      getForeignObjects: (pattern, type) => this.getForeignObjectsAsync(pattern, type),
      apiGet: path => this.apiGet(path),
      apiWrite: req => this.apiWrite(req),
    };
  }

  /** Build the port the AuthController drives the sign-in lifecycle through. */
  private makeAuthPort(): AuthPort {
    return {
      log: this.log,
      loadRefreshToken: () => this.loadRefreshToken(),
      saveToken: token => this.saveToken(token),
      setVerificationUrl: async url => {
        await this.setState("auth.verificationUrl", { val: url, ack: true });
      },
      setConnected: async connected => {
        await this.setStateChangedAsync("info.connection", { val: connected, ack: true });
      },
      notify: message => this.notifyUser(message),
      onSignedIn: () => this.onAuthenticated(),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: handle => this.clearTimeout(handle as ioBroker.Timeout),
      setIntervalTimer: (cb, ms) => this.setInterval(cb, ms),
      clearIntervalTimer: handle => this.clearInterval(handle as ioBroker.Interval),
    };
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
    // Fast exit for the common "never signed in" case. (Both readers below would
    // also return undefined for "", so this is clarity, not a guard.)
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
   * Persist a freshly obtained token, encrypted.
   *
   * @param token the token to store
   */
  private async saveToken(token: StoredToken): Promise<void> {
    await this.setState("auth.session", { val: this.encrypt(JSON.stringify(token)), ack: true });
  }

  /** After a successful sign-in: prime + build the tree, subscribe, open the stream. */
  private async onAuthenticated(): Promise<void> {
    if (this.sync) {
      await this.sync.primeFromObjects();
      await this.sync.syncAppliances();
    }
    await this.subscribeStatesAsync("*");
    this.startEventStream();
  }

  /** Open the single persistent event stream (live updates), if not already running. */
  private startEventStream(): void {
    if (this.eventStream) {
      return;
    }
    this.eventStream = this.makeEventStream({
      baseUrl: DEFAULT_BASE_URL,
      getAccessToken: () => this.authCtl?.accessToken,
      onEvent: ev => this.sync?.handleStreamEvent(ev),
      onConnected: connected => void this.setStateChangedAsync("info.connection", { val: connected, ack: true }),
      log: (level, msg) => this.log[level](msg),
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: handle => this.clearTimeout(handle as ioBroker.Timeout),
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
  private async apiGet(path: string): Promise<unknown> {
    const token = this.authCtl?.accessToken;
    if (!token || this.restPaused(path)) {
      return undefined;
    }
    const source = `GET ${path}`;
    let res = await getJson(DEFAULT_BASE_URL, path, token, this.acceptLanguage());
    if (res.status === 401 && (await this.authCtl?.refreshNow())) {
      const fresh = this.authCtl?.accessToken;
      if (fresh) {
        res = await getJson(DEFAULT_BASE_URL, path, fresh, this.acceptLanguage());
      }
    }
    if (!res.ok) {
      this.handleRestFailure(source, res);
      return undefined;
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
  private async apiWrite(req: WriteRequest): Promise<JsonResult | undefined> {
    const token = this.authCtl?.accessToken;
    if (!token) {
      return undefined;
    }
    const source = `${req.method} ${req.path}`;
    if (Date.now() < this.restBlockedUntil) {
      const seconds = Math.ceil((this.restBlockedUntil - Date.now()) / 1000);
      const level = this.restLog.note(source, "rate");
      this.log[level](`${source} dropped — Home Connect REST is paused (rate limit) for another ${seconds} s.`);
      return undefined;
    }
    let res = await this.sendWrite(req, token);
    if (res.status === 401 && (await this.authCtl?.refreshNow())) {
      const fresh = this.authCtl?.accessToken;
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
  private sendWrite(req: WriteRequest, token: string): Promise<JsonResult> {
    return req.method === "DELETE"
      ? deleteJson(DEFAULT_BASE_URL, req.path, token)
      : putJson(DEFAULT_BASE_URL, req.path, token, req.body);
  }

  /**
   * Whether REST is currently paused after a 429 (with a one-line debug note).
   *
   * @param path the path being attempted (for the log)
   * @returns whether the call should be skipped right now
   */
  private restPaused(path: string): boolean {
    if (Date.now() < this.restBlockedUntil) {
      this.log.debug(`REST paused (rate-limited) — skipping ${path}`);
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
  private handleRestFailure(source: string, res: JsonResult): void {
    if (res.status === 429) {
      this.restBlockedUntil = Date.now() + (res.retryAfterMs ?? RATE_PAUSE_FALLBACK_MS);
    }
    const level = this.restLog.note(source, categorize(res.status));
    this.log[level](`${source} failed: ${res.error ?? "unknown"}`);
  }

  /**
   * Handle a state change: ignore our own confirmed (ack) updates, else route the
   * user's write to the Home Connect API (ApplianceSync owns the try/catch).
   *
   * @param id the full state id
   * @param state the new state (null on deletion)
   */
  private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
    if (!state || state.ack) {
      return;
    }
    void this.sync?.handleWrite(id, state.val);
  }

  /**
   * The Accept-Language to request localized names with — the ioBroker system
   * language mapped to a Home Connect locale.
   *
   * @returns a BSH locale like "de-DE", or undefined to let the API default
   */
  private acceptLanguage(): string | undefined {
    // The guard is for the type (`language` is optional); an unset language would
    // miss the table anyway and yield undefined either way.
    return this.language ? SYSTEM_TO_BSH_LOCALE[this.language] : undefined;
  }

  /**
   * Raise a persistent user-actionable notification (best effort — a missing
   * notification subsystem must never take the adapter down). js-controller has
   * no adapter API to clear a raised notification; a completed sign-in simply
   * stops re-raising it.
   *
   * @param message the user-facing message
   */
  private notifyUser(message: string): void {
    this.registerNotification(NOTIFY_SCOPE, NOTIFY_CATEGORY, message).catch(e =>
      this.log.debug(`Could not raise notification: ${errMessage(e)}`),
    );
  }

  /**
   * Synchronous teardown — no await, call the callback immediately (SIGKILL otherwise).
   *
   * @param callback function to invoke once teardown is complete
   */
  private onUnload(callback: () => void): void {
    try {
      this.authCtl?.stop();
      this.authCtl = undefined;
      this.eventStream?.stop();
      this.eventStream = undefined;
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch {
      callback();
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Homeconnect(options);
} else {
  // Start the instance directly
  (() => new Homeconnect())();
}
