import { join } from "node:path";

/**
 * Where PRoblem keeps its data: `PROBLEM_HOME`, or `~/.problem` (database, worktrees).
 * The same folder is used in development and in the packaged app.
 */
export function dataDir(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env.PROBLEM_HOME?.trim();
  return configured ? configured : join(home, ".problem");
}

export const DATABASE_NAME = "problem.db";
