import type { DatabaseSync } from "node:sqlite";
import {
  type Finding,
  type FindingCounts,
  FindingSchema,
  type Severity,
  type Verdict,
  VerdictSchema,
} from "@problem/shared";
import { z } from "zod";

/**
 * Storage of findings. Numbers are assigned here (`MAX(number) + 1` per review), never by Claude,
 * so `#N` always means the same finding (ADR 0004).
 */

const RowSchema = z.object({
  review_id: z.string(),
  number: z.number(),
  severity: z.string(),
  title: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  problem: z.string(),
  suggestion: z.string(),
  reproduction: z.string(),
  verdict: z.string(),
  changed_since_verdict: z.number(),
  withdrawn_reason: z.string().nullable(),
  posted_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const COLUMNS = `review_id, number, severity, title, file, line, problem, suggestion, reproduction,
  verdict, changed_since_verdict, withdrawn_reason, posted_url, created_at, updated_at`;

function toFinding(raw: unknown): Finding {
  const row = RowSchema.parse(raw);
  return FindingSchema.parse({
    reviewId: row.review_id,
    number: row.number,
    severity: row.severity,
    title: row.title,
    file: row.file,
    line: row.line,
    problem: row.problem,
    suggestion: row.suggestion,
    reproduction: row.reproduction,
    verdict: row.verdict,
    changedSinceVerdict: row.changed_since_verdict === 1,
    withdrawnReason: row.withdrawn_reason,
    postedUrl: row.posted_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface FindingContent {
  severity: Severity;
  title: string;
  file: string | null;
  line: number | null;
  problem: string;
  suggestion: string;
  reproduction: string;
}

export function countAllFindings(db: DatabaseSync, reviewId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM findings WHERE review_id = ?").get(reviewId);
  return Number(row?.n ?? 0);
}

export function listFindings(db: DatabaseSync, reviewId: string): Finding[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM findings WHERE review_id = ? ORDER BY number`)
    .all(reviewId)
    .map(toFinding);
}

export function getFinding(
  db: DatabaseSync,
  reviewId: string,
  number: number,
): Finding | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM findings WHERE review_id = ? AND number = ?`)
    .get(reviewId, number);
  return row === undefined ? undefined : toFinding(row);
}

/** Inserts a finding with the review's next number and returns that number. */
export function insertFinding(
  db: DatabaseSync,
  reviewId: string,
  content: FindingContent,
  now: Date,
): number {
  const at = now.toISOString();
  // node:sqlite is synchronous, so reading the max and inserting cannot interleave.
  const row = db
    .prepare(
      `INSERT INTO findings (review_id, number, severity, title, file, line, problem, suggestion,
         reproduction, created_at, updated_at)
       SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM findings WHERE review_id = ?
       RETURNING number`,
    )
    .get(
      reviewId,
      content.severity,
      content.title,
      content.file,
      content.line,
      content.problem,
      content.suggestion,
      content.reproduction,
      at,
      at,
      reviewId,
    );
  return z.object({ number: z.number() }).parse(row).number;
}

/**
 * Claude changed a finding. The user's verdict is kept; if there is one, the finding is marked as
 * changed since that verdict so the user can look again.
 */
export function updateFindingContent(
  db: DatabaseSync,
  reviewId: string,
  number: number,
  content: FindingContent,
  now: Date,
): void {
  db.prepare(
    `UPDATE findings SET severity = ?, title = ?, file = ?, line = ?, problem = ?, suggestion = ?,
       reproduction = ?, changed_since_verdict = CASE WHEN verdict = 'open' THEN 0 ELSE 1 END, updated_at = ?
     WHERE review_id = ? AND number = ?`,
  ).run(
    content.severity,
    content.title,
    content.file,
    content.line,
    content.problem,
    content.suggestion,
    content.reproduction,
    now.toISOString(),
    reviewId,
    number,
  );
}

export function withdrawFinding(
  db: DatabaseSync,
  reviewId: string,
  number: number,
  reason: string,
  now: Date,
): void {
  db.prepare(
    "UPDATE findings SET withdrawn_reason = ?, updated_at = ? WHERE review_id = ? AND number = ?",
  ).run(reason, now.toISOString(), reviewId, number);
}

/** The user's verdict; it also clears the "changed since your verdict" mark. */
export function setVerdict(
  db: DatabaseSync,
  reviewId: string,
  number: number,
  verdict: Verdict,
  now: Date,
): Finding | undefined {
  db.prepare(
    `UPDATE findings SET verdict = ?, changed_since_verdict = 0, updated_at = ?
     WHERE review_id = ? AND number = ?`,
  ).run(verdict, now.toISOString(), reviewId, number);
  return getFinding(db, reviewId, number);
}

/** Open findings and open blockers of every open review that has findings. */
export function countFindings(db: DatabaseSync): Record<string, FindingCounts> {
  const rows = db
    .prepare(
      `SELECT f.review_id AS review_id,
         SUM(f.verdict = 'open' AND f.withdrawn_reason IS NULL) AS open,
         SUM(f.verdict = 'open' AND f.withdrawn_reason IS NULL AND f.severity = 'blocker') AS blockers
       FROM findings f JOIN reviews r ON r.id = f.review_id
       WHERE r.closed_at IS NULL
       GROUP BY f.review_id`,
    )
    .all();
  const parsed = z
    .array(z.object({ review_id: z.string(), open: z.number(), blockers: z.number() }))
    .parse(rows);
  return Object.fromEntries(
    parsed.map((row) => [row.review_id, { open: row.open, blockers: row.blockers }]),
  );
}

export interface VerdictChange {
  number: number;
  title: string;
  verdict: Verdict;
}

/** Verdicts the user changed since Claude was last told (see `markVerdictsTold`). */
export function untoldVerdicts(db: DatabaseSync, reviewId: string): VerdictChange[] {
  const rows = db
    .prepare(
      `SELECT number, title, verdict FROM findings
       WHERE review_id = ? AND verdict <> verdict_told ORDER BY number`,
    )
    .all(reviewId);
  return z
    .array(z.object({ number: z.number(), title: z.string(), verdict: VerdictSchema }))
    .parse(rows);
}

export function markVerdictsTold(
  db: DatabaseSync,
  reviewId: string,
  changes: readonly VerdictChange[],
): void {
  // Only what Claude was actually told: a verdict changed again meanwhile stays untold.
  const mark = db.prepare(
    "UPDATE findings SET verdict_told = ? WHERE review_id = ? AND number = ? AND verdict = ?",
  );
  for (const change of changes) mark.run(change.verdict, reviewId, change.number, change.verdict);
}

/** Findings that were posted to GitHub, with the review they went into. */
export function markPosted(
  db: DatabaseSync,
  reviewId: string,
  numbers: readonly number[],
  url: string,
): void {
  const update = db.prepare(
    "UPDATE findings SET posted_url = ? WHERE review_id = ? AND number = ?",
  );
  for (const number of numbers) update.run(url, reviewId, number);
}
