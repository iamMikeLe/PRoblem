import { z } from "zod";
import { SeveritySchema } from "./domain.ts";

/**
 * The Activity feed (ADR 0015): what Claude or GitHub did in an open review, newest first. The
 * user's own clicks are not listed, except posting to GitHub, which leaves the app.
 */
export const ActivityDetailSchema = z.discriminatedUnion("kind", [
  /** A tool call waits for the user's approval (one row per wait, not per card). */
  z.object({ kind: z.literal("approval"), toolName: z.string() }),
  /** A turn ended with a result; `added`: findings it reported, `top` the most severe of them. */
  z.object({
    kind: z.literal("finished"),
    added: z.number().int().nonnegative(),
    top: z
      .object({
        number: z.number().int().positive(),
        severity: SeveritySchema,
        title: z.string(),
      })
      .nullable(),
  }),
  /** A turn failed; `message` is its error. */
  z.object({ kind: z.literal("failed"), message: z.string() }),
  /** The branch or pull request has commits the review has not seen. */
  z.object({
    kind: z.literal("commits"),
    newCommits: z.number().int().nonnegative(),
    latestSha: z.string(),
    rewritten: z.boolean(),
  }),
  /** New comments on the pull request; `until` is the newest one's time. */
  z.object({
    kind: z.literal("comments"),
    count: z.number().int().positive(),
    until: z.string(),
  }),
  /** The user posted findings as a GitHub review. */
  z.object({
    kind: z.literal("posted"),
    findings: z.number().int().nonnegative(),
    url: z.string(),
    /** GitHub's time of the post (when it said), so the user's own comments are never news. */
    submittedAt: z.string().nullable(),
  }),
]);
export type ActivityDetail = z.infer<typeof ActivityDetailSchema>;
export type ActivityKind = ActivityDetail["kind"];

export const ActivityItemSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  reviewTitle: z.string(),
  projectName: z.string(),
  at: z.iso.datetime(),
  read: z.boolean(),
  detail: ActivityDetailSchema,
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/** How many rows the feed keeps; older ones are deleted. */
export const ACTIVITY_MAX = 500;

export const MarkActivityReadRequestSchema = z.strictObject({
  /** The rows to mark; omitted = all of them. */
  ids: z.array(z.string().min(1).max(64)).max(ACTIVITY_MAX).optional(),
});
export type MarkActivityReadRequest = z.infer<typeof MarkActivityReadRequestSchema>;
