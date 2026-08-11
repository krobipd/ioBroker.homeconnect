import * as utils from "@iobroker/adapter-core";
import { HomeConnectAuth, extractRefreshToken, needsRefresh, OAuthError, type StoredToken } from "./lib/oauth";
import { getJson, postForm, putJson, deleteJson, type JsonResult } from "./lib/http";
import { ApplianceSync, type AdapterPort } from "./lib/appliance-sync";
import type { WriteRequest } from "./lib/command-dispatch";
import { EventStream } from "./lib/event-stream";
import { errMessage } from "./lib/pure-helpers";
import { LogDedup, categorize } from "./lib/log-dedup";

/** Production API host (global EU/US region; China would be api.home-connect.cn). */
const DEFAULT_BASE_URL = "https://api.home-connect.com";
/** How often to check whether the access token is due for a refresh. */
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min
/** Retry the initial sign-in this soon after a transient (non-auth) refresh failure. */
const AUTH_RETRY_MS = 30 * 1000;
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
  private auth: HomeConnectAuth | undefined;
  private token: StoredToken | undefined;
  private refreshTimer: ioBroker.Interval | undefined;
  private deviceFlowTimer: ioBroker.Timeout | undefined;
  private authRetryTimer: ioBroker.Timeout | undefined;
  private eventStream: EventStream | undefined;
  private sync: ApplianceSync | undefined;
  /** In-flight token refresh, shared by concurrent 401 callers (re-armed after it settles). */
  private refreshing: Promise<boolean> | undefined;
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
      await this.setState("info.connection", { val: false, ack: true });

      const clientId = this.config.clientID;
      const clientSecret = this.config.clientSecret;
      if (!clientId || !clientSecret) {
        this.log.warn(
          "No Home Connect client ID / secret configured — open the adapter settings and enter your developer application credentials.",
        );
        return;
      }

      this.sync = new ApplianceSync(this.makePort());
      this.auth = new HomeConnectAuth({ clientId, clientSecret, baseUrl: DEFAULT_BASE_URL }, (path, form) =>
        postForm(DEFAULT_BASE_URL, path, form),
      );
      await this.authenticate(this.auth);
    } catch (e) {
      this.log.error(`onReady failed: ${errMessage(e)}`);
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
      delObject: id => this.delObjectAsync(id),
      getForeignObjects: (pattern, type) => this.getForeignObjectsAsync(pattern, type),
      apiGet: path => this.apiGet(path),
      apiWrite: req => this.apiWrite(req),
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
  private async authenticate(auth: HomeConnectAuth): Promise<void> {
    const refreshToken = await this.loadRefreshToken();
    if (refreshToken) {
      try {
        await this.applyToken(await auth.refresh(refreshToken));
        this.log.info("Home Connect: signed in (reused the stored login).");
        await this.onAuthenticated();
        return;
      } catch (e) {
        if (e instanceof OAuthError && e.oauthError === "invalid_grant") {
          this.log.warn("Stored login is no longer valid — a new device-flow sign-in is required.");
          // fall through to the device flow
        } else {
          this.log.warn(`Stored login could not be refreshed (${errMessage(e)}) — retrying, login kept.`);
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
   * Start the device flow: publish the verification URL, raise a persistent
   * notification the user cannot miss, then poll until the sign-in is approved
   * or the device code expires.
   *
   * @param auth the configured OAuth flow driver
   */
  private async runDeviceFlow(auth: HomeConnectAuth): Promise<void> {
    const dev = await auth.startDeviceFlow();
    const url = dev.verificationUriComplete ?? dev.verificationUri;
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
          this.log.error(`Home Connect sign-in failed: ${errMessage(e)}`);
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
      if (this.token && needsRefresh(this.token, Date.now())) {
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
  private async refreshNow(): Promise<boolean> {
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
          this.log.warn(`Home Connect token refresh failed: ${errMessage(e)}`);
          await this.setState("info.connection", { val: false, ack: true });
          return false;
        } finally {
          this.refreshing = undefined;
        }
      })();
    }
    return this.refreshing;
  }

  /** After the first successful token: arm refresh, prime + build the tree, open the stream. */
  private async onAuthenticated(): Promise<void> {
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
  private startEventStream(): void {
    if (this.eventStream) {
      return;
    }
    this.eventStream = new EventStream({
      baseUrl: DEFAULT_BASE_URL,
      getAccessToken: () => this.token?.accessToken,
      onEvent: ev => this.sync?.handleStreamEvent(ev),
      onConnected: connected => void this.setState("info.connection", { val: connected, ack: true }),
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
    if (!this.token || this.restPaused(path)) {
      return undefined;
    }
    const source = `GET ${path}`;
    let res = await getJson(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    if (res.status === 401 && (await this.refreshNow()) && this.token) {
      res = await getJson(DEFAULT_BASE_URL, path, this.token.accessToken, this.acceptLanguage());
    }
    if (!res.ok) {
      this.handleRestFailure(source, res);
      return undefined;
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
  private async apiWrite(req: WriteRequest): Promise<JsonResult | undefined> {
    if (!this.token || this.restPaused(req.path)) {
      return undefined;
    }
    const source = `${req.method} ${req.path}`;
    let res = await this.sendWrite(req);
    if (res.status === 401 && (await this.refreshNow()) && this.token) {
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
  private sendWrite(req: WriteRequest): Promise<JsonResult> {
    const token = this.token!.accessToken;
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
   * Log a REST failure (deduped) and, on a 429, arm the Retry-After pause.
   *
   * @param source the call source key ("GET /status")
   * @param res the failed result
   */
  private handleRestFailure(source: string, res: JsonResult): void {
    if (res.status === 429 && res.retryAfterMs) {
      this.restBlockedUntil = Date.now() + res.retryAfterMs;
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
    return this.language ? SYSTEM_TO_BSH_LOCALE[this.language] : undefined;
  }

  /**
   * Raise a persistent user-actionable notification (best effort — a missing
   * notification subsystem must never take the adapter down).
   *
   * @param message the user-facing message
   */
  private notifyUser(message: string): void {
    this.registerNotification(NOTIFY_SCOPE, NOTIFY_CATEGORY, message).catch(e =>
      this.log.debug(`Could not raise notification: ${errMessage(e)}`),
    );
  }

  /** Clear the sign-in notification once the adapter is authenticated. */
  private resolveUserNotification(): void {
    // js-controller has no adapter API to clear a raised notification; a fresh
    // sign-in simply stops re-raising it. Kept as a hook for clarity.
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
      if (this.authRetryTimer) {
        this.clearTimeout(this.authRetryTimer);
        this.authRetryTimer = undefined;
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

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Homeconnect(options);
} else {
  // Start the instance directly
  (() => new Homeconnect())();
}
