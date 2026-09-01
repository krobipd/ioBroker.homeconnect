import { describe, it, expect } from "vitest";
import { SseParser } from "./sse-parser";

describe("SseParser", () => {
  it("parses a single event with type, data and id", () => {
    const p = new SseParser();
    expect(p.push('event: STATUS\nid: HAID1\ndata: {"items":[]}\n\n')).toEqual([
      { event: "STATUS", data: '{"items":[]}', id: "HAID1" },
    ]);
  });

  it("defaults the event type to 'message'", () => {
    expect(new SseParser().push("data: hi\n\n")).toEqual([{ event: "message", data: "hi", id: undefined }]);
  });

  it("joins multi-line data with newlines", () => {
    expect(new SseParser().push("data: a\ndata: b\n\n")[0]?.data).toBe("a\nb");
  });

  it("keeps the last id across events (SSE spec)", () => {
    const p = new SseParser();
    p.push("id: X\ndata: 1\n\n");
    expect(p.push("data: 2\n\n")[0]?.id).toBe("X");
  });

  it("reassembles an event split across chunks", () => {
    const p = new SseParser();
    expect(p.push("event: STAT")).toEqual([]);
    expect(p.push("US\ndata: x\n")).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "STATUS", data: "x", id: undefined }]);
  });

  it("ignores comment/heartbeat lines and CRLF endings", () => {
    expect(new SseParser().push(": ping\r\ndata: y\r\n\r\n")).toEqual([{ event: "message", data: "y", id: undefined }]);
  });

  it("emits a KEEP-ALIVE event with empty data", () => {
    expect(new SseParser().push("event: KEEP-ALIVE\ndata: \n\n")).toEqual([
      { event: "KEEP-ALIVE", data: "", id: undefined },
    ]);
  });

  it("does not invent an event from a blank line with nothing accumulated", () => {
    // Frame separators arrive doubled on a stream that just idled. An empty event
    // would reach the adapter as a `message` with empty data on every one of them.
    expect(new SseParser().push("\n\n\n")).toEqual([]);
    const p = new SseParser();
    expect(p.push("data: 1\n\n\n\n")).toEqual([{ event: "message", data: "1", id: undefined }]);
  });

  it("accepts a field without a value and one without the optional space", () => {
    // Both forms are legal SSE. Requiring "field: value" would drop a bare
    // "data" line and keep a leading space that is part of the wire format.
    expect(new SseParser().push("event:STATUS\ndata:x\n\n")).toEqual([{ event: "STATUS", data: "x", id: undefined }]);
    expect(new SseParser().push("data\n\n")).toEqual([{ event: "message", data: "", id: undefined }]);
  });

  it("ignores fields it has no use for", () => {
    // `retry` is the server's reconnect hint; the adapter has its own back-off.
    expect(new SseParser().push("retry: 1000\nevent: A\ndata: 1\n\n")).toEqual([
      { event: "A", data: "1", id: undefined },
    ]);
  });

  it("emits multiple events from one chunk", () => {
    const evs = new SseParser().push("event: A\ndata: 1\n\nevent: B\ndata: 2\n\n");
    expect(evs.map(e => e.event)).toEqual(["A", "B"]);
  });
});

describe("SseParser buffering cap", () => {
  it("drops an endless line instead of buffering it forever", () => {
    const p = new SseParser();
    // 11 chunks of 100k without a single newline — the pending fragment is capped.
    for (let i = 0; i < 11; i++) {
      expect(p.push("x".repeat(100_000))).toEqual([]);
    }
    // Parsing resumes normally afterwards.
    const events = p.push('event: NOTIFY\ndata: {"a":1}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('{"a":1}');
  });

  it("drops accumulated data lines of an event that never dispatches", () => {
    const p = new SseParser();
    for (let i = 0; i < 11; i++) {
      p.push(`data: ${"y".repeat(100_000)}\n`);
    }
    const events = p.push("\n");
    // The oversized fragment was discarded; only the tail survives.
    expect(events).toHaveLength(1);
    expect(events[0]!.data.length).toBeLessThanOrEqual(200_000);
  });
});
