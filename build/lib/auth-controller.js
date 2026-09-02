"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var auth_controller_exports = {};
__export(auth_controller_exports, {
  AUTH_RETRY_MS: () => AUTH_RETRY_MS,
  AuthController: () => AuthController,
  DEVICE_FLOW_RETRY_MS: () => DEVICE_FLOW_RETRY_MS,
  REFRESH_BACKOFF_MAX_MS: () => REFRESH_BACKOFF_MAX_MS,
  REFRESH_CHECK_INTERVAL_MS: () => REFRESH_CHECK_INTERVAL_MS,
  SLOW_DOWN_STEP_MS: () => SLOW_DOWN_STEP_MS
});
module.exports = __toCommonJS(auth_controller_exports);
var import_oauth = require("./oauth");
var import_pure_helpers = require("./pure-helpers");
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1e3;
const AUTH_RETRY_MS = 30 * 1e3;
const REFRESH_BACKOFF_MAX_MS = 30 * 60 * 1e3;
const DEVICE_FLOW_RETRY_MS = 5 * 60 * 1e3;
const SLOW_DOWN_STEP_MS = 5e3;
class AuthController {
  /**
   * @param auth the configured OAuth flow driver
   * @param port the injected adapter capabilities
   */
  constructor(auth, port) {
    this.auth = auth;
    this.port = port;
  }
  auth;
  port;
  token;
  /** In-flight token refresh, shared by concurrent 401 callers (re-armed after it settles). */
  refreshing;
  refreshTimer;
  deviceFlowTimer;
  retryTimer;
  stopped = false;
  /** Consecutive failed refresh attempts — drives the growing retry back-off. */
  refreshFailures = 0;
  /** Epoch-ms before which no new refresh attempt may hit the token endpoint. */
  nextRefreshAllowed = 0;
  /** Whether a transient refresh failure was already warned about (repeats → debug). */
  refreshWarned = false;
  /** Whether the current sign-in episode already raised the notification + info line. */
  signInAnnounced = false;
  /** The current access token, or undefined while not signed in. */
  get accessToken() {
    var _a;
    return (_a = this.token) == null ? void 0 : _a.accessToken;
  }
  /** Current epoch-ms (injected clock in tests, Date.now otherwise). */
  now() {
    return this.port.now ? this.port.now() : Date.now();
  }
  /** Begin the auth lifecycle: reuse the stored login, or run the device flow. */
  async start() {
    await this.authenticate();
  }
  /** Cancel all timers (synchronous, for onUnload). */
  stop() {
    this.stopped = true;
    if (this.refreshTimer) {
      this.port.clearIntervalTimer(this.refreshTimer);
      this.refreshTimer = void 0;
    }
    if (this.deviceFlowTimer) {
      this.port.clearTimer(this.deviceFlowTimer);
      this.deviceFlowTimer = void 0;
    }
    if (this.retryTimer) {
      this.port.clearTimer(this.retryTimer);
      this.retryTimer = void 0;
    }
  }
  /**
   * Obtain a valid access token: reuse the stored refresh token if there is one,
   * otherwise run the device flow. A refresh that fails because the token was
   * revoked (`invalid_grant`) drops to a fresh device-flow sign-in; a transient
   * failure (network / 5xx / timeout) keeps the stored token and just retries,
   * so a blip during a restart does not force the user to re-authorise.
   */
  async authenticate() {
    if (this.stopped) {
      return;
    }
    const refreshToken = await this.port.loadRefreshToken();
    if (refreshToken) {
      try {
        await this.applyToken(await this.auth.refresh(refreshToken));
        this.port.log.info("Home Connect: signed in (reused the stored login).");
        await this.signedIn();
        return;
      } catch (e) {
        if (e instanceof import_oauth.OAuthError && e.oauthError === "invalid_grant") {
          this.port.log.warn("Stored login is no longer valid \u2014 a new device-flow sign-in is required.");
        } else {
          const delay = this.nextRefreshBackoff();
          this.port.log.warn(
            `Stored login could not be refreshed (${(0, import_pure_helpers.errMessage)(e)}) \u2014 retrying in ${Math.round(delay / 1e3)} s, login kept.`
          );
          this.retryTimer = this.port.setTimer(() => void this.guard(() => this.authenticate()), delay);
          return;
        }
      }
    }
    await this.runDeviceFlow();
  }
  /**
   * Start (or restart) the device flow: publish the verification URL, announce
   * the sign-in once per episode (notification + info; later cycles only renew
   * the link on debug), then poll until approved. A failed start (network,
   * rejected credentials) retries after a pause instead of giving up.
   */
  async runDeviceFlow() {
    var _a;
    if (this.stopped) {
      return;
    }
    let dev;
    try {
      dev = await this.auth.startDeviceFlow();
    } catch (e) {
      this.port.log.warn(`Could not start the Home Connect sign-in (${(0, import_pure_helpers.errMessage)(e)}) \u2014 next attempt in 5 minutes.`);
      this.retryTimer = this.port.setTimer(() => void this.guard(() => this.runDeviceFlow()), DEVICE_FLOW_RETRY_MS);
      return;
    }
    const url = (_a = dev.verificationUriComplete) != null ? _a : dev.verificationUri;
    await this.port.setVerificationUrl(url);
    const message = `Home Connect sign-in required: open ${dev.verificationUri} and enter code ${dev.userCode}`;
    if (this.signInAnnounced) {
      this.port.log.debug(`sign-in link renewed: ${dev.verificationUri} code ${dev.userCode}`);
    } else {
      this.port.log.info(message);
      this.port.notify(message);
      this.signInAnnounced = true;
    }
    this.pollDeviceFlow(dev.deviceCode, dev.intervalMs, dev.expiresAt);
  }
  /**
   * One device-flow poll, rescheduled via a managed timer. An expired code or a
   * terminal error does not strand the adapter: the flow restarts with a fresh
   * link (and the stale URL is cleared first).
   *
   * @param deviceCode the device code to poll with
   * @param intervalMs the poll interval (grown on a slow_down answer)
   * @param expiresAt absolute epoch-ms after which the device code is dead
   */
  pollDeviceFlow(deviceCode, intervalMs, expiresAt) {
    this.deviceFlowTimer = this.port.setTimer(() => {
      void this.guard(async () => {
        if (this.stopped) {
          return;
        }
        if (this.now() >= expiresAt) {
          this.port.log.debug("the sign-in code expired unused \u2014 requesting a fresh sign-in link.");
          await this.port.setVerificationUrl("");
          await this.runDeviceFlow();
          return;
        }
        try {
          const result = await this.auth.pollForToken(deviceCode);
          if (result === "pending") {
            this.pollDeviceFlow(deviceCode, intervalMs, expiresAt);
          } else if (result === "slow_down") {
            this.pollDeviceFlow(deviceCode, intervalMs + SLOW_DOWN_STEP_MS, expiresAt);
          } else {
            await this.port.setVerificationUrl("");
            await this.applyToken(result);
            this.port.log.info("Home Connect: signed in.");
            await this.signedIn();
          }
        } catch (e) {
          this.port.log.warn(`Home Connect sign-in failed (${(0, import_pure_helpers.errMessage)(e)}) \u2014 requesting a fresh sign-in link.`);
          await this.port.setVerificationUrl("");
          await this.runDeviceFlow();
        }
      });
    }, intervalMs);
  }
  /**
   * Persist a freshly obtained token and mark the service connected.
   *
   * @param token the token to store and use
   */
  async applyToken(token) {
    this.token = token;
    await this.port.saveToken(token);
    await this.port.setConnected(true);
  }
  /** After a successful sign-in: reset the episode flags, arm the refresh, wire the adapter. */
  async signedIn() {
    this.signInAnnounced = false;
    this.refreshWarned = false;
    this.refreshFailures = 0;
    this.nextRefreshAllowed = 0;
    this.armRefreshTimer();
    await this.port.onSignedIn();
  }
  /**
   * The wait before the next refresh attempt after a failure: 30 s, doubling per
   * consecutive failure, capped — protecting the token endpoint's own daily quota.
   *
   * @returns the back-off delay in ms (also arms {@link nextRefreshAllowed})
   */
  nextRefreshBackoff() {
    const delay = Math.min(REFRESH_BACKOFF_MAX_MS, AUTH_RETRY_MS * 2 ** this.refreshFailures);
    this.refreshFailures++;
    this.nextRefreshAllowed = this.now() + delay;
    return delay;
  }
  /** Arm the periodic check that refreshes the access token before it expires. */
  armRefreshTimer() {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = this.port.setIntervalTimer(() => {
      if (this.token && (0, import_oauth.needsRefresh)(this.token, this.now())) {
        void this.refreshNow();
      }
    }, REFRESH_CHECK_INTERVAL_MS);
  }
  /**
   * Refresh the access token now, sharing one in-flight attempt across concurrent
   * callers (the periodic timer and any 401 from a REST call). A transient
   * failure keeps the login and warns once (repeats → debug); a revoked login
   * (`invalid_grant`) drops the dead token — which also stops the event stream's
   * fetches — and starts a fresh device-flow sign-in.
   *
   * @returns whether a fresh token was obtained
   */
  async refreshNow() {
    if (!this.token) {
      return false;
    }
    if (!this.refreshing) {
      if (this.now() < this.nextRefreshAllowed) {
        return false;
      }
      const refreshToken = this.token.refreshToken;
      this.refreshing = (async () => {
        try {
          await this.applyToken(await this.auth.refresh(refreshToken));
          if (this.refreshWarned) {
            this.port.log.info("Home Connect token refresh succeeded again.");
            this.refreshWarned = false;
          }
          this.refreshFailures = 0;
          this.nextRefreshAllowed = 0;
          this.port.log.debug("Home Connect: access token refreshed.");
          return true;
        } catch (e) {
          if (e instanceof import_oauth.OAuthError && e.oauthError === "invalid_grant") {
            await this.port.setConnected(false);
            this.port.log.warn("Home Connect login was revoked \u2014 a new sign-in is required.");
            this.token = void 0;
            void this.guard(() => this.runDeviceFlow());
          } else {
            const delay = this.nextRefreshBackoff();
            const level = this.refreshWarned ? "debug" : "warn";
            this.port.log[level](
              `Home Connect token refresh failed: ${(0, import_pure_helpers.errMessage)(e)} \u2014 next attempt in ${Math.round(delay / 1e3)} s.`
            );
            this.refreshWarned = true;
          }
          return false;
        } finally {
          this.refreshing = void 0;
        }
      })();
    }
    return this.refreshing;
  }
  /**
   * Run a fire-and-forget async unit with a top-level catch (no unhandled rejection).
   *
   * @param fn the async unit to run
   */
  async guard(fn) {
    try {
      await fn();
    } catch (e) {
      this.port.log.error(`auth task failed: ${(0, import_pure_helpers.errMessage)(e)}`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUTH_RETRY_MS,
  AuthController,
  DEVICE_FLOW_RETRY_MS,
  REFRESH_BACKOFF_MAX_MS,
  REFRESH_CHECK_INTERVAL_MS,
  SLOW_DOWN_STEP_MS
});
//# sourceMappingURL=auth-controller.js.map
