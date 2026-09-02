// Auth lifecycle — extracted from main.ts so the sign-in orchestration is a
// testable unit (a fake AuthPort + injected timers stand in for the adapter).
// Owns the token, the periodic refresh, the device flow including its polling,
// and the recovery paths: a transient refresh failure retries with the login
// kept; a revoked login (invalid_grant, at start-up OR at runtime) drops to a
// fresh device-flow sign-in; an expired or rejected sign-in link is replaced by
// a fresh one automatically, so the link in the admin panel is always valid.

import { needsRefresh, OAuthError } from "./oauth";
import type { HomeConnectAuth, DeviceAuthorization, StoredToken } from "./oauth";
import { errMessage } from "./pure-helpers";

/** How often to check whether the access token is due for a refresh. */
export const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min
/** Retry the initial sign-in this soon after a transient (non-auth) refresh failure. */
export const AUTH_RETRY_MS = 30 * 1000;
/**
 * Cap for the growing wait between FAILED token-refresh attempts. The token
 * endpoint has its own quota (10 refreshes/minute, 100/day — official rate-limit
 * docs), so failed attempts back off 30 s → doubling → this cap (≈ 50 attempts
 * per day worst case) instead of retrying on a fixed clock.
 */
export const REFRESH_BACKOFF_MAX_MS = 30 * 60 * 1000;
/** Retry a failed device-flow *start* this soon (kind to the OAuth endpoints). */
export const DEVICE_FLOW_RETRY_MS = 5 * 60 * 1000;
/** RFC 8628: when the server answers slow_down, grow the poll interval by 5 s. */
export const SLOW_DOWN_STEP_MS = 5_000;

/** The slice of the adapter the auth lifecycle needs — injected so it can be faked in tests. */
export interface AuthPort {
  /** The adapter logger. */
  readonly log: ioBroker.Logger;
  /** Read the stored refresh token (decryption + legacy format handled by the adapter). */
  loadRefreshToken(): Promise<string | undefined>;
  /** Persist a fresh token (the adapter encrypts it). */
  saveToken(token: StoredToken): Promise<void>;
  /** Publish the sign-in verification URL ("" clears it). */
  setVerificationUrl(url: string): Promise<void>;
  /** Reflect the signed-in/connected flag. */
  setConnected(connected: boolean): Promise<void>;
  /** Raise the persistent "sign-in required" notification. */
  notify(message: string): void;
  /** Called after every successful sign-in (initial or re-auth): wire up the adapter. */
  onSignedIn(): Promise<void>;
  /** Schedule a callback (the adapter's managed setTimeout). */
  setTimer(cb: () => void, ms: number): unknown;
  /** Cancel a scheduled callback. */
  clearTimer(handle: unknown): void;
  /** Schedule a repeating callback (the adapter's managed setInterval). */
  setIntervalTimer(cb: () => void, ms: number): unknown;
  /** Cancel a repeating callback. */
  clearIntervalTimer(handle: unknown): void;
  /** Clock, injectable for deterministic tests (defaults to Date.now). */
  now?: () => number;
}

/** Drives sign-in, token refresh and re-authentication against an injected adapter port. */
export class AuthController {
  private token: StoredToken | undefined;
  /** In-flight token refresh, shared by concurrent 401 callers (re-armed after it settles). */
  private refreshing: Promise<boolean> | undefined;
  private refreshTimer: unknown;
  private deviceFlowTimer: unknown;
  private retryTimer: unknown;
  private stopped = false;
  /** Consecutive failed refresh attempts — drives the growing retry back-off. */
  private refreshFailures = 0;
  /** Epoch-ms before which no new refresh attempt may hit the token endpoint. */
  private nextRefreshAllowed = 0;
  /** Whether a transient refresh failure was already warned about (repeats → debug). */
  private refreshWarned = false;
  /** Whether the current sign-in episode already raised the notification + info line. */
  private signInAnnounced = false;

  /**
   * @param auth the configured OAuth flow driver
   * @param port the injected adapter capabilities
   */
  constructor(
    private readonly auth: HomeConnectAuth,
    private readonly port: AuthPort,
  ) {}

  /** The current access token, or undefined while not signed in. */
  get accessToken(): string | undefined {
    return this.token?.accessToken;
  }

  /** Current epoch-ms (injected clock in tests, Date.now otherwise). */
  private now(): number {
    return this.port.now ? this.port.now() : Date.now();
  }

  /** Begin the auth lifecycle: reuse the stored login, or run the device flow. */
  async start(): Promise<void> {
    await this.authenticate();
  }

