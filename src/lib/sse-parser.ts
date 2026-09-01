// Incremental Server-Sent-Events parser (W3C SSE line protocol). Pure and
// synchronous: feed it text chunks as they arrive from the stream, it returns
// the complete events. Written by hand instead of pulling in `eventsource`,
// whose listener API produced the leak this greenfield replaces.

/** A parsed SSE event. */
export interface SseEvent {
  /** The event type (`event:` field), defaulting to "message". */
  event: string;
  /** The joined `data:` lines. */
  data: string;
  /** The last-seen `id:` (persists across events per the SSE spec). */
  id: string | undefined;
}

/**
 * Cap on buffered-but-incomplete input (a line without newline, or data lines
 * without the dispatching blank line). Real Home Connect events are tiny; only
 * a broken peer/proxy streams megabytes without a delimiter — instead of
 * growing without bound, the pending fragment is dropped and parsing resumes.
 */
export const MAX_PENDING_CHARS = 1_000_000;

/** Stateful incremental SSE parser — one instance per stream connection. */
export class SseParser {
  private buffer = "";
  private eventType = "";
  private dataLines: string[] = [];
  private pendingDataChars = 0;
  private lastId: string | undefined;

  /**
   * Feed a text chunk and get back every event completed by it (a blank line
   * dispatches the accumulated event). Partial trailing lines are buffered.
   *
   * @param chunk the next piece of the event stream
   * @returns the events completed within this chunk (possibly empty)
   */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    if (this.buffer.length > MAX_PENDING_CHARS) {
      this.buffer = "";
    }
    const events: SseEvent[] = [];
    let nl = this.buffer.indexOf("\n");
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, "");
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") {
        const ev = this.dispatch();
        if (ev) {
          events.push(ev);
        }
      } else {
        this.parseLine(line);
      }
      nl = this.buffer.indexOf("\n");
    }
    return events;
  }

  /**
   * Parse a single non-blank line into the current event's fields.
   *
   * @param line the line (without the trailing newline)
   */
  private parseLine(line: string): void {
    if (line.startsWith(":")) {
      // Comment / heartbeat line. (A comment would fall out below anyway — its
      // colon is at index 0, so the field name is empty and matches nothing —
      // but naming the case beats relying on that.)
      return;
    }
    const colon = line.indexOf(":");
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : "";
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      this.eventType = value;
    } else if (field === "data") {
      this.pendingDataChars += value.length;
      if (this.pendingDataChars > MAX_PENDING_CHARS) {
        // An event that never dispatches (no blank line) must not grow forever.
        this.dataLines = [];
        this.pendingDataChars = value.length;
      }
      this.dataLines.push(value);
    } else if (field === "id") {
      this.lastId = value;
    }
    // `retry` is ignored — reconnect timing is the caller's policy.
  }

  /**
   * Emit the accumulated event on a blank line and reset the per-event fields
   * (the id persists per the SSE spec).
   *
   * @returns the completed event, or undefined if there was nothing to emit
   */
  private dispatch(): SseEvent | undefined {
    if (this.eventType === "" && this.dataLines.length === 0) {
      return undefined;
    }
    const ev: SseEvent = {
      event: this.eventType === "" ? "message" : this.eventType,
      data: this.dataLines.join("\n"),
      id: this.lastId,
    };
    this.eventType = "";
    this.dataLines = [];
    this.pendingDataChars = 0;
    return ev;
  }
}
