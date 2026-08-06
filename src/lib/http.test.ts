import { describe, it, expect, vi, afterEach } from "vitest";
import { postForm } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postForm", () => {
  it("sends a url-encoded body to the resolved URL and parses the JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postForm("https://api.home-connect.com", "/security/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: "RT",
    });

    expect(res).toEqual({ status: 200, ok: true, body: { access_token: "x" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.home-connect.com/security/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("grant_type=refresh_token&refresh_token=RT");
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("maps a network error / timeout to a non-ok result with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const res = await postForm("https://api.home-connect.com", "/x", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });

  it("returns a non-ok result carrying the HTTP status for a 4xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    const res = await postForm("https://api.home-connect.com", "/x", {});
    expect(res).toEqual({ status: 400, ok: false, body: { error: "invalid_grant" } });
  });

  it("returns a null body for an empty or non-JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    expect((await postForm("https://api.home-connect.com", "/x", {})).body).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>nope</html>", { status: 200 })));
    expect((await postForm("https://api.home-connect.com", "/x", {})).body).toBeNull();
  });
});
