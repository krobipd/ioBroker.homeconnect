import { afterEach, describe, expect, it, vi } from "vitest";
import { I18n } from "@iobroker/gui-components";
import type { ConfigGenericProps } from "@iobroker/json-config";

import SignIn from "./SignIn";

/** A promise with its resolve/reject handles, for answers that arrive late. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Socket {
  getState: ReturnType<typeof vi.fn>;
  subscribeState: ReturnType<typeof vi.fn>;
  unsubscribeState: ReturnType<typeof vi.fn>;
  sendTo: ReturnType<typeof vi.fn>;
}

/** The parts of the panel the tests drive (private members, reached through a cast). */
interface Panel {
  componentDidMount(): Promise<void>;
  componentWillUnmount(): void;
  runTest(): Promise<void>;
  setState: ReturnType<typeof vi.fn>;
}

function makePanel(socket: Socket): Panel {
  const props = {
    oContext: { adapterName: "homeconnect", instance: 0, socket },
    schema: {},
    data: {},
    attr: "signIn",
    themeType: "light",
  } as unknown as ConfigGenericProps;
  const panel = new SignIn(props) as unknown as Panel;
  panel.setState = vi.fn();
  return panel;
}

function makeSocket(): Socket {
  return {
    getState: vi.fn(() => Promise.resolve({ val: "" })),
    subscribeState: vi.fn(() => Promise.resolve()),
    unsubscribeState: vi.fn(),
    sendTo: vi.fn(() => Promise.resolve({ result: "ok" })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SignIn — 2026-09-24: nothing happens after the panel closed", () => {
  it("reads that finish after the close neither render nor subscribe", async () => {
    const socket = makeSocket();
    const late = deferred<{ val: unknown }>();
    socket.getState.mockReturnValue(late.promise);
    const panel = makePanel(socket);
    const mounted = panel.componentDidMount();
    panel.componentWillUnmount();
    late.resolve({ val: "https://example.invalid/verify" });
    await mounted;
    expect(panel.setState).not.toHaveBeenCalled();
    expect(socket.subscribeState).not.toHaveBeenCalled();
  });

  it("reads that fail after the close do not subscribe either", async () => {
    const socket = makeSocket();
    const late = deferred<{ val: unknown }>();
    socket.getState.mockReturnValue(late.promise);
    const panel = makePanel(socket);
    const mounted = panel.componentDidMount();
    panel.componentWillUnmount();
    late.reject(new Error("socket closed"));
    await mounted;
    expect(socket.subscribeState).not.toHaveBeenCalled();
  });

  it("a failed read on an open panel still subscribes", async () => {
    const socket = makeSocket();
    socket.getState.mockReturnValue(Promise.reject(new Error("no such state")));
    const panel = makePanel(socket);
    await panel.componentDidMount();
    expect(socket.subscribeState).toHaveBeenCalledTimes(3);
  });

  it("reads on an open panel render and subscribe", async () => {
    const socket = makeSocket();
    const panel = makePanel(socket);
    await panel.componentDidMount();
    expect(panel.setState).toHaveBeenCalledWith({ url: "", connected: false, signedIn: false });
    expect(socket.subscribeState).toHaveBeenCalledTimes(3);
  });

  it("a test answer after the close renders nothing", async () => {
    const socket = makeSocket();
    const late = deferred<{ result: string }>();
    socket.sendTo.mockReturnValue(late.promise);
    const panel = makePanel(socket);
    const test = panel.runTest();
    panel.setState.mockClear();
    panel.componentWillUnmount();
    late.resolve({ result: "Connected." });
    await test;
    expect(panel.setState).not.toHaveBeenCalled();
  });

  it("a test that fails after the close renders nothing", async () => {
    const socket = makeSocket();
    const late = deferred<never>();
    socket.sendTo.mockReturnValue(late.promise);
    const panel = makePanel(socket);
    const test = panel.runTest();
    panel.setState.mockClear();
    panel.componentWillUnmount();
    late.reject(new Error("socket closed"));
    await test;
    expect(panel.setState).not.toHaveBeenCalled();
  });
});

describe("SignIn — 2026-09-24: the connection test always ends", () => {
  it("shows the adapter's answer and leaves the testing state", async () => {
    const socket = makeSocket();
    socket.sendTo.mockReturnValue(Promise.resolve({ result: "Connected: 3 appliances." }));
    const panel = makePanel(socket);
    await panel.runTest();
    expect(panel.setState).toHaveBeenCalledWith({ testResult: { ok: true, text: "Connected: 3 appliances." } });
    expect(panel.setState).toHaveBeenLastCalledWith({ testing: false });
  });

  it("shows the adapter's error verbatim", async () => {
    const socket = makeSocket();
    socket.sendTo.mockReturnValue(Promise.resolve({ error: "Not signed in." }));
    const panel = makePanel(socket);
    await panel.runTest();
    expect(panel.setState).toHaveBeenCalledWith({ testResult: { ok: false, text: "Not signed in." } });
  });

  it("a failing socket shows the error text", async () => {
    const socket = makeSocket();
    socket.sendTo.mockReturnValue(Promise.reject(new Error("socket closed")));
    const panel = makePanel(socket);
    await panel.runTest();
    expect(panel.setState).toHaveBeenCalledWith({ testResult: { ok: false, text: "socket closed" } });
    expect(panel.setState).toHaveBeenLastCalledWith({ testing: false });
  });

  it("no answer within 70 s says so instead of testing forever", async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    socket.sendTo.mockReturnValue(new Promise(() => undefined));
    const panel = makePanel(socket);
    const test = panel.runTest();
    await vi.advanceTimersByTimeAsync(69_999);
    expect(panel.setState).not.toHaveBeenCalledWith({ testing: false });
    await vi.advanceTimersByTimeAsync(1);
    await test;
    expect(panel.setState).toHaveBeenCalledWith({ testResult: { ok: false, text: I18n.t("hc_noAnswer") } });
    expect(panel.setState).toHaveBeenLastCalledWith({ testing: false });
  });
});
