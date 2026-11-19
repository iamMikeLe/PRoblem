import { z } from "zod";
import { PendingApprovalSchema, StoredEntrySchema } from "./conversation.ts";
import { FindingSchema, ReviewStatusSchema } from "./domain.ts";

/**
 * Events the main process pushes to the renderer on `EVENT_CHANNEL`.
 * The renderer receives events for all reviews, so switching reviews never waits for data.
 */
export const AppEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("review.status"),
    reviewId: z.string(),
    status: ReviewStatusSchema,
  }),
  /** A conversation entry was stored. */
  z.object({ type: z.literal("review.entry"), entry: StoredEntrySchema }),
  /**
   * Text Claude is writing right now, for display only (never stored). Each delta extends the live
   * text of the review; the next `assistant` entry or the end of the turn replaces it.
   */
  z.object({ type: z.literal("review.delta"), reviewId: z.string(), text: z.string() }),
  /** Claude Code started a session for the review (first turn). */
  z.object({ type: z.literal("review.session"), reviewId: z.string(), sessionId: z.string() }),
  /** A tool call waits for the user's approval. */
  z.object({ type: z.literal("review.approval"), approval: PendingApprovalSchema }),
  /** An approval card was answered or expired. */
  z.object({ type: z.literal("review.approvalDone"), reviewId: z.string(), id: z.string() }),
  /** The user clicked a notification about a review: show it. */
  z.object({ type: z.literal("app.showReview"), reviewId: z.string() }),
  /** The Activity feed changed (a row was added or marked read): load it again. */
  z.object({ type: z.literal("activity.changed") }),
  z.object({
    type: z.literal("review.findings"),
    reviewId: z.string(),
    findings: z.array(FindingSchema),
  }),
]);
export type AppEvent = z.infer<typeof AppEventSchema>;

export function parseAppEvent(value: unknown): AppEvent | undefined {
  const result = AppEventSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
