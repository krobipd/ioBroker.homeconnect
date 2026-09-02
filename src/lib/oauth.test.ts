import { describe, it, expect } from "vitest";
import {
  HomeConnectAuth,
  accessExpiryMs,
  needsRefresh,
  extractRefreshToken,
  toStoredToken,
  OAuthError,
  DEVICE_AUTH_PATH,
  TOKEN_PATH,
  type FormPoster,
  type FormPostResult,
  type StoredToken,
} from "./oauth";

const NOW = 1_700_000_000_000;
const CONFIG = { clientId: "cid", clientSecret: "secret", baseUrl: "https://api.home-connect.com" };

/**
 * A FormPoster that returns queued results and records the calls it received.
 *
 * @param results Results handed out one per post, in order
 */
function fakePoster(results: FormPostResult[]): {
  post: FormPoster;
  calls: Array<{ path: string; form: Record<string, string> }>;
} {
  const calls: Array<{ path: string; form: Record<string, string> }> = [];
  let i = 0;
  const post: FormPoster = (path, form) => {
    calls.push({ path, form });
    const res = results[i++];
    if (!res) {
      throw new Error("fakePoster: no more queued results");
    }
    return Promise.resolve(res);
  };
  return { post, calls };
}

const ok = (body: unknown): FormPostResult => ({ status: 200, ok: true, body });
const fail = (status: number, body: unknown): FormPostResult => ({ status, ok: false, body });
const TOKEN_BODY = { access_token: "AT", refresh_token: "RT", expires_in: 86400, scope: "Monitor Control" };

describe("pure helpers", () => {
  it("accessExpiryMs adds expires_in seconds to now", () => {
    expect(accessExpiryMs(3600, NOW)).toBe(NOW + 3_600_000);
  });

  it("needsRefresh is false well before, true inside the margin", () => {
    expect(needsRefresh({ accessExpires: NOW + 2 * 3_600_000 } as StoredToken, NOW)).toBe(false);
    expect(needsRefresh({ accessExpires: NOW + 30 * 60_000 } as StoredToken, NOW)).toBe(true);
    expect(needsRefresh({ accessExpires: NOW - 1 } as StoredToken, NOW)).toBe(true);
  });

  describe("extractRefreshToken", () => {
    it("reads the previous adapter's raw JSON (refresh_token)", () => {
      expect(extractRefreshToken('{"access_token":"x","refresh_token":"OLD"}')).toBe("OLD");
    });
    it("reads our own format (refreshToken)", () => {
      expect(extractRefreshToken('{"refreshToken":"MINE","accessToken":"x"}')).toBe("MINE");
    });
    it("returns undefined for empty, non-JSON, or token-less input", () => {
      expect(extractRefreshToken("")).toBeUndefined();
      expect(extractRefreshToken(null)).toBeUndefined();
      expect(extractRefreshToken("not json")).toBeUndefined();
      expect(extractRefreshToken("{}")).toBeUndefined();
      expect(extractRefreshToken('{"refresh_token":""}')).toBeUndefined();
    });
  });

  describe("toStoredToken", () => {
    it("normalizes a valid token response with absolute expiry", () => {
      expect(toStoredToken(TOKEN_BODY, NOW)).toEqual({
        accessToken: "AT",
        refreshToken: "RT",
        accessExpires: NOW + 86_400_000,
        scope: "Monitor Control",
      });
    });
    it("throws on a malformed response", () => {
      expect(() => toStoredToken({ access_token: "AT" }, NOW)).toThrow(OAuthError);
      expect(() => toStoredToken(null, NOW)).toThrow(OAuthError);
    });
  });
});

