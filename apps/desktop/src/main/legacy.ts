import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Logger } from "./errors.ts";

/**
 * The app was called ReviewRoom before it became PRoblem. On the first start after the rename,
 * the old data folder (`~/.reviewroom`, database `reviewroom.db`) moves to the new place, and
 * reviews and their git worktrees are pointed at it. Nothing happens when the new folder already
 * exists, so this runs once.
 */
const LEGACY_DIR = ".reviewroom";
const LEGACY_DB = "reviewroom.db";

/** Moves a folder if it exists and the target does not; returns whether it moved. */
export function moveFolder(from: string, to: string): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  renameSync(from, to);
  return true;
}

/**
 * Moves `~/.reviewroom` to the new data folder (default location only; a `PROBLEM_HOME` the user
 * chose is left alone). Returns the old folder when it moved.
 */
export function migrateLegacyDataDir(
  env: NodeJS.ProcessEnv,
  home: string,
  to: string,
  databaseName: string,
): string | undefined {
  if (env.PROBLEM_HOME?.trim()) return undefined;
  const from = join(home, LEGACY_DIR);
  if (!moveFolder(from, to)) return undefined;
  // SQLite's write-ahead log and shared memory files belong to the database: move them with it.
  for (const suffix of ["", "-wal", "-shm"]) {
    moveFolder(join(to, `${LEGACY_DB}${suffix}`), join(to, `${databaseName}${suffix}`));
  }
  return from;
}

/**
 * After the move: rewrites the reviews' folders under `from` to `to`, and repairs the git
 * worktree links of open isolated reviews (git records the old absolute path).
 */
export async function relocateReviews(
  db: DatabaseSync,
  from: string,
  to: string,
  repair: (projectRoot: string, workdir: string) => Promise<void>,
  log: Logger,
): Promise<void> {
  const rows = z
    .array(
      z.object({
        id: z.string(),
        workdir: z.string(),
        isolated: z.number(),
        closed_at: z.string().nullable(),
        root: z.string(),
      }),
    )
    .parse(
      db
        .prepare(
          `SELECT r.id, r.workdir, r.isolated, r.closed_at, p.path AS root
           FROM reviews r JOIN projects p ON p.id = r.project_id`,
        )
        .all(),
    );
  const update = db.prepare("UPDATE reviews SET workdir = ? WHERE id = ?");
  for (const row of rows) {
    if (row.workdir !== from && !row.workdir.startsWith(`${from}/`)) continue;
    const workdir = `${to}${row.workdir.slice(from.length)}`;
    update.run(workdir, row.id);
    if (row.isolated === 1 && row.closed_at === null) {
      try {
        await repair(row.root, workdir);
      } catch (error) {
        log.error("could not repair a moved worktree", { review: row.id, error });
      }
    }
  }
}
