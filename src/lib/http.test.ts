import { describe, it, expect, vi, afterEach } from "vitest";
import { postForm, getJson, putJson, deleteJson } from "./http";

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

describe("getJson", () => {
  it("unwraps the data envelope and sends the bearer + accept headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { homeappliances: [{ haId: "X" }] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await getJson("https://api.home-connect.com", "/api/homeappliances", "TOKEN", "de-DE");

    expect(res).toEqual({ status: 200, ok: true, data: { homeappliances: [{ haId: "X" }] }, error: undefined });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.home-connect.com/api/homeappliances");
    expect(init.headers.authorization).toBe("Bearer TOKEN");
    expect(init.headers.accept).toBe("application/vnd.bsh.sdk.v1+json");
    expect(init.headers["accept-language"]).toBe("de-DE");
  });

  it("surfaces the BSH error key on a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { key: "SDK.Error.UnsupportedProgram" } }), { status: 409 })),
    );
    const res = await getJson("https://api.home-connect.com", "/x", "T");
    expect(res).toMatchObject({ status: 409, ok: false, data: undefined, error: "SDK.Error.UnsupportedProgram" });
  });

  it("maps a network error to status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await getJson("https://api.home-connect.com", "/x", "T");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});

describe("putJson", () => {
  it("wraps the value in a data envelope with the bsh content-type + bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await putJson("https://api.home-connect.com", "/api/homeappliances/X/settings/BSH.Common.Setting.PowerState", "T", {
      key: "BSH.Common.Setting.PowerState",
      value: "BSH.Common.EnumType.PowerState.On",
    });

    expect(res).toMatchObject({ status: 204, ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.home-connect.com/api/homeappliances/X/settings/BSH.Common.Setting.PowerState");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toBe("Bearer T");
    expect(init.headers["content-type"]).toBe("application/vnd.bsh.sdk.v1+json");
    expect(JSON.parse(init.body)).toEqual({ data: { key: "BSH.Common.Setting.PowerState", value: "BSH.Common.EnumType.PowerState.On" } });
  });

  it("surfaces the BSH error key on a 409 conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { key: "BSH.Common.Error.WrongOperationState" } }), { status: 409 })),
    );
    const res = await putJson("https://api.home-connect.com", "/x", "T", { key: "k", value: 1 });
    expect(res).toMatchObject({ status: 409, ok: false, error: "BSH.Common.Error.WrongOperationState" });
  });

  it("maps a network error to status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await putJson("https://api.home-connect.com", "/x", "T", { key: "k" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});

describe("deleteJson", () => {
  it("sends a DELETE with the bearer and treats 204 as ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteJson("https://api.home-connect.com", "/api/homeappliances/X/programs/active", "T");

    expect(res).toMatchObject({ status: 204, ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(init.headers.authorization).toBe("Bearer T");
  });

  it("surfaces the BSH error key when there is no active program", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { key: "BSH.Common.Error.NoProgramActive" } }), { status: 404 })),
    );
    const res = await deleteJson("https://api.home-connect.com", "/x", "T");
    expect(res).toMatchObject({ status: 404, ok: false, error: "BSH.Common.Error.NoProgramActive" });
  });
});
