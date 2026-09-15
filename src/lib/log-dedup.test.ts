import { describe, it, expect } from "vitest";
import { LogDedup, categorize, restLogKey } from "./log-dedup";

describe("categorize", () => {
  it("maps status bands to categories", () => {
    expect(categorize(0)).toBe("net");
    expect(categorize(401)).toBe("auth");
    expect(categorize(403)).toBe("auth");
    expect(categorize(429)).toBe("rate");
    expect(categorize(500)).toBe("http-5xx");
    expect(categorize(503)).toBe("http-5xx");
    expect(categorize(404)).toBe("http-4xx");
    expect(categorize(409)).toBe("http-4xx");
    expect(categorize(200)).toBe("other");
  });
});

describe("LogDedup", () => {
  it("warns on a new category, drops repeats to debug", () => {
    const d = new LogDedup();
    expect(d.note("GET /status", "rate")).toBe("warn");
    expect(d.note("GET /status", "rate")).toBe("debug");
    expect(d.note("GET /status", "rate")).toBe("debug");
  });

  it("warns again when the category changes at the same source", () => {
    const d = new LogDedup();
    expect(d.note("GET /status", "rate")).toBe("warn");
    expect(d.note("GET /status", "auth")).toBe("warn");
    expect(d.note("GET /status", "auth")).toBe("debug");
  });

  it("dedups sources independently", () => {
    const d = new LogDedup();
    expect(d.note("GET /status", "net")).toBe("warn");
    expect(d.note("GET /settings", "net")).toBe("warn");
    expect(d.note("GET /status", "net")).toBe("debug");
  });

  it("re-arms the warn after a recovery", () => {
    const d = new LogDedup();
    expect(d.note("GET /status", "rate")).toBe("warn");
    expect(d.note("GET /status", "rate")).toBe("debug");
    expect(d.recovered("GET /status")).toBe(true);
    expect(d.recovered("GET /status")).toBe(false); // already cleared
    expect(d.note("GET /status", "rate")).toBe("warn");
  });
});

describe("restLogKey (2026-09-15, F10)", () => {
  it("collapses the appliance id and a trailing item key to the endpoint kind", () => {
    const H = "GET /api/homeappliances";
    expect(restLogKey(`${H}/BOSCH-HCS06COM1-1234/settings/BSH.Common.Setting.PowerState`)).toBe(`${H}/*/settings/*`);
    expect(restLogKey(`${H}/015090396331005775/programs/available/Dishcare.Dishwasher.Program.Eco50`)).toBe(
      `${H}/*/programs/available/*`,
    );
    expect(restLogKey(`PUT ${H.slice(4)}/HA-1/programs/selected/options/BSH.Common.Option.StartInRelative`)).toBe(
      `PUT ${H.slice(4)}/*/programs/selected/options/*`,
    );
    expect(restLogKey(`PUT ${H.slice(4)}/HA-1/commands/BSH.Common.Command.PauseProgram`)).toBe(
      `PUT ${H.slice(4)}/*/commands/*`,
    );
    // Paths without an item key keep their shape; the list endpoint stays as is.
    expect(restLogKey(`${H}/HA-1/status`)).toBe(`${H}/*/status`);
    expect(restLogKey(`${H}/HA-1/programs/selected`)).toBe(`${H}/*/programs/selected`);
    expect(restLogKey(H)).toBe(H);
  });

  it("dedups the same failure across appliances and keys, and recovers once", () => {
    // One 503 during the start-up used to warn once per path — 25 lines for
    // one outage — and say "succeeded again" 25 times when it cleared.
    const d = new LogDedup();
    expect(d.note("GET /api/homeappliances/HA-1/settings/A", "http-5xx")).toBe("warn");
    expect(d.note("GET /api/homeappliances/HA-1/settings/B", "http-5xx")).toBe("debug");
    expect(d.note("GET /api/homeappliances/HA-2/settings/A", "http-5xx")).toBe("debug");
    // A different kind still gets its own warning.
    expect(d.note("GET /api/homeappliances/HA-2/status", "http-5xx")).toBe("warn");
    expect(d.recovered("GET /api/homeappliances/HA-2/settings/B")).toBe(true);
    expect(d.recovered("GET /api/homeappliances/HA-1/settings/A")).toBe(false);
  });
});
