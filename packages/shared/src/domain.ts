import { z } from "zod";

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Lifecycle of a review session, shown as the status dot in the list pane. */
export const ReviewStatusSchema = z.enum(["queued", "running", "needs-input", "idle", "failed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), branch: z.string().min(1) }),
  z.object({ kind: z.literal("pull-request"), url: z.url(), number: z.number().int().positive() }),
]);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  source: ReviewSourceSchema,
  baseRef: z.string(),
  headSha: z.string(),
  /** Directory Claude works in: an isolated worktree or the project checkout. */
  workdir: z.string(),
  isolated: z.boolean(),
  model: z.string().optional(),
  sessionId: z.string().optional(),
  status: ReviewStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const SeveritySchema = z.enum(["blocker", "major", "minor", "nit"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const VerdictSchema = z.enum(["open", "accepted", "dismissed"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * A finding keeps its `number` for the life of the review. Claude reports findings through the
 * `report_findings` MCP tool; the server owns numbering, so a number never changes meaning.
 */
export const FindingSchema = z.object({
  reviewId: z.string(),
  number: z.number().int().positive(),
  severity: SeveritySchema,
  title: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  problem: z.string(),
  suggestion: z.string(),
  verdict: VerdictSchema,
  /** Set when Claude itself withdraws the finding (e.g. after new commits). */
  withdrawn: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type Finding = z.infer<typeof FindingSchema>;
