import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ACTIVITY_MAX,
  type ActivityDetail,
  ActivityDetailSchema,
  type ActivityItem,
  ActivityItemSchema,
  type ActivityKind,
} from "@problem/shared";
import { z } from "zod";

/** Storage of the Activity feed (`activity` table, ADR 0015). */

const RowSchema = z.object({
  id: z.string(),
  review_id: z.string(),
  review_title: z.string(),
  project_name: z.string(),
  at: z.string(),
  read_at: z.string().nullable(),
  detail: z.string(),
});

/** A stored detail, or `undefined` when it no longer parses (written by another version). */
function parseDetail(json: string): ActivityDetail | undefined {
  try {
    const parsed = ActivityDetailSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function insertActivity(
  db: DatabaseSync,
  reviewId: string,
  detail: ActivityDetail,
  now: Date,
  max = ACTIVITY_MAX,
): void {
  db.prepare(
    "INSERT INTO activity (id, review_id, kind, detail, at, read_at) VALUES (?, ?, ?, ?, ?, NULL)",
  ).run(randomUUID(), reviewId, detail.kind, JSON.stringify(detail), now.toISOString());
  // Keep the newest rows only.
  db.prepare(
    "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY at DESC, rowid DESC LIMIT ?)",
  ).run(max);
}

/** Rows of open reviews, newest first. */
export function listActivity(db: DatabaseSync): ActivityItem[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.review_id, r.title AS review_title, p.name AS project_name, a.at, a.read_at,
              a.detail
         FROM activity a
         JOIN reviews r ON r.id = a.review_id
         JOIN projects p ON p.id = r.project_id
        WHERE r.closed_at IS NULL
        ORDER BY a.at DESC, a.rowid DESC`,
    )
    .all();
  return rows.flatMap((raw) => {
    const row = RowSchema.parse(raw);
    const detail = parseDetail(row.detail);
    if (!detail) return [];
    return [
      ActivityItemSchema.parse({
        id: row.id,
        reviewId: row.review_id,
        reviewTitle: row.review_title,
        projectName: row.project_name,
        at: row.at,
        read: row.read_at !== null,
        detail,
      }),
    ];
  });
}

/** Marks rows as read (all unread rows when `ids` is omitted); returns how many changed. */
export function markActivityRead(
  db: DatabaseSync,
  ids: readonly string[] | undefined,
  now: Date,
): number {
  const at = now.toISOString();
  if (ids === undefined) {
    return Number(
      db.prepare("UPDATE activity SET read_at = ? WHERE read_at IS NULL").run(at).changes,
    );
  }
  const mark = db.prepare("UPDATE activity SET read_at = ? WHERE id = ? AND read_at IS NULL");
  let changed = 0;
  for (const id of ids) changed += Number(mark.run(at, id).changes);
  return changed;
}

/** Marks a review's unread rows of one kind as read (e.g. its approvals, once answered). */
export function markKindRead(
  db: DatabaseSync,
  reviewId: string,
  kind: ActivityKind,
  now: Date,
): number {
  return Number(
    db
      .prepare(
        "UPDATE activity SET read_at = ? WHERE review_id = ? AND kind = ? AND read_at IS NULL",
      )
      .run(now.toISOString(), reviewId, kind).changes,
  );
}

/** The newest row of a kind for a review, with its time, e.g. to avoid listing the same commits twice. */
export function lastActivity<K extends ActivityKind>(
  db: DatabaseSync,
  reviewId: string,
  kind: K,
): { detail: Extract<ActivityDetail, { kind: K }>; at: string } | undefined {
  const row = z
    .object({ detail: z.string(), at: z.string() })
    .optional()
    .parse(
      db
        .prepare(
          "SELECT detail, at FROM activity WHERE review_id = ? AND kind = ? ORDER BY at DESC, rowid DESC LIMIT 1",
        )
        .get(reviewId, kind),
    );
  const detail = row ? parseDetail(row.detail) : undefined;
  return row && detail && isKind(detail, kind) ? { detail, at: row.at } : undefined;
}

function isKind<K extends ActivityKind>(
  detail: ActivityDetail,
  kind: K,
): detail is Extract<ActivityDetail, { kind: K }> {
  return detail.kind === kind;
}
