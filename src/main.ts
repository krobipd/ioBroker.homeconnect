import * as utils from "@iobroker/adapter-core";

/**
 * ioBroker.homeconnect — Home Connect / BSH home appliances (Bosch, Siemens,
 * NEFF, Gaggenau) via the Home Connect cloud API.
 *
 * Greenfield rewrite. This file is currently the lifecycle skeleton only — the
 * BSH REST client, OAuth device flow, event stream and value transformer are
 * added on top of it in the following build steps. Nothing talks to the Home
 * Connect cloud yet.
 */
export class Homeconnect extends utils.Adapter {
  /**
   * @param options adapter options passed through by js-controller
   */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "homeconnect",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /** Adapter start. Async body with a top-level try/catch (never a call-site .catch). */
  private async onReady(): Promise<void> {
    try {
      await this.setState("info.connection", { val: false, ack: true });
      this.log.info("homeconnect skeleton started — Home Connect cloud connection not implemented yet.");
    } catch (e) {
      this.log.error(`onReady failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Synchronous teardown — no await, call the callback immediately (SIGKILL otherwise).
   *
   * @param callback function to invoke once teardown is complete
   */
  private onUnload(callback: () => void): void {
    try {
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch {
      callback();
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Homeconnect(options);
} else {
  // Start the instance directly
  (() => new Homeconnect())();
}
