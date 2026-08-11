import { describe, it, expect } from "vitest";
import { LogDedup, categorize } from "./log-dedup";

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
