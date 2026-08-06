import * as utils from "@iobroker/adapter-core";
import { HomeConnectAuth, extractRefreshToken, needsRefresh, type StoredToken } from "./lib/oauth";
import { getJson, postForm } from "./lib/http";
import { transformItem, type BshItem } from "./lib/value-transformer";
import { slugify } from "./lib/pure-helpers";

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

  /** After the first successful token: arm the refresh timer and build the device tree. */
  private async onAuthenticated(): Promise<void> {
    this.armRefreshTimer();
    await this.syncAppliances();
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
    await this.extendObject(deviceId, {
      type: "device",
      common: { name },
      native: { haId, type: a.type, brand: a.brand, vib: a.vib, enumber: a.enumber },
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
  private async syncItems(deviceId: string, haId: string, subpath: string, arrayKey: string): Promise<void> {
    const data = await this.apiGet(`/api/homeappliances/${haId}${subpath}`);
    const items = isRecord(data) && Array.isArray(data[arrayKey]) ? data[arrayKey] : [];
    const channelsDone = new Set<string>();
    for (const raw of items) {
      if (!isRecord(raw) || typeof raw.key !== "string") {
        continue;
      }
      const item: BshItem = {
        key: raw.key,
        value: raw.value,
        unit: typeof raw.unit === "string" ? raw.unit : undefined,
        constraints: isRecord(raw.constraints)
          ? { min: numberOrUndef(raw.constraints.min), max: numberOrUndef(raw.constraints.max) }
          : undefined,
      };
      const t = transformItem(item);
      if (!channelsDone.has(t.channel)) {
        channelsDone.add(t.channel);
        await this.extendObject(`${deviceId}.${t.channel}`, {
          type: "channel",
          common: { name: t.channel },
          native: {},
        });
      }
      const fullId = `${deviceId}.${t.channel}.${t.id}`;
      await this.extendObject(fullId, { type: "state", common: t.common, native: { bshKey: raw.key } });
      await this.setState(fullId, { val: t.value, ack: true });
    }
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

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Homeconnect(options);
} else {
  // Start the instance directly
  (() => new Homeconnect())();
}
