import type { DatabaseSync } from "node:sqlite";

/**
 * "Allow for this review" (ADR 0012): the exact Bash command or path the user allowed for one
 * tool. Nothing broader is ever stored, so a changed command asks again.
 */
export interface Grant {
  tool: string;
  scope: string;
}

export function hasGrant(db: DatabaseSync, reviewId: string, grant: Grant): boolean {
  return (
    db
      .prepare("SELECT 1 AS hit FROM review_grants WHERE review_id = ? AND tool = ? AND scope = ?")
      .get(reviewId, grant.tool, grant.scope) !== undefined
  );
}

export function addGrant(db: DatabaseSync, reviewId: string, grant: Grant, now: Date): void {
  db.prepare(
    `INSERT INTO review_grants (review_id, tool, scope, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(reviewId, grant.tool, grant.scope, now.toISOString());
}

export function removeGrants(db: DatabaseSync, reviewId: string, tool: string): void {
  db.prepare("DELETE FROM review_grants WHERE review_id = ? AND tool = ?").run(reviewId, tool);
}
