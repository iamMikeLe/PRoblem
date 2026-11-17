import { join } from "node:path";

/**
 * Where ReviewRoom keeps its data: `REVIEWROOM_HOME`, or `~/.reviewroom` (database, worktrees).
 * The same folder is used in development and in the packaged app.
 */
export function dataDir(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env.REVIEWROOM_HOME?.trim();
  return configured ? configured : join(home, ".reviewroom");
}
