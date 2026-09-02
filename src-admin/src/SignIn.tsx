import React from "react";

import { Box, Button, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LoginIcon from "@mui/icons-material/Login";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";
import { I18n } from "@iobroker/gui-components";

interface SignInState extends ConfigGenericState {
  /** The live verification URL (empty when none / already signed in). */
  url: string;
  /** Whether the adapter is signed in AND its live event stream is up (info.connection). */
  connected: boolean;
  /** Whether the adapter holds a usable Home Connect login (auth.signedIn). */
  signedIn: boolean;
  /** Whether a connection test is in flight. */
  testing: boolean;
  /** The last connection test's answer — the adapter's own words, not a guess. */
  testResult: { ok: boolean; text: string } | null;
}

/**
 * Live sign-in panel (jsonConfig `type: custom`). Reads `auth.verificationUrl`,
 * `auth.signedIn` and `info.connection` over the admin socket and shows one of:
 * signed in with live updates, signed in but live updates down, the one-time
 * sign-in link (open + copy), or the hint to save the credentials first — updating
 * live as the device flow progresses. The "Test connection" button asks the
 * running adapter to make a real request to Home Connect and shows its answer.
 */
export default class SignIn extends ConfigGeneric<ConfigGenericProps, SignInState> {
  private urlId = "";
  private connId = "";
  private signedInId = "";

  constructor(props: ConfigGenericProps) {
    super(props);
    this.state = { ...this.state, url: "", connected: false, signedIn: false, testing: false, testResult: null };
  }

  private readonly onUrl = (_id: string, state: ioBroker.State | null | undefined): void => {
    this.setState({ url: typeof state?.val === "string" ? state.val : "" });
  };

  private readonly onConn = (_id: string, state: ioBroker.State | null | undefined): void => {
    this.setState({ connected: state?.val === true });
  };

  private readonly onSignedIn = (_id: string, state: ioBroker.State | null | undefined): void => {
    this.setState({ signedIn: state?.val === true });
  };

  async componentDidMount(): Promise<void> {
    void super.componentDidMount?.();
    const ctx = this.props.oContext;
    const ns = `${ctx.adapterName}.${ctx.instance}`;
    this.urlId = `${ns}.auth.verificationUrl`;
    this.connId = `${ns}.info.connection`;
    this.signedInId = `${ns}.auth.signedIn`;
    try {
      const [url, conn, signedIn] = await Promise.all([
        ctx.socket.getState(this.urlId),
        ctx.socket.getState(this.connId),
        ctx.socket.getState(this.signedInId),
      ]);
      this.setState({
        url: typeof url?.val === "string" ? url.val : "",
        connected: conn?.val === true,
        signedIn: signedIn?.val === true,
      });
      await ctx.socket.subscribeState(this.urlId, this.onUrl);
      await ctx.socket.subscribeState(this.connId, this.onConn);
      await ctx.socket.subscribeState(this.signedInId, this.onSignedIn);
    } catch {
      // The states may not exist until the adapter first runs — the hint below covers it.
    }
  }

  componentWillUnmount(): void {
    const socket = this.props.oContext?.socket;
    if (socket && this.urlId) {
      socket.unsubscribeState(this.urlId, this.onUrl);
      socket.unsubscribeState(this.connId, this.onConn);
      socket.unsubscribeState(this.signedInId, this.onSignedIn);
    }
    super.componentWillUnmount?.();
  }

  /** Ask the running adapter for a real connection check and show its answer verbatim. */
  private async runTest(): Promise<void> {
    const ctx = this.props.oContext;
    this.setState({ testing: true, testResult: null });
    try {
      const answer = await ctx.socket.sendTo<{ result?: unknown; error?: unknown } | null | undefined>(
        `${ctx.adapterName}.${ctx.instance}`,
        "checkConnection",
        {},
      );
      if (answer && typeof answer.error === "string") {
        this.setState({ testResult: { ok: false, text: answer.error } });
      } else if (answer && typeof answer.result === "string") {
        this.setState({ testResult: { ok: true, text: answer.result } });
      } else {
        this.setState({ testResult: { ok: false, text: "No answer from the adapter." } });
      }
    } catch (e) {
      this.setState({ testResult: { ok: false, text: e instanceof Error ? e.message : String(e) } });
    } finally {
      this.setState({ testing: false });
    }
  }

  private renderStatus(): React.JSX.Element {
    if (this.state.connected) {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "success.main" }}>
          <CheckCircleIcon />
          <Typography>{I18n.t("hc_signedIn")}</Typography>
        </Box>
      );
    }
    if (this.state.signedIn) {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "warning.main" }}>
          <WarningAmberIcon />
          <Typography>{I18n.t("hc_signedInNoStream")}</Typography>
        </Box>
      );
    }
    if (this.state.url) {
      return (
        <Box>
          <Typography sx={{ mb: 1 }}>{I18n.t("hc_signInPrompt")}</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<LoginIcon />}
              href={this.state.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {I18n.t("hc_openSignIn")}
            </Button>
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={() => void navigator.clipboard?.writeText(this.state.url)}
            >
              {I18n.t("hc_copyLink")}
            </Button>
          </Box>
        </Box>
      );
    }
    return <Typography sx={{ opacity: 0.8 }}>{I18n.t("hc_signInWaiting")}</Typography>;
  }

  private renderTest(): React.JSX.Element {
    const alive = this.props.alive === true;
    return (
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            variant="outlined"
            startIcon={<NetworkCheckIcon />}
            disabled={!alive || this.state.testing}
            onClick={() => void this.runTest()}
            data-testid="hc-test-connection"
          >
            {I18n.t(this.state.testing ? "hc_testing" : "hc_testConnection")}
          </Button>
          {!alive ? <Typography sx={{ opacity: 0.8 }}>{I18n.t("hc_notRunning")}</Typography> : null}
        </Box>
        {this.state.testResult ? (
          <Typography
            sx={{ mt: 1, color: this.state.testResult.ok ? "success.main" : "error.main" }}
            data-testid="hc-test-result"
          >
            {this.state.testResult.text}
          </Typography>
        ) : null}
      </Box>
    );
  }

  renderItem(): React.JSX.Element {
    // The wrapper always mounts (whatever the sign-in state) — the render-check keys on it.
    return (
      <Box data-testid="hc-signin">
        {this.renderStatus()}
        {this.renderTest()}
      </Box>
    );
  }
}
