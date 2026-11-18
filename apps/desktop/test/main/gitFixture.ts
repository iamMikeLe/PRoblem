import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
export async function makeTempDir(prefix = "problem-"): Promise<{
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

export interface GitHubFixture {
  /** The project checkout, on `main`. */
  repo: string;
  mainSha: string;
  /** Head of `feature` and of pull request #7 on the fake GitHub remote. */
  featureSha: string;
}

/**
 * A project whose `origin` is `https://github.com/acme/payments.git`, rewritten with
 * `url.insteadOf` to a local bare repository. It has `main`, `feature` (one commit ahead), and
 * `refs/pull/7/head` like GitHub publishes for pull request #7. No network involved.
 */
export function makeGitHubFixture(dir: string): GitHubFixture {
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  git(dir, "init", "--quiet", "--bare", origin);
  git(dir, "init", "--quiet", "--initial-branch=main", repo);
  git(repo, "remote", "add", "origin", "https://github.com/acme/payments.git");
  git(repo, "config", `url.${origin}.insteadOf`, "https://github.com/acme/payments.git");
  writeFileSync(join(repo, "a.txt"), "base\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "--quiet", "-m", "base");
  const mainSha = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "--quiet", "origin", "main");

  git(repo, "checkout", "--quiet", "-b", "feature");
  writeFileSync(join(repo, "b.txt"), "feature\n");
  git(repo, "add", "b.txt");
  git(repo, "commit", "--quiet", "-m", "feature");
  const featureSha = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "--quiet", "origin", "feature", "feature:refs/pull/7/head");
  git(repo, "checkout", "--quiet", "main");
  git(repo, "branch", "--quiet", "-D", "feature");

  git(repo, "fetch", "--quiet", "origin");
  git(repo, "remote", "set-head", "origin", "main");
  return { repo, mainSha, featureSha };
}
