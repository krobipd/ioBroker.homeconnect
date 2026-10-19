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
var report_jobs_exports = {};
__export(report_jobs_exports, {
  REPORT_COOLDOWN_MS: () => REPORT_COOLDOWN_MS,
  REPORT_KEEP_MS: () => REPORT_KEEP_MS,
  ReportJobs: () => ReportJobs
});
module.exports = __toCommonJS(report_jobs_exports);
var import_err_text = require("../err-text");
var import_report_file = require("./report-file");
const REPORT_COOLDOWN_MS = 2e3;
const REPORT_KEEP_MS = 10 * 6e4;
class ReportJobs {
  /**
   * @param source the adapter's side
   * @param now the clock (injectable for tests)
   */
  constructor(source, now = Date.now) {
    this.source = source;
    this.now = now;
  }
  source;
  now;
  running = /* @__PURE__ */ new Set();
  finished = /* @__PURE__ */ new Map();
  jobs = /* @__PURE__ */ new Map();
  jobCount = 0;
  /**
   * Answer one `diagnostics` message.
   *
   * @param payload `{ action: "list" }`, `{ action: "start", device }` or `{ action: "result", job }`
   * @returns the answer for the card
   */
  handle(payload) {
    const { action, device, job } = typeof payload === "object" && payload !== null ? payload : {};
    this.dropUnfetched();
    if (action === "list") {
      return Promise.resolve({ devices: this.list() });
    }
    if (action === "start") {
      return Promise.resolve(this.start(typeof device === "string" ? device : ""));
    }
    if (action === "result") {
      return Promise.resolve(this.result(typeof job === "string" ? job : ""));
    }
    return Promise.resolve({ error: `unknown diagnostics action '${String(action)}'` });
  }
  /**
   * Every device, connected or not — a report is wanted exactly when a device misbehaves.
   *
   * @returns the devices, by label
   */
  list() {
    return this.source.devices().map((d) => ({
      value: d.id,
      label: d.label && d.label !== d.id ? `${d.label} (${d.id})` : d.id,
      connected: d.connected
    })).sort((a, b) => a.label.localeCompare(b.label));
  }
  /**
   * Begin one device's report and answer at once; a second start while it runs gets the same job.
   *
   * @param deviceId the device id
   * @returns the job, or why there is none
   */
  start(deviceId) {
    for (const [id2, job2] of this.jobs) {
      if (job2.device === deviceId && !job2.result) {
        return { job: id2 };
      }
    }
    if (!this.source.devices().some((d) => d.id === deviceId)) {
      return { error: `unknown device '${deviceId}'` };
    }
    const id = `${deviceId}#${++this.jobCount}`;
    const job = { device: deviceId };
    this.jobs.set(id, job);
    void this.make(deviceId).then((result) => {
      job.result = result;
      job.doneAt = this.now();
    });
    return { job: id };
  }
  /**
   * A started report: still pending, gone, or the result — handed over once.
   *
   * @param id the job id `start` answered
   * @returns the answer
   */
  result(id) {
    const job = this.jobs.get(id);
    if (!job) {
      return { gone: true };
    }
    if (!job.result) {
      return { pending: true };
    }
    this.jobs.delete(id);
    return job.result;
  }
  /** Drop the finished reports nobody fetched within REPORT_KEEP_MS. */
  dropUnfetched() {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      if (job.doneAt !== void 0 && now - job.doneAt > REPORT_KEEP_MS) {
        this.jobs.delete(id);
      }
    }
  }
  /**
   * Make one device's report: the live read only for a connected device, then the adapter's body inside the frame.
   *
   * @param deviceId the device id
   * @returns the report, or why there is none
   */
  async make(deviceId) {
    var _a;
    const device = this.source.devices().find((d) => d.id === deviceId);
    const now = this.now();
    if (!device) {
      return { error: `unknown device '${deviceId}'` };
    }
    if (this.running.has(deviceId) || now - ((_a = this.finished.get(deviceId)) != null ? _a : -Infinity) < REPORT_COOLDOWN_MS) {
      return { error: "a report for this device is being made right now \u2014 try again in a moment" };
    }
    this.running.add(deviceId);
    try {
      let live;
      let liveError;
      if (device.connected) {
        try {
          live = await this.source.readLive(deviceId);
        } catch (e) {
          liveError = (0, import_err_text.errText)(e);
        }
      }
      const body = await this.source.build(deviceId, live, liveError);
      const made = new Date(this.now());
      const frame = (0, import_report_file.reportFrame)(this.source.adapter, this.source.version, made, device.connected);
      const liveRead = !device.connected ? "not connected" : liveError !== void 0 ? "failed" : live === void 0 || live === null ? "nothing" : "read";
      const fileName = (0, import_report_file.reportFileName)(this.source.adapter, body.fileId, this.source.version, made);
      this.source.log.info(`${deviceId}: diagnostics report ready (${fileName})`);
      return { fileName, content: JSON.stringify({ ...body.content, ...frame, liveRead }, null, 2) };
    } catch (e) {
      const reason = (0, import_err_text.errText)(e);
      this.source.log.warn(`${deviceId}: diagnostics report failed: ${reason}`);
      return { error: `report failed: ${reason}` };
    } finally {
      this.running.delete(deviceId);
      this.finished.set(deviceId, this.now());
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  REPORT_COOLDOWN_MS,
  REPORT_KEEP_MS,
  ReportJobs
});
//# sourceMappingURL=report-jobs.js.map
