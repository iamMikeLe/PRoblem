import type { DatabaseSync } from "node:sqlite";
import { type Review, ReviewSchema } from "@reviewroom/shared";
import { z } from "zod";

/** A review as stored, with the fields only the main process needs. */
export interface ReviewRecord {
  review: Review;
  /** In-place reviews: the branch to switch the project checkout back to on close. */
  restoreBranch: string | null;
  closedAt: string | null;
}

const RowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  source_kind: z.enum(["branch", "pull-request"]),
  pr_url: z.string().nullable(),
  pr_number: z.number().nullable(),
  pr_repo: z.string().nullable(),
  head_branch: z.string(),
  head_sha: z.string(),
  base_branch: z.string(),
  base_sha: z.string(),
  merge_base_sha: z.string().nullable(),
  workdir: z.string(),
  isolated: z.number(),
  prompt: z.string(),
  status: z.string(),
  restore_branch: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
});

function toRecord(raw: unknown): ReviewRecord {
  const row = RowSchema.parse(raw);
  const review = ReviewSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    source:
      row.source_kind === "branch"
        ? { kind: "branch", branch: row.head_branch }
        : { kind: "pull-request", url: row.pr_url, number: row.pr_number, repo: row.pr_repo },
    headBranch: row.head_branch,
    headSha: row.head_sha,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    mergeBaseSha: row.merge_base_sha,
    workdir: row.workdir,
    isolated: row.isolated === 1,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return { review, restoreBranch: row.restore_branch, closedAt: row.closed_at };
}

const COLUMNS = `id, project_id, title, source_kind, pr_url, pr_number, pr_repo, head_branch,
  head_sha, base_branch, base_sha, merge_base_sha, workdir, isolated, prompt, status,
  restore_branch, created_at, updated_at, closed_at`;

/** Open reviews of all projects, newest first. */
export function listOpenReviews(db: DatabaseSync): Review[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM reviews WHERE closed_at IS NULL ORDER BY created_at DESC, id`)
    .all()
    .map((row) => toRecord(row).review);
}

export function getReviewRecord(db: DatabaseSync, id: string): ReviewRecord | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM reviews WHERE id = ?`).get(id);
  return row === undefined ? undefined : toRecord(row);
}

export function findOpenInPlaceReview(db: DatabaseSync, projectId: string): Review | undefined {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM reviews WHERE project_id = ? AND isolated = 0 AND closed_at IS NULL`,
    )
    .get(projectId);
  return row === undefined ? undefined : toRecord(row).review;
}

export function countOpenReviews(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE project_id = ? AND closed_at IS NULL")
    .get(projectId);
  return Number(row?.n ?? 0);
}

/** Inserts a review. Throws SQLite's UNIQUE error if the project already has an in-place review. */
export function insertReview(db: DatabaseSync, review: Review, restoreBranch: string | null): void {
  const pr = review.source.kind === "pull-request" ? review.source : undefined;
  db.prepare(
    `INSERT INTO reviews (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    review.id,
    review.projectId,
    review.title,
    review.source.kind,
    pr?.url ?? null,
    pr?.number ?? null,
    pr?.repo ?? null,
    review.headBranch,
    review.headSha,
    review.baseBranch,
    review.baseSha,
    review.mergeBaseSha,
    review.workdir,
    review.isolated ? 1 : 0,
    review.prompt,
    review.status,
    restoreBranch,
    review.createdAt,
    review.updatedAt,
  );
}

/** Archives a review (the row is kept for history); returns whether an open review was closed. */
export function markReviewClosed(db: DatabaseSync, id: string, now = new Date()): boolean {
  const at = now.toISOString();
  const result = db
    .prepare("UPDATE reviews SET closed_at = ?, updated_at = ? WHERE id = ? AND closed_at IS NULL")
    .run(at, at, id);
  return Number(result.changes) > 0;
}
