import type { DatabaseSync } from "node:sqlite";
import { type ConversationEntry, ConversationEntrySchema, type StoredEntry } from "@problem/shared";
import { z } from "zod";

const RowSchema = z.object({
  review_id: z.string(),
  seq: z.number(),
  at: z.string(),
  payload: z.string(),
});

function toStored(raw: unknown): StoredEntry {
  const row = RowSchema.parse(raw);
  return {
    reviewId: row.review_id,
    seq: row.seq,
    at: row.at,
    entry: ConversationEntrySchema.parse(JSON.parse(row.payload)),
  };
}

/** Appends an entry to a review's conversation with the next sequence number. */
export function appendEntry(
  db: DatabaseSync,
  reviewId: string,
  entry: ConversationEntry,
  now = new Date(),
): StoredEntry {
  const at = now.toISOString();
  // node:sqlite is synchronous, so reading the max and inserting cannot interleave with another append.
  const row = db
    .prepare(
      `INSERT INTO review_entries (review_id, seq, at, kind, payload)
       SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM review_entries WHERE review_id = ?
       RETURNING seq`,
    )
    .get(reviewId, at, entry.kind, JSON.stringify(entry), reviewId);
  const seq = z.object({ seq: z.number() }).parse(row).seq;
  return { reviewId, seq, at, entry };
}

/** The conversation of a review, oldest first. */
export function listEntries(db: DatabaseSync, reviewId: string): StoredEntry[] {
  return db
    .prepare(
      "SELECT review_id, seq, at, payload FROM review_entries WHERE review_id = ? ORDER BY seq",
    )
    .all(reviewId)
    .map(toStored);
}
