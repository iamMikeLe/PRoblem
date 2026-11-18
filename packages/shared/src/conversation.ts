import { z } from "zod";

/**
 * The conversation of a review, as the app stores and shows it. The main process turns Claude Agent
 * SDK messages into these entries (`claude/normalize.ts`), so the UI never depends on SDK shapes.
 */

/** Long tool inputs and outputs are cut to this many characters before they are stored. */
export const TOOL_TEXT_MAX = 20_000;

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
