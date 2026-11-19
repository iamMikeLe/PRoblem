import {
  Button,
  Caption1,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { api } from "../lib/api.ts";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    minWidth: 0,
    overflow: "auto",
  },
  window: { height: "100%", justifyContent: "center", maxWidth: "720px", marginInline: "auto" },
  details: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
});

/** Sends a crash to the main process log; never throws (the window is already in trouble). */
export function reportError(error: unknown, componentStack: string | null = null): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  api.app
    .reportError({
      message: message.slice(0, 2_000),
      stack: stack?.slice(0, 20_000) ?? null,
      componentStack: componentStack?.slice(0, 20_000) ?? null,
    })
    .catch(() => {
      // Nowhere left to report it.
    });
}

function Fallback({
  error,
  what,
  whole,
  className,
  onRetry,
}: {
  error: Error;
  what: string;
  whole: boolean;
  className: string | undefined;
  onRetry: () => void;
}) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, whole && styles.window, className)} role="alert">
      <MessageBar intent="error" layout="multiline">
        <MessageBarBody>
          <MessageBarTitle>{what} stopped working.</MessageBarTitle>
          Your reviews are safe: Claude keeps running and everything is saved. The error was written
          to the app's log.
        </MessageBarBody>
        <MessageBarActions>
          <Button size="small" onClick={onRetry}>
            Try again
          </Button>
          <Button size="small" onClick={() => window.location.reload()}>
            Reload window
          </Button>
        </MessageBarActions>
      </MessageBar>
      <Caption1 className={styles.details}>{error.message}</Caption1>
    </div>
  );
}

interface Props {
  /** What failed, for the message ("This tab", "PRoblem"). */
  what: string;
  /** The whole window: the fallback is centered in it. */
  whole?: boolean;
  /** For the fallback, e.g. the grid area the failed part occupied. */
  className?: string | undefined;
  /** After an error, a new value (another review, project...) starts over. */
  resetKey?: string | undefined;
  children: ReactNode;
}

interface State {
  error: Error | undefined;
}

/**
 * Catches a render error below it, so one broken part does not blank the window. After an
 * error it starts over when `resetKey` changes (navigating elsewhere) or on "Try again".
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(error, info.componentStack ?? null);
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Fallback
        error={error}
        what={this.props.what}
        whole={this.props.whole === true}
        className={this.props.className}
        onRetry={() => this.setState({ error: undefined })}
      />
    );
  }
}
