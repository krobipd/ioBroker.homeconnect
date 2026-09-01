import React from "react";

import { Box, Button, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LoginIcon from "@mui/icons-material/Login";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";
import { I18n } from "@iobroker/gui-components";

interface SignInState extends ConfigGenericState {
  /** The live verification URL (empty when none / already signed in). */
  url: string;
  /** Whether the adapter reports a live Home Connect connection. */
  connected: boolean;
}

/**
 * Live sign-in panel (jsonConfig `type: custom`). Reads the adapter's
 * `auth.verificationUrl` + `info.connection` states over the admin socket and
 * shows either "signed in", the one-time sign-in link (open + copy), or a hint
 * to save the credentials first — updating live as the device flow progresses.
 */
export default class SignIn extends ConfigGeneric<ConfigGenericProps, SignInState> {
  private urlId = "";
  private connId = "";

  constructor(props: ConfigGenericProps) {
    super(props);
    this.state = { ...this.state, url: "", connected: false };
  }

  private readonly onUrl = (_id: string, state: ioBroker.State | null | undefined): void => {
    this.setState({ url: typeof state?.val === "string" ? state.val : "" });
  };

  private readonly onConn = (_id: string, state: ioBroker.State | null | undefined): void => {
    this.setState({ connected: state?.val === true });
  };

  async componentDidMount(): Promise<void> {
    void super.componentDidMount?.();
    const ctx = this.props.oContext;
    const ns = `${ctx.adapterName}.${ctx.instance}`;
    this.urlId = `${ns}.auth.verificationUrl`;
    this.connId = `${ns}.info.connection`;
    try {
      const [url, conn] = await Promise.all([ctx.socket.getState(this.urlId), ctx.socket.getState(this.connId)]);
      this.setState({
        url: typeof url?.val === "string" ? url.val : "",
        connected: conn?.val === true,
      });
      await ctx.socket.subscribeState(this.urlId, this.onUrl);
      await ctx.socket.subscribeState(this.connId, this.onConn);
    } catch {
      // The states may not exist until the adapter first runs — the hint below covers it.
    }
  }

  componentWillUnmount(): void {
    const socket = this.props.oContext?.socket;
    if (socket && this.urlId) {
      socket.unsubscribeState(this.urlId, this.onUrl);
      socket.unsubscribeState(this.connId, this.onConn);
    }
    super.componentWillUnmount?.();
  }

  private renderContent(): React.JSX.Element {
    if (this.state.connected) {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "success.main" }}>
          <CheckCircleIcon />
          <Typography>{I18n.t("hc_signedIn")}</Typography>
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

  renderItem(): React.JSX.Element {
    // The wrapper always mounts (whatever the sign-in state) — the render-check keys on it.
    return <Box data-testid="hc-signin">{this.renderContent()}</Box>;
  }
}
