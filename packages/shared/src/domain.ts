import { z } from "zod";
import { ChangeFiltersSchema } from "./changes.ts";
import { SecurityCategorySchema } from "./security.ts";

/**
 * Domain model shared by server and web. Zod schemas are the single source of truth:
 * TypeScript types are inferred from them, and the server validates every boundary with them.
 */

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Absolute path to a git repository on this machine. */
  path: z.string().min(1),
  reviewPrompt: z.string(),
  /** What the Changes view hides for this project's reviews. */
  changeFilters: ChangeFiltersSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Lifecycle of a review session, shown as the status dot in the list pane. */
export const ReviewStatusSchema = z.enum(["queued", "running", "needs-input", "idle", "failed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** What a review looks at: a branch of the project, or a GitHub pull request. */
export const ReviewSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), branch: z.string().min(1) }),
  z.object({
    kind: z.literal("pull-request"),
    url: z.url(),
    number: z.number().int().positive(),
    /** `owner/repo`, lowercase. */
    repo: z.string().min(1),
  }),
]);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

const ShaSchema = z.string().regex(/^[0-9a-f]{40,64}$/);

export const ReviewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** PR title, or the branch name. */
  title: z.string(),
  source: ReviewSourceSchema,
  /** Branch under review (the PR's head branch for a pull request). */
  headBranch: z.string(),
  headSha: ShaSchema,
  /** Branch the changes are compared with. */
  baseBranch: z.string(),
  baseSha: ShaSchema,
  /** Newest commit shared by head and base; `null` for unrelated histories. */
  mergeBaseSha: ShaSchema.nullable(),
  /** Folder Claude works in: an isolated worktree, or the project checkout (in-place). */
  workdir: z.string(),
  isolated: z.boolean(),
  /** The review prompt for this review, copied from the project and possibly edited. */
  prompt: z.string(),
  status: ReviewStatusSchema,
  /** Claude Code session of this review; `null` until the first turn has started. */
  sessionId: z.string().nullable(),
  /** Model chosen for this review; `null` = Claude Code's default. */
  model: z.string().nullable(),
  /** Fix mode: Claude may edit files inside `workdir` without asking (ADR 0012). Off by default. */
  fixMode: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const SeveritySchema = z.enum(["blocker", "major", "minor", "nit"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** The user's decision on a finding. */
export const VerdictSchema = z.enum(["open", "accepted", "dismissed"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * A finding keeps its `number` for the life of the review. Claude reports findings through the
 * `report_findings` MCP tool; the main process owns numbering, so a number never changes meaning
 * (ADR 0004).
 */
export const FindingSchema = z.object({
  reviewId: z.string(),
  number: z.number().int().positive(),
  severity: SeveritySchema,
  /** Set for a security finding (shown in the Security tab); `null` for any other finding. */
  securityCategory: SecurityCategorySchema.nullable(),
  title: z.string().min(1),
  /** Path relative to the review's folder; `null` for a finding about the change as a whole. */
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  /** Markdown. */
  problem: z.string(),
  /** Markdown. */
  suggestion: z.string(),
  /** Markdown steps to reproduce (in the UI, on the command line, ...); empty when not applicable. */
  reproduction: z.string(),
  verdict: VerdictSchema,
  /** Claude changed the finding after the user gave a verdict, so it may need another look. */
  changedSinceVerdict: z.boolean(),
  /** Set when Claude withdrew the finding (for example after new commits), with its reason. */
  withdrawnReason: z.string().nullable(),
  /** The GitHub review it was posted in (ADR 0014); `null` until posted. */
  postedUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** Counts for the list pane: findings still open (not withdrawn), and open blockers. */
export const FindingCountsSchema = z.object({
  open: z.number().int().nonnegative(),
  blockers: z.number().int().nonnegative(),
});
export type FindingCounts = z.infer<typeof FindingCountsSchema>;
