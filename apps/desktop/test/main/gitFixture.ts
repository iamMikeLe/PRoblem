import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../../src/main/git/repo.ts";

/** Runs git synchronously in `cwd` with an isolated identity, for test setup only. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, env: gitEnv(), encoding: "utf8" },
  ).trim();
}

/** A temporary directory (real path, so macOS /var → /private/var does not break comparisons). */
export async function makeTempDir(prefix = "reviewroom-"): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Initializes a repository with one commit in `dir`. */
export function initRepo(dir: string): void {
  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "commit", "--quiet", "--allow-empty", "-m", "init");
}
