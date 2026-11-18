import { AppFailure } from "../errors.ts";
import { GitCommandError, runGit } from "./repo.ts";

/** Fetches talk to the network; give them time, but never hang a review forever. */
const FETCH_TIMEOUT_MS = 120_000;

export interface Remote {
  name: string;
  url: string;
}

/**
 * The repository's remotes with their URLs as configured. Read from config rather than
 * `git remote -v`, which shows URLs after `url.*.insteadOf` rewriting and can hide which GitHub
 * repository a remote is.
 */
export async function listRemotes(root: string): Promise<Remote[]> {
  let out: string;
  try {
    out = await runGit(root, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
  } catch (error) {
    // Exit code 1: no remotes configured.
    if (error instanceof GitCommandError) return [];
    throw error;
  }
  const remotes: Remote[] = [];
  for (const line of out.split("\n")) {
    const match = /^remote\.(.+)\.url (.+)$/.exec(line);
    if (match?.[1] && match[2]) remotes.push({ name: match[1], url: match[2] });
  }
  return remotes;
}

/** The remote reviews fetch from: `origin` if present, else the first one. */
export function primaryRemote(remotes: readonly Remote[]): Remote | undefined {
  return remotes.find((remote) => remote.name === "origin") ?? remotes[0];
}

/**
 * Rejects anything that is not a plain branch name before it reaches git. `check-ref-format`
 * applies git's own rules; the leading `-` check stops option injection (`--upload-pack=...`).
 */
export async function assertBranchName(root: string, name: string): Promise<void> {
  const valid =
    !name.startsWith("-") &&
    (await runGit(root, ["check-ref-format", "--branch", name]).then(
      () => true,
      () => false,
    ));
  if (!valid) throw new AppFailure("invalid_source", `"${name}" is not a valid branch name`);
}

/** Resolves a ref to a commit SHA, or `undefined` if it does not exist. */
export async function resolveCommit(root: string, ref: string): Promise<string | undefined> {
  try {
    return await runGit(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
}

/**
 * The branch a review compares against when none is given: the remote's default branch
 * (`origin/HEAD`), then `main` or `master` on the remote, then locally.
 */
export async function defaultBaseBranch(root: string, remote: string | undefined): Promise<string> {
  if (remote) {
    try {
      const head = await runGit(root, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
      const prefix = `refs/remotes/${remote}/`;
      if (head.startsWith(prefix)) return head.slice(prefix.length);
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
    }
  }
  for (const candidate of ["main", "master"]) {
    if (remote && (await resolveCommit(root, `refs/remotes/${remote}/${candidate}`)))
      return candidate;
    if (await resolveCommit(root, `refs/heads/${candidate}`)) return candidate;
  }
  throw new AppFailure("base_not_found", "Could not find a default branch; choose a base branch");
}

/**
 * Fetches `refspec` from `remote`. Failures become `fetch_failed` with git's message, which names
 * the missing branch or the network problem.
 */
export async function fetchRefspec(root: string, remote: string, refspec: string): Promise<void> {
  try {
    await runGit(
      root,
      [
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        "--quiet",
        "--end-of-options",
        remote,
        refspec,
      ],
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        noHooks: true,
      },
    );
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    const reason = error.timedOut ? "timed out" : error.stderr || error.message;
    throw new AppFailure("fetch_failed", `Could not fetch from ${remote}: ${reason}`, {
      cause: error,
    });
  }
}

/**
 * The commit to review for a branch name: the remote branch after a fetch, or the local branch
 * when the repository has no remote or the remote does not have it.
 */
export async function resolveBranchHead(
  root: string,
  remote: string | undefined,
  branch: string,
): Promise<string> {
  if (remote) {
    try {
      await fetchRefspec(root, remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
      const sha = await resolveCommit(root, `refs/remotes/${remote}/${branch}`);
      if (sha) return sha;
    } catch (error) {
      // Only a branch the remote does not have falls back to a local branch. Any other fetch
      // failure (offline, timeout) is reported: silently reviewing a stale local copy is worse.
      if (!(error instanceof AppFailure && /couldn't find remote ref/i.test(error.message))) {
        throw error;
      }
    }
  }
  const local = await resolveCommit(root, `refs/heads/${branch}`);
  if (local) return local;
  throw new AppFailure(
    "branch_not_found",
    `Branch "${branch}" was not found locally or on the remote`,
  );
}

/** The commit a base branch points to, preferring the freshly fetched remote branch. */
export async function resolveBaseCommit(
  root: string,
  remote: string | undefined,
  base: string,
): Promise<string> {
  await assertBranchName(root, base);
  if (remote) {
    await fetchRefspec(root, remote, `+refs/heads/${base}:refs/remotes/${remote}/${base}`).catch(
      (error: unknown) => {
        if (!(error instanceof AppFailure)) throw error;
      },
    );
    const sha = await resolveCommit(root, `refs/remotes/${remote}/${base}`);
    if (sha) return sha;
  }
  const local = await resolveCommit(root, `refs/heads/${base}`);
  if (local) return local;
  throw new AppFailure("base_not_found", `Base branch "${base}" was not found`);
}

/** The newest commit both sides share, or `undefined` for unrelated histories. */
export async function mergeBase(root: string, a: string, b: string): Promise<string | undefined> {
  try {
    return await runGit(root, ["merge-base", "--end-of-options", a, b]);
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
}

/** Local and remote branch names, for autocomplete. Remote names drop the `<remote>/` prefix. */
export async function listBranches(root: string): Promise<string[]> {
  const out = await runGit(root, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const names = new Set<string>();
  for (const ref of out.split("\n")) {
    if (ref.startsWith("refs/heads/")) names.add(ref.slice("refs/heads/".length));
    const remote = /^refs\/remotes\/[^/]+\/(.+)$/.exec(ref)?.[1];
    if (remote && remote !== "HEAD") names.add(remote);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Whether `ancestor` is part of the history of `commit`. */
export async function isAncestor(root: string, ancestor: string, commit: string): Promise<boolean> {
  try {
    await runGit(root, ["merge-base", "--is-ancestor", "--end-of-options", ancestor, commit]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

/** Commits in `to` that `from` lacks: their number, and the newest `limit` of them. */
export async function commitsBetween(
  root: string,
  from: string,
  to: string,
  limit: number,
): Promise<{ count: number; commits: { sha: string; subject: string }[] }> {
  const range = `${from}..${to}`;
  const count = Number(await runGit(root, ["rev-list", "--count", "--end-of-options", range]));
  const log = await runGit(root, [
    "log",
    "--no-decorate",
    `--max-count=${limit}`,
    "--format=%H%x1f%s",
    "--end-of-options",
    range,
  ]);
  const commits = log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\x1f");
      return { sha, subject };
    });
  return { count, commits };
}
