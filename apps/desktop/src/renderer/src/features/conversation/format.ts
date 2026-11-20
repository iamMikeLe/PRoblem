import type { ConversationEntry } from "@problem/shared";

type TurnEnd = Extract<ConversationEntry, { kind: "turn-end" }>;

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** A token count for people: "850", "12.4K", "1.2M". */
export function formatTokens(tokens: number): string {
  return compact.format(tokens);
}

/**
 * The divider line under a finished turn, e.g.
 * "Done · 42 s · $0.18 · 120K tokens · 667K tokens/$".
 */
export function describeTurnEnd(end: TurnEnd): string {
  const head =
    end.outcome === "success" ? "Done" : end.outcome === "interrupted" ? "Stopped" : "Failed";
  const parts = [head];
  if (end.durationMs !== null) parts.push(formatDuration(end.durationMs));
  if (end.costUsd !== null) parts.push(`$${end.costUsd.toFixed(2)}`);
  if (end.tokens !== null && end.tokens > 0) {
    parts.push(`${formatTokens(end.tokens)} tokens`);
    if (end.costUsd !== null && end.costUsd > 0) {
      parts.push(`${formatTokens(end.tokens / end.costUsd)} tokens/$`);
    }
  }
  return parts.join(" · ");
}

type Approval = Extract<ConversationEntry, { kind: "approval" }>;

const DECISION_LABEL: Record<Approval["decision"], string> = {
  "allow-once": "You allowed once",
  "allow-review": "You allowed for this review",
  "allow-all-commands": "You allowed all commands for this review",
  deny: "You denied",
  // The turn was stopped, or Claude Code withdrew the request (e.g. a newer one replaced it).
  expired: "Withdrawn before you answered",
};

/** The line an answered approval card leaves in the transcript. */
export function describeApproval(approval: Approval): string {
  const line = `${DECISION_LABEL[approval.decision]}: ${approval.summary}`;
  return approval.message ? `${line} — “${approval.message}”` : line;
}