  /** Cancel all timers (synchronous, for onUnload). */
  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      this.port.clearIntervalTimer(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.deviceFlowTimer) {
      this.port.clearTimer(this.deviceFlowTimer);
      this.deviceFlowTimer = undefined;
    }
    if (this.retryTimer) {
      this.port.clearTimer(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  /**
   * Obtain a valid access token: reuse the stored refresh token if there is one,
   * otherwise run the device flow. A refresh that fails because the token was
   * revoked (`invalid_grant`) drops to a fresh device-flow sign-in; a transient
   * failure (network / 5xx / timeout) keeps the stored token and just retries,
   * so a blip during a restart does not force the user to re-authorise.
   */
  private async authenticate(): Promise<void> {
    // A retry timer whose callback was already queued when onUnload ran still
    // arrives here. Without this check it talks to the token endpoint and writes
    // states from a stopped instance ("Connection is closed"), and a success
    // would re-arm the refresh interval the teardown just cleared.
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
        if (e instanceof OAuthError && e.oauthError === "invalid_grant") {
          this.port.log.warn("Stored login is no longer valid — a new device-flow sign-in is required.");
          // fall through to the device flow
        } else {
          const delay = this.nextRefreshBackoff();
          this.port.log.warn(
            `Stored login could not be refreshed (${errMessage(e)}) — retrying in ${Math.round(delay / 1000)} s, login kept.`,
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
  private async runDeviceFlow(): Promise<void> {
    if (this.stopped) {
      return;
    }
    let dev: DeviceAuthorization;
    try {
      dev = await this.auth.startDeviceFlow();
    } catch (e) {
      this.port.log.warn(`Could not start the Home Connect sign-in (${errMessage(e)}) — next attempt in 5 minutes.`);
      this.retryTimer = this.port.setTimer(() => void this.guard(() => this.runDeviceFlow()), DEVICE_FLOW_RETRY_MS);
      return;
    }
    const url = dev.verificationUriComplete ?? dev.verificationUri;
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
  private pollDeviceFlow(deviceCode: string, intervalMs: number, expiresAt: number): void {
    this.deviceFlowTimer = this.port.setTimer(() => {
      void this.guard(async () => {
        if (this.stopped) {
          return;
        }
        if (this.now() >= expiresAt) {
          this.port.log.debug("the sign-in code expired unused — requesting a fresh sign-in link.");
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
          this.port.log.warn(`Home Connect sign-in failed (${errMessage(e)}) — requesting a fresh sign-in link.`);
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
  private async applyToken(token: StoredToken): Promise<void> {
    this.token = token;
    await this.port.saveToken(token);
    await this.port.setConnected(true);
  }

  /** After a successful sign-in: reset the episode flags, arm the refresh, wire the adapter. */
  private async signedIn(): Promise<void> {
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
  private nextRefreshBackoff(): number {
    const delay = Math.min(REFRESH_BACKOFF_MAX_MS, AUTH_RETRY_MS * 2 ** this.refreshFailures);
    this.refreshFailures++;
    this.nextRefreshAllowed = this.now() + delay;
    return delay;
  }

  /** Arm the periodic check that refreshes the access token before it expires. */
  private armRefreshTimer(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = this.port.setIntervalTimer(() => {
      if (this.token && needsRefresh(this.token, this.now())) {
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
  async refreshNow(): Promise<boolean> {
    if (!this.token) {
      return false;
    }
    if (!this.refreshing) {
      // Failed attempts back off (the token endpoint has its own daily quota);
      // sequential 401 callers during the back-off window don't hit it again.
      if (this.now() < this.nextRefreshAllowed) {
        return false;
      }
      const refreshToken = this.token.refreshToken;
      this.refreshing = (async (): Promise<boolean> => {
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
          if (e instanceof OAuthError && e.oauthError === "invalid_grant") {
            // Only a revoked login ends the signed-in state. A transient failure
            // keeps the current access token, which stays valid until its expiry —
            // reporting "not connected" for it would be a false alarm.
            await this.port.setConnected(false);
            this.port.log.warn("Home Connect login was revoked — a new sign-in is required.");
            this.token = undefined;
            void this.guard(() => this.runDeviceFlow());
          } else {
            const delay = this.nextRefreshBackoff();
            const level = this.refreshWarned ? "debug" : "warn";
            this.port.log[level](
              `Home Connect token refresh failed: ${errMessage(e)} — next attempt in ${Math.round(delay / 1000)} s.`,
            );
            this.refreshWarned = true;
          }
          return false;
        } finally {
          this.refreshing = undefined;
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
  private async guard(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.port.log.error(`auth task failed: ${errMessage(e)}`);
    }
  }
}
