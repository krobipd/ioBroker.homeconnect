// Home Connect OAuth 2 — headless Device Flow + token refresh.
// Wire details (endpoints, params, timings) are pinned in
// `Ressourcen/homeconnect/bsh-api-research-2026-08-05.md` / reference_bsh_home_connect_api.
//
// This module is pure orchestration: HTTP is injected as a `FormPoster`, so the
// flows are unit-testable without a network or an adapter instance. Token
// encryption/persistence is the caller's job (the adapter uses `encrypt()`).

/** OAuth endpoint paths, relative to the API base URL. */
export const DEVICE_AUTH_PATH = "/security/oauth/device_authorization";
export const TOKEN_PATH = "/security/oauth/token";

/** Refresh the access token this long before it actually expires (safety margin). */
export const REFRESH_MARGIN_MS = 60 * 60 * 1000; // 1 h

/** Static OAuth application credentials + region base URL. */
export interface OAuthConfig {
  /** Home Connect developer application client ID. */
  clientId: string;
  /** Home Connect developer application client secret. */
  clientSecret: string;
  /** Region base URL, e.g. "https://api.home-connect.com". */
  baseUrl: string;
}

/** A token as we persist it: absolute expiry, so it survives an adapter restart. */
export interface StoredToken {
  /** The bearer access token for API requests. */
  accessToken: string;
  /** The (rotating) refresh token used to obtain the next access token. */
  refreshToken: string;
  /** Absolute epoch-ms when the access token expires. */
  accessExpires: number;
  /** The space-separated scopes the token was granted. */
  scope: string;
}

/** Result of a form POST: the caller (or a test) supplies parsed JSON + status. */
export interface FormPostResult {
  /** HTTP status code. */
  status: number;
  /** Whether the status is 2xx. */
  ok: boolean;
  /** The parsed JSON response body. */
  body: unknown;
}
export type FormPoster = (path: string, form: Record<string, string>) => Promise<FormPostResult>;

/** Device authorization response (start of the device flow). */
export interface DeviceAuthorization {
  /** The URL the user opens to approve the device. */
  verificationUri: string;
  /** The verification URL with the user code already embedded, if provided. */
  verificationUriComplete?: string;
  /** The code the user enters at the verification URL. */
  userCode: string;
  /** The device code the adapter polls the token endpoint with. */
  deviceCode: string;
  /** Poll interval in ms. */
  intervalMs: number;
  /** Absolute epoch-ms when the device code expires. */
  expiresAt: number;
}

