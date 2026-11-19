import {
  Button,
  Caption1,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Text,
  Textarea,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { ShieldQuestionRegular, WarningRegular } from "@fluentui/react-icons";
import type { ApprovalDecision, PendingApproval } from "@problem/shared";
import { useId, useState } from "react";
import { useDecideApproval } from "./queries.ts";
import { toolDisplayName } from "./ToolCallCard.tsx";

const useStyles = makeStyles({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  icon: { color: tokens.colorBrandForeground1, fontSize: "20px", flexShrink: 0 },
  reason: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorPaletteYellowForeground1,
  },
  command: {
    margin: 0,
    padding: tokens.spacingHorizontalS,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: "240px",
    overflowY: "auto",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  details: { color: tokens.colorNeutralForeground3 },
  escaped: {
    color: tokens.colorPaletteYellowForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
});

/**
 * A tool call waiting for the user (ADR 0012). Claude Code waits until it is answered. There is
 * no keyboard shortcut that approves, and focus is never moved onto an approve button.
 */
export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const styles = useStyles();
  const decide = useDecideApproval();
  const [denying, setDenying] = useState(false);
  const [message, setMessage] = useState("");
  const headingId = useId();
  const name = toolDisplayName(approval.toolName);

  const answer = (decision: ApprovalDecision) =>
    decide.mutate({
      reviewId: approval.reviewId,
      id: approval.id,
      decision,
      ...(decision === "deny" && message.trim() !== "" ? { message: message.trim() } : {}),
    });

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.header}>
        <ShieldQuestionRegular className={styles.icon} aria-hidden />
        <Text weight="semibold" id={headingId}>
          Claude wants to use {name}
        </Text>
      </div>
      <Caption1 className={styles.reason}>
        <WarningRegular aria-hidden /> {approval.reason}
      </Caption1>
      <pre className={styles.command}>
        <Visible text={approval.summary} className={styles.escaped} />
      </pre>
      {approval.detail !== "{}" && (
        <details className={styles.details}>
          <summary>
            <Caption1>Full request</Caption1>
          </summary>
          <pre className={styles.command}>
            <Visible text={approval.detail} className={styles.escaped} />
          </pre>
        </details>
      )}
      {decide.error && (
        <MessageBar intent="error">
          <MessageBarBody>{decide.error.message}</MessageBarBody>
        </MessageBar>
      )}
      {denying ? (
        <>
          <Field label="Tell Claude why (optional)">
            <Textarea
              value={message}
              onChange={(_, data) => setMessage(data.value)}
              resize="vertical"
              maxLength={2000}
            />
          </Field>
          <div className={styles.actions}>
            <Button appearance="primary" disabled={decide.isPending} onClick={() => answer("deny")}>
              Deny
            </Button>
            <Button onClick={() => setDenying(false)}>Back</Button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <Button disabled={decide.isPending} onClick={() => answer("allow-once")}>
            Allow once
          </Button>
          {approval.canAllowForReview && (
            <Button disabled={decide.isPending} onClick={() => answer("allow-review")}>
              Allow for this review
            </Button>
          )}
          {approval.canAllowAllCommands && (
            <Tooltip
              relationship="description"
              content="Every command of this review runs without asking, still in its sandbox: no network, and writes only inside the review's folder."
            >
              <Button disabled={decide.isPending} onClick={() => answer("allow-all-commands")}>
                Allow all commands
              </Button>
            </Tooltip>
          )}
          <Button disabled={decide.isPending} onClick={() => setDenying(true)}>
            Deny…
          </Button>
        </div>
      )}
    </section>
  );
}

/** Anything but printable ASCII, line breaks and tabs: control, bidi and lookalike characters. */
const HIDDEN = /[^\x20-\x7E\n\t]/gu;

/**
 * Splits text into plain parts and escaped characters (`\u{202E}`), so that what the user approves
 * reads exactly as what runs: nothing can reorder, hide or impersonate characters.
 */
export function visibleParts(text: string): { text: string; escaped: boolean }[] {
  const parts: { text: string; escaped: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(HIDDEN)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), escaped: false });
    const code = match[0].codePointAt(0) ?? 0;
    parts.push({ text: `\\u{${code.toString(16).toUpperCase()}}`, escaped: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), escaped: false });
  return parts;
}

function Visible({ text, className }: { text: string; className: string }) {
  return (
    <>
      {visibleParts(text).map((part, index) =>
        part.escaped ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <mark key={index} className={className}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
