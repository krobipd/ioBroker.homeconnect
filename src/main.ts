import * as utils from "@iobroker/adapter-core";
import { HomeConnectAuth, extractRefreshToken, needsRefresh, type StoredToken } from "./lib/oauth";
import { postForm } from "./lib/http";

/** Production API host (global EU/US region; China would be api.home-connect.cn). */
const DEFAULT_BASE_URL = "https://api.home-connect.com";
/** How often to check whether the access token is due for a refresh. */
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min

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

  /**
   * @param options adapter options passed through by js-controller
   */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "homeconnect",
    });

    this.on("ready", this.onReady.bind(this));
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
        this.armRefreshTimer();
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
            this.armRefreshTimer();
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
