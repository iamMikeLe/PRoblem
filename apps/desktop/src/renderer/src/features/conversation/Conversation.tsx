import {
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownRegular } from "@fluentui/react-icons";
import type { ConversationEntry, ReviewStatus, StoredEntry } from "@reviewroom/shared";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { describeTurnEnd } from "./format.ts";
import { Markdown } from "./Markdown.tsx";
import { isBusy } from "./store.ts";
import { ToolCallCard } from "./ToolCallCard.tsx";

type ToolResult = Extract<ConversationEntry, { kind: "tool-result" }>;

/** Distance from the bottom (px) within which the view keeps following new output. */
const STICKY_PX = 48;

const useStyles = makeStyles({
  frame: {
    position: "relative",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  scroller: { overflowY: "auto", minHeight: 0 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    maxWidth: "900px",
    minWidth: 0,
    marginInline: "auto",
    boxSizing: "border-box",
    width: "100%",
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
  },
  user: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    maxHeight: "240px",
    overflowY: "auto",
  },
  assistant: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  working: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    color: tokens.colorNeutralForeground3,
  },
  empty: { color: tokens.colorNeutralForeground3, textAlign: "center" },
  jump: {
    position: "absolute",
    bottom: tokens.spacingVerticalM,
    left: "50%",
    transform: "translateX(-50%)",
    boxShadow: tokens.shadow8,
  },
});

interface Props {
  entries: StoredEntry[];
  live: string | undefined;
  status: ReviewStatus;
  /** The stored transcript is still loading (do not show the empty state yet). */
  loading?: boolean;
}

/**
 * The conversation of a review. Follows new output while the view is at the bottom; once the user
 * scrolls up it stays put and offers a "Jump to latest" button instead.
 */
export function Conversation({ entries, live, status, loading = false }: Props) {
  const styles = useStyles();
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const busy = isBusy(status);

  const { results, lastTurnEnd } = useMemo(() => {
    const map = new Map<string, ToolResult>();
    let last = 0;
    for (const { seq, entry } of entries) {
      if (entry.kind === "tool-result") map.set(entry.toolUseId, entry);
      if (entry.kind === "turn-end") last = seq;
    }
    return { results: map, lastTurnEnd: last };
  }, [entries]);

  const toBottom = () => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow whenever new output arrives
  useLayoutEffect(() => {
    if (following) toBottom();
  }, [following, entries.length, live, status]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_PX);
  };

  return (
    <div className={styles.frame}>
      <div ref={scroller} className={styles.scroller} onScroll={onScroll}>
        <div className={styles.column} role="log" aria-label="Conversation">
          {entries.length === 0 && !busy && !loading && (
            <Text className={styles.empty}>No messages yet. Ask Claude something below.</Text>
          )}
          {entries.map(({ seq, entry }) => {
            switch (entry.kind) {
              case "user":
                return (
                  <div key={seq} className={styles.user}>
                    {entry.text}
                  </div>
                );
              case "assistant":
                return (
                  <div key={seq} className={styles.assistant}>
                    <Markdown text={entry.text} />
                  </div>
                );
              case "tool-call":
                return (
                  <ToolCallCard
                    key={seq}
                    call={entry}
                    result={results.get(entry.toolUseId)}
                    // Only calls of the current turn can still get a result.
                    pending={busy && seq > lastTurnEnd}
                  />
                );
              case "tool-result":
                return null;
              case "turn-end":
                return entry.outcome === "error" ? (
                  <MessageBar key={seq} intent="error">
                    <MessageBarBody>
                      {describeTurnEnd(entry)}
                      {entry.message ? `: ${entry.message}` : ""}
                    </MessageBarBody>
                  </MessageBar>
                ) : (
                  <Divider key={seq}>
                    <Caption1 title={entry.message ?? undefined}>{describeTurnEnd(entry)}</Caption1>
                  </Divider>
                );
              default:
                return null;
            }
          })}
          {live?.trim() && (
            <div className={styles.assistant}>
              <Markdown text={live} />
            </div>
          )}
          {busy && (
            <div className={styles.working} role="status">
              <Spinner size="extra-tiny" />
              <Caption1>
                {status === "queued"
                  ? "Waiting for a free slot (other reviews are running)…"
                  : "Claude is working…"}
              </Caption1>
            </div>
          )}
        </div>
      </div>
      {!following && (
        <Button
          className={styles.jump}
          size="small"
          shape="circular"
          icon={<ArrowDownRegular />}
          onClick={() => {
            setFollowing(true);
            toBottom();
          }}
        >
          Jump to latest
        </Button>
      )}
    </div>
  );
}