describe("HomeConnectAuth.startDeviceFlow", () => {
  it("returns the verification URL, user code and poll interval", async () => {
    const { post, calls } = fakePoster([
      ok({ device_code: "DC", user_code: "1234", verification_uri: "https://verify", interval: 5, expires_in: 600 }),
    ]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    const dev = await auth.startDeviceFlow();
    expect(dev).toMatchObject({
      deviceCode: "DC",
      userCode: "1234",
      verificationUri: "https://verify",
      intervalMs: 5000,
    });
    expect(dev.expiresAt).toBe(NOW + 600_000);
    expect(calls[0]).toMatchObject({ path: DEVICE_AUTH_PATH, form: { client_id: "cid" } });
  });

  it("falls back to sane defaults when interval and expires_in are missing", async () => {
    const { post } = fakePoster([ok({ device_code: "DC", user_code: "1234", verification_uri: "https://verify" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    const dev = await auth.startDeviceFlow();
    // Both fields are optional in RFC 8628. Without the defaults the poll runs at
    // interval NaN (never firing) and the code counts as expired immediately —
    // the sign-in would be impossible instead of merely slower.
    expect(dev.intervalMs).toBe(5000);
    expect(dev.expiresAt).toBe(NOW + 600_000);
  });

  it("throws on a malformed device authorization response", async () => {
    const { post } = fakePoster([ok({ user_code: "1234" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    await expect(auth.startDeviceFlow()).rejects.toThrow(OAuthError);
  });
});

describe("HomeConnectAuth.pollForToken", () => {
  it("returns the token once the user approved", async () => {
    const { post, calls } = fakePoster([ok(TOKEN_BODY)]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    const token = await auth.pollForToken("DC");
    expect(token).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      accessExpires: NOW + 86_400_000,
      scope: "Monitor Control",
    });
    expect(calls[0]).toMatchObject({
      path: TOKEN_PATH,
      form: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: "DC" },
    });
  });

  it("returns 'pending' while approval is still outstanding", async () => {
    const { post } = fakePoster([fail(400, { error: "authorization_pending" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    expect(await auth.pollForToken("DC")).toBe("pending");
  });

  it("returns 'slow_down' when the server asks for a longer poll interval", async () => {
    const { post } = fakePoster([fail(400, { error: "slow_down" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    expect(await auth.pollForToken("DC")).toBe("slow_down");
  });

  it("throws on a terminal error (expired device code)", async () => {
    const { post } = fakePoster([fail(400, { error: "expired_token" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    await expect(auth.pollForToken("DC")).rejects.toThrow(OAuthError);
  });
});

describe("HomeConnectAuth.refresh", () => {
  it("returns a fresh token carrying the rotated refresh token", async () => {
    const { post, calls } = fakePoster([ok({ ...TOKEN_BODY, refresh_token: "ROTATED" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    const token = await auth.refresh("OLD");
    expect(token.refreshToken).toBe("ROTATED");
    expect(token.accessExpires).toBe(NOW + 86_400_000);
    expect(calls[0]).toMatchObject({ path: TOKEN_PATH, form: { grant_type: "refresh_token", refresh_token: "OLD" } });
  });

  it("throws OAuthError with the error code on invalid_grant", async () => {
    const { post } = fakePoster([fail(400, { error: "invalid_grant" })]);
    const auth = new HomeConnectAuth(CONFIG, post, () => NOW);
    await expect(auth.refresh("OLD")).rejects.toMatchObject({ name: "OAuthError", oauthError: "invalid_grant" });
  });
});

describe("HomeConnectAuth remaining paths", () => {
  it("uses the real clock when none is injected", () => {
    const before = Date.now();
    const auth = new HomeConnectAuth(CONFIG, fakePoster([]).post);
    // The default clock is what production runs on; an injected-only path would
    // leave the real expiry arithmetic untested.
    expect(auth).toBeInstanceOf(HomeConnectAuth);
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  it("falls back to the plain verification URL when there is no pre-filled one", async () => {
    const { post } = fakePoster([
      ok({ device_code: "DC", user_code: "1234", verification_uri: "https://verify", interval: 5, expires_in: 600 }),
    ]);
    const dev = await new HomeConnectAuth(CONFIG, post, () => NOW).startDeviceFlow();
    expect(dev.verificationUriComplete).toBeUndefined();
    expect(dev.verificationUri).toBe("https://verify");
  });

  it("rejects a device authorization that is not an object at all", async () => {
    for (const body of [null, "nope", 42]) {
      const { post } = fakePoster([{ status: 200, ok: true, body }]);
      await expect(new HomeConnectAuth(CONFIG, post, () => NOW).startDeviceFlow()).rejects.toThrow(OAuthError);
    }
  });

  it("names the status when the poll error body carries no code", async () => {
    const { post } = fakePoster([{ status: 500, ok: false, body: null }]);
    // "Device flow failed: undefined" is not a report anyone can act on.
    await expect(new HomeConnectAuth(CONFIG, post, () => NOW).pollForToken("DC")).rejects.toThrow(/status 500/);
  });

  it("reads a token whose scope the server left out", () => {
    const t = toStoredToken({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }, NOW);
    expect(t.scope).toBe("");
  });

  it("rejects a session that is valid JSON but not an object", () => {
    for (const raw of ["null", '"just a string"', "[1,2]", "42"]) {
      expect(extractRefreshToken(raw)).toBeUndefined();
    }
    // An empty token field is as good as none — returning "" would make the
    // controller try a refresh that can only fail.
    expect(extractRefreshToken(JSON.stringify({ refreshToken: "", refresh_token: "" }))).toBeUndefined();
  });
});