/** Thrown when authorization ultimately fails (device code expired, denied, bad credentials). */
export class OAuthError extends Error {
  /**
   * @param message human-readable error message
   * @param oauthError the machine-readable OAuth `error` code, if any
   */
  constructor(
    message: string,
    readonly oauthError?: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

// ─── pure helpers (unit-tested directly) ────────────────────────────────────

/**
 * Absolute expiry from an `expires_in` (seconds) relative to `now` (ms).
 *
 * @param expiresInSeconds the token lifetime in seconds (from the token response)
 * @param now current epoch-ms
 * @returns the absolute epoch-ms when the token expires
 */
export function accessExpiryMs(expiresInSeconds: number, now: number): number {
  return now + expiresInSeconds * 1000;
}

/**
 * True once the access token is within the refresh margin of expiry (or already past).
 *
 * @param token the stored token to check
 * @param now current epoch-ms
 * @param marginMs how long before expiry to already refresh
 * @returns whether the token should be refreshed now
 */
export function needsRefresh(token: StoredToken, now: number, marginMs = REFRESH_MARGIN_MS): boolean {
  return token.accessExpires - now <= marginMs;
}

/**
 * Pull a usable refresh token out of whatever sits in `auth.session`. Handles both
 * our own {@link StoredToken} (`refreshToken`) and the previous adapter's raw
 * Home Connect JSON (`refresh_token`), so a version update keeps the login without
 * a new device-flow prompt.
 *
 * @param raw the decrypted `auth.session` string (may be empty/garbage)
 * @returns the refresh token, or undefined if none can be found
 */
export function extractRefreshToken(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const camel = obj.refreshToken;
  if (typeof camel === "string" && camel.length > 0) {
    return camel;
  }
  const snake = obj.refresh_token;
  if (typeof snake === "string" && snake.length > 0) {
    return snake;
  }
  return undefined;
}

/**
 * Validate a token-endpoint response and turn it into a {@link StoredToken}.
 *
 * @param body the parsed JSON body from the token endpoint
 * @param now current epoch-ms, for the absolute expiry
 * @returns the normalized stored token
 * @throws {OAuthError} if the body is not a well-formed token response
 */
export function toStoredToken(body: unknown, now: number): StoredToken {
  if (body === null || typeof body !== "object") {
    throw new OAuthError("Token response is not an object");
  }
  const b = body as Record<string, unknown>;
  const accessToken = b.access_token;
  const refreshToken = b.refresh_token;
  const expiresIn = b.expires_in;
  const scope = b.scope;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string" || typeof expiresIn !== "number") {
    throw new OAuthError("Token response is missing access_token, refresh_token or expires_in");
  }
  return {
    accessToken,
    refreshToken,
    accessExpires: accessExpiryMs(expiresIn, now),
    scope: typeof scope === "string" ? scope : "",
  };
}

// ─── the flows ───────────────────────────────────────────────────────────────

/** Drives the Home Connect OAuth flows (device flow + refresh) against an injected HTTP transport. */
export class HomeConnectAuth {
  /**
   * @param config OAuth application credentials + region base URL
   * @param post injected form-POST transport (real fetch in the adapter, a fake in tests)
   * @param now clock, injectable for deterministic tests
   */
  constructor(
    private readonly config: OAuthConfig,
    private readonly post: FormPoster,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Start the device flow: ask for a device + user code. The caller shows the
   * verification URL to the user, then calls {@link pollForToken} with the result.
   *
   * @returns the device authorization (verification URL, user code, poll interval)
   * @throws {OAuthError} on a malformed or error response
   */
  async startDeviceFlow(): Promise<DeviceAuthorization> {
    const res = await this.post(DEVICE_AUTH_PATH, {
      client_id: this.config.clientId,
      scope: "IdentifyAppliance Monitor Settings Control",
    });
    if (!res.ok || res.body === null || typeof res.body !== "object") {
      throw new OAuthError(`Device authorization failed (status ${res.status})`);
    }
    const b = res.body as Record<string, unknown>;
    const deviceCode = b.device_code;
    const userCode = b.user_code;
    const verificationUri = b.verification_uri;
    if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUri !== "string") {
      throw new OAuthError("Device authorization response is missing required fields");
    }
    const intervalSec = typeof b.interval === "number" ? b.interval : 5;
    const expiresInSec = typeof b.expires_in === "number" ? b.expires_in : 600;
    return {
      verificationUri,
      verificationUriComplete:
        typeof b.verification_uri_complete === "string" ? b.verification_uri_complete : undefined,
      userCode,
      deviceCode,
      intervalMs: intervalSec * 1000,
      expiresAt: this.now() + expiresInSec * 1000,
    };
  }

  /**
   * Exchange a device code for a token once — returns the token on success,
   * `null` while the user has not yet approved (`authorization_pending` / `slow_down`),
   * and throws on a terminal error. The caller drives the polling loop/timer
   * (so the poll uses the adapter's managed timers, not a busy-wait here).
   *
   * @param deviceCode the device code from {@link startDeviceFlow}
   * @returns the stored token, or null if approval is still pending
   * @throws {OAuthError} on a terminal error (expired, denied, access denied)
   */
  async pollForToken(deviceCode: string): Promise<StoredToken | null> {
    const res = await this.post(TOKEN_PATH, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (res.ok) {
      return toStoredToken(res.body, this.now());
    }
    const err = this.oauthErrorCode(res.body);
    if (err === "authorization_pending" || err === "slow_down") {
      return null;
    }
    throw new OAuthError(`Device flow failed: ${err ?? `status ${res.status}`}`, err);
  }

  /**
   * Refresh an access token. Home Connect rotates the refresh token, so the
   * returned {@link StoredToken} carries the new refresh token to persist.
   *
   * @param refreshToken the current refresh token
   * @returns a fresh stored token (new access + rotated refresh token)
   * @throws {OAuthError} if the refresh is rejected (e.g. invalid_grant)
   */
  async refresh(refreshToken: string): Promise<StoredToken> {
    const res = await this.post(TOKEN_PATH, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: this.config.clientSecret,
    });
    if (!res.ok) {
      const err = this.oauthErrorCode(res.body);
      throw new OAuthError(`Token refresh failed: ${err ?? `status ${res.status}`}`, err);
    }
    return toStoredToken(res.body, this.now());
  }

  /**
   * Best-effort extraction of the OAuth `error` code from an error response body.
   *
   * @param body the parsed (error) response body
   * @returns the OAuth `error` code, or undefined if none is present
   */
  private oauthErrorCode(body: unknown): string | undefined {
    if (body !== null && typeof body === "object") {
      const e = (body as Record<string, unknown>).error;
      if (typeof e === "string") {
        return e;
      }
    }
    return undefined;
  }
}
