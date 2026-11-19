import type { DatabaseSync } from "node:sqlite";

/**
 * "Allow for this review" (ADR 0012): the exact Bash command or path the user allowed for one
 * tool, so a changed command asks again. The one broader grant is `ALL_COMMANDS` (ADR 0016).
 */
export interface Grant {
  tool: string;
  scope: string;
}

/**
 * "Allow all commands": every Bash command of the review. Its scope is empty because no command
 * can be: the gate refuses an empty command before it could ask for (or match) an exact grant.
 */
export const ALL_COMMANDS: Grant = { tool: "Bash", scope: "" };

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

/** Removes the review's exact grants for `tool`; "Allow all commands" stays. */
export function removeExactGrants(db: DatabaseSync, reviewId: string, tool: string): void {
  db.prepare("DELETE FROM review_grants WHERE review_id = ? AND tool = ? AND scope <> ''").run(
    reviewId,
    tool,
  );
}
