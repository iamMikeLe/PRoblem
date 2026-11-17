import { AppFailure } from "../errors.ts";
import { GitCommandError, runGit } from "./repo.ts";

const CHECKOUT_TIMEOUT_MS = 120_000;

/** True when tracked files have uncommitted changes (untracked files do not block a checkout). */
export async function hasLocalChanges(root: string): Promise<boolean> {
  const out = await runGit(root, ["status", "--porcelain", "--untracked-files=no"]);
  return out.trim() !== "";
}

/** The checked-out branch, or `undefined` on a detached HEAD. */
export async function currentBranch(root: string): Promise<string | undefined> {
  try {
    return await runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
}

function checkoutFailure(action: string, error: unknown): never {
  if (!(error instanceof GitCommandError)) throw error;
  throw new AppFailure("checkout_failed", `${action} failed: ${error.stderr || error.message}`, {
    cause: error,
  });
}

/**
 * Creates a worktree at `dir` with `sha` checked out on a detached HEAD, so no branch is created
 * and none can be "already checked out" elsewhere. Hooks are disabled (see `RunGitOptions`).
 */
export async function addWorktree(root: string, dir: string, sha: string): Promise<void> {
  try {
    await runGit(root, ["worktree", "add", "--detach", "--quiet", "--end-of-options", dir, sha], {
      timeoutMs: CHECKOUT_TIMEOUT_MS,
      noHooks: true,
    });
  } catch (error) {
    checkoutFailure("Creating the worktree", error);
  }
}

/**
 * Tracked files of `sha` that are ignored, untracked files in the work tree today (a local
 * `.env`, build output). `git checkout` overwrites ignored files without asking, and switching
 * back afterwards deletes them, so an in-place checkout must not touch any of these.
 */
export async function ignoredFilesOverwrittenBy(root: string, sha: string): Promise<string[]> {
  const ignored = (
    await runGit(root, [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ])
  )
    .split("\0")
    .filter(Boolean);
  if (ignored.length === 0) return [];
  const tracked = (
    await runGit(root, ["ls-tree", "-r", "-z", "--name-only", "--end-of-options", sha])
  )
    .split("\0")
    .filter(Boolean);
  // `--directory` lists a fully ignored folder once, with a trailing slash.
  return tracked.filter((path) =>
    ignored.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry)),
  );
}

/** Removes a worktree the app created. Already-deleted folders are pruned instead. */
export async function removeWorktree(root: string, dir: string): Promise<void> {
  try {
    await runGit(root, ["worktree", "remove", "--force", "--end-of-options", dir], {
      noHooks: true,
    });
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    // The folder may already be gone (deleted by hand); drop git's record of it.
    await runGit(root, ["worktree", "prune"]);
  }
}

/** Checks out `target` (a SHA to detach at, or a branch to return to) in the project checkout. */
export async function checkout(
  root: string,
  target: { sha: string } | { branch: string },
): Promise<void> {
  const args =
    "sha" in target
      ? ["checkout", "--detach", "--quiet", target.sha]
      : ["checkout", "--quiet", target.branch, "--"];
  // `checkout` predates `--end-of-options` in older gits: refuse anything git could read as an option.
  if ("branch" in target && target.branch.startsWith("-")) {
    throw new AppFailure("checkout_failed", `Refusing to check out "${target.branch}"`);
  }
  try {
    await runGit(root, args, { timeoutMs: CHECKOUT_TIMEOUT_MS, noHooks: true });
  } catch (error) {
    checkoutFailure("Checkout", error);
  }
}
