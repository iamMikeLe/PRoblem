import { z } from "zod";

/**
 * A review's pull request on its git host: its existing discussion, and posting findings to it
 * (ADR 0014, 0019). Everything here comes from the host and is written by other people: it is
 * shown as content and given to Claude as untrusted text.
 */

export const HostKindSchema = z.enum(["github", "bitbucket"]);
export type HostKind = z.infer<typeof HostKindSchema>;

/** The host's name for people. */
export const HOST_LABELS: Record<HostKind, string> = { github: "GitHub", bitbucket: "Bitbucket" };

export const PullRequestLinkSchema = z.object({
  /** Links saved before Bitbucket support are GitHub's. */
  host: HostKindSchema.default("github"),
  /** `owner/repo`, lowercase. */
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.url(),
});
export type PullRequestLink = z.infer<typeof PullRequestLinkSchema>;

export const PrCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  url: z.string(),
});
export type PrComment = z.infer<typeof PrCommentSchema>;

export const PrThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  /** Line in the current head; `null` when the thread is outdated. */
  line: z.number().int().positive().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: z.array(PrCommentSchema),
});
export type PrThread = z.infer<typeof PrThreadSchema>;

export const PrReviewStateSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
  "PENDING",
]);

export const PrReviewSchema = z.object({
  id: z.string(),
  author: z.string(),
  state: PrReviewStateSchema,
  body: z.string(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  url: z.string(),
});
export type PrReview = z.infer<typeof PrReviewSchema>;

export const PrConversationSchema = z.discriminatedUnion("status", [
  /** The review has no pull request (a branch without an open PR, or no GitHub remote). */
  z.object({ status: z.literal("none"), reason: z.string() }),
  z.object({
    status: z.literal("ok"),
    pullRequest: PullRequestLinkSchema.extend({ title: z.string(), headSha: z.string() }),
    threads: z.array(PrThreadSchema),
    comments: z.array(PrCommentSchema),
    reviews: z.array(PrReviewSchema),
    /** GitHub has more than the app reads (very long discussions). */
    truncated: z.boolean(),
  }),
]);
export type PrConversation = z.infer<typeof PrConversationSchema>;

export const ReviewEventSchema = z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

/** One finding as it would be posted. */
export const PostItemSchema = z.object({
  number: z.number().int().positive(),
  /** On its line in the diff, or listed in the review's summary. */
  placement: z.enum(["inline", "summary"]),
  /** Why it goes into the summary, e.g. "line 120 is not part of the diff". */
  reason: z.string().nullable(),
  /** The markdown Claude's finding becomes, mentions neutralized; the user may edit it (ADR 0017). */
  text: z.string(),
  /** Pre-selected in the preview (accepted findings). */
  selected: z.boolean(),
  /** Already posted to GitHub (the link of that review). */
  postedUrl: z.string().nullable(),
});
export type PostItem = z.infer<typeof PostItemSchema>;

export const PostPreviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none"), reason: z.string() }),
  z.object({
    status: z.literal("ok"),
    pullRequest: PullRequestLinkSchema,
    /** The pull request's head is the review's head; posting is refused otherwise. */
    upToDate: z.boolean(),
    items: z.array(PostItemSchema),
  }),
]);
export type PostPreview = z.infer<typeof PostPreviewSchema>;

/** The user's summary; the whole posted body (with findings) must stay under GitHub's 65,536. */
export const REVIEW_BODY_MAX = 60_000;
export const GITHUB_BODY_MAX = 65_000;

/** GitHub's limit for one comment's body. */
export const COMMENT_TEXT_MAX = 65_536;
export const POST_FINDINGS_MAX = 200;
/** All findings' texts together, so one request stays a reasonable size. */
export const POST_TEXT_TOTAL_MAX = 1_000_000;

/**
 * One finding to post, with its final text (ADR 0017). The text is posted exactly as sent: never
 * trimmed, so what the user saw is what GitHub gets.
 */
export const PostFindingSchema = z.strictObject({
  number: z.number().int().positive(),
  text: z
    .string()
    .max(COMMENT_TEXT_MAX, "A finding's text is longer than GitHub allows (65,536 characters).")
    .refine((text) => text.trim() !== "", "A finding's text cannot be empty."),
});
export type PostFinding = z.infer<typeof PostFindingSchema>;

export const PostReviewRequestSchema = z
  .strictObject({
    id: z.string().min(1),
    event: ReviewEventSchema,
    body: z.string().max(REVIEW_BODY_MAX),
    /** Each selected finding with the exact text the user saw (and maybe edited) in the dialog. */
    findings: z
      .array(PostFindingSchema)
      .max(POST_FINDINGS_MAX)
      .refine(
        (findings) => new Set(findings.map((f) => f.number)).size === findings.length,
        "A finding is listed twice.",
      )
      .refine(
        (findings) => findings.reduce((sum, f) => sum + f.text.length, 0) <= POST_TEXT_TOTAL_MAX,
        "The findings' texts are too long to post together. Post fewer findings at a time.",
      ),
  })
  .refine((value) => value.event !== "REQUEST_CHANGES" || value.body.trim() !== "", {
    message: "Requesting changes needs a summary.",
    path: ["body"],
  })
  .refine(
    (value) => value.event !== "COMMENT" || value.body.trim() !== "" || value.findings.length > 0,
    {
      message: "Write a summary or select findings to post.",
      path: ["body"],
    },
  );
export type PostReviewRequest = z.infer<typeof PostReviewRequestSchema>;

export const PostReviewResultSchema = z.object({ url: z.string() });
export type PostReviewResult = z.infer<typeof PostReviewResultSchema>;

/**
 * Text written by Claude (which read the pull request) or by other people must not notify anyone
 * when posted: every `@` before a name gets a zero-width space, so GitHub shows it but links no
 * one. GitHub finds mentions after rendering markdown (`_@x_`, `` `a`@x ``), so no context is safe
 * to skip; e-mail addresses look the same afterwards.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/g, "@\u200B");
}
