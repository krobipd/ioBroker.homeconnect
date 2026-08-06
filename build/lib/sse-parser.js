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
var sse_parser_exports = {};
__export(sse_parser_exports, {
  SseParser: () => SseParser
});
module.exports = __toCommonJS(sse_parser_exports);
class SseParser {
  buffer = "";
  eventType = "";
  dataLines = [];
  lastId;
  /**
   * Feed a text chunk and get back every event completed by it (a blank line
   * dispatches the accumulated event). Partial trailing lines are buffered.
   *
   * @param chunk the next piece of the event stream
   * @returns the events completed within this chunk (possibly empty)
   */
  push(chunk) {
    this.buffer += chunk;
    const events = [];
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
  parseLine(line) {
    if (line.startsWith(":")) {
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
      this.dataLines.push(value);
    } else if (field === "id") {
      this.lastId = value;
    }
  }
  /**
   * Emit the accumulated event on a blank line and reset the per-event fields
   * (the id persists per the SSE spec).
   *
   * @returns the completed event, or undefined if there was nothing to emit
   */
  dispatch() {
    if (this.eventType === "" && this.dataLines.length === 0) {
      return void 0;
    }
    const ev = {
      event: this.eventType === "" ? "message" : this.eventType,
      data: this.dataLines.join("\n"),
      id: this.lastId
    };
    this.eventType = "";
    this.dataLines = [];
    return ev;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SseParser
});
//# sourceMappingURL=sse-parser.js.map
