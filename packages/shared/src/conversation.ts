import { z } from "zod";

/**
 * The conversation of a review, as the app stores and shows it. The main process turns Claude Agent
 * SDK messages into these entries (`claude/normalize.ts`), so the UI never depends on SDK shapes.
 */

/** Long tool inputs and outputs are cut to this many characters before they are stored. */
export const TOOL_TEXT_MAX = 20_000;

/** What the user can answer on an approval card. */
export const ApprovalDecisionSchema = z.enum(["allow-once", "allow-review", "deny"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** A tool call waiting for the user. Lives in memory only: an app restart ends the turn. */
export const PendingApprovalSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  /** One line, e.g. the command. */
  summary: z.string(),
  /** The full input, pretty-printed and cut to `TOOL_TEXT_MAX`. */
  detail: z.string(),
  /** Why the app asks, e.g. "Reads a file outside the review's folder." */
  reason: z.string(),
  /** Whether "Allow for this review" is offered (exact Bash commands and paths only). */
  canAllowForReview: z.boolean(),
  requestedAt: z.iso.datetime(),
});
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

export const ConversationEntrySchema = z.discriminatedUnion("kind", [
  /** A message the user sent (the first one is the filled-in review prompt). */
  z.object({ kind: z.literal("user"), text: z.string() }),
  /** A complete text block written by Claude (markdown). */
  z.object({ kind: z.literal("assistant"), text: z.string() }),
  /** Claude called a tool. `summary` is one line for the card header. */
  z.object({
    kind: z.literal("tool-call"),
    toolUseId: z.string(),
    name: z.string(),
    summary: z.string(),
    input: z.string(),
  }),
  /** The result of a tool call, matched to it by `toolUseId`. */
  z.object({
    kind: z.literal("tool-result"),
    toolUseId: z.string(),
    isError: z.boolean(),
    output: z.string(),
  }),
  /** The user (or the end of the turn) answered an approval card (ADR 0012). */
  z.object({
    kind: z.literal("approval"),
    toolUseId: z.string(),
    toolName: z.string(),
    summary: z.string(),
    decision: ApprovalDecisionSchema.or(z.literal("expired")),
    /** The user's message to Claude with a denial. */
    message: z.string().nullable(),
  }),
  /** A turn ended. */
  z.object({
    kind: z.literal("turn-end"),
    outcome: z.enum(["success", "error", "interrupted"]),
    costUsd: z.number().nullable(),
    durationMs: z.number().nullable(),
    /** Why the turn failed or stopped, for the user. */
    message: z.string().nullable(),
  }),
]);
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

/** An entry with its position in the review's conversation (`seq` starts at 1, no gaps). */
export const StoredEntrySchema = z.object({
  reviewId: z.string(),
  seq: z.number().int().positive(),
  at: z.iso.datetime(),
  entry: ConversationEntrySchema,
});
export type StoredEntry = z.infer<typeof StoredEntrySchema>;

/** Models and slash commands Claude Code offers, for the composer. */
export const ClaudeCatalogSchema = z.object({
  models: z.array(
    z.object({ value: z.string(), displayName: z.string(), description: z.string() }),
  ),
  commands: z.array(
    z.object({ name: z.string(), description: z.string(), argumentHint: z.string() }),
  ),
});
export type ClaudeCatalog = z.infer<typeof ClaudeCatalogSchema>;
