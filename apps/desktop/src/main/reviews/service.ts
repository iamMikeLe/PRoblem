import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CloseReviewResult,
  CreateReviewRequest,
  Review,
  ReviewSource,
} from "@reviewroom/shared";
import { AppFailure, type Logger } from "../errors.ts";
import type { GhClient } from "../git/gh.ts";
import { githubRepoOf, parsePullRequestUrl } from "../git/github.ts";
import {
  assertBranchName,
  defaultBaseBranch,
  fetchRefspec,
  listBranches,
  listRemotes,
  mergeBase,
  primaryRemote,
  resolveBaseCommit,
  resolveBranchHead,
  resolveCommit,
} from "../git/refs.ts";
import {
  addWorktree,
  checkout,
  currentBranch,
  hasLocalChanges,
  ignoredFilesOverwrittenBy,
  removeWorktree,
} from "../git/worktree.ts";
import { getProject, isUniqueViolation } from "../projects/repository.ts";
import {
  findOpenInPlaceReview,
  getReviewRecord,
  insertReview,
  listOpenReviews,
  markReviewClosed,
} from "./repository.ts";

export interface ReviewServiceDeps {
  db: DatabaseSync;
  /** Parent folder of all review worktrees (`~/.reviewroom/worktrees`). */
  worktreesDir: string;
  gh: GhClient;
  log: Logger;
  now?: () => Date;
}

export interface ReviewService {
  list(): Review[];
  /** An open review, or `review_not_found`. */
  get(id: string): Review;
  create(input: CreateReviewRequest): Promise<Review>;
  close(id: string): Promise<CloseReviewResult>;
  branches(projectId: string): Promise<string[]>;
}

/** What to check out, resolved from the user's input. */
interface ResolvedHead {
  source: ReviewSource;
  title: string;
  headBranch: string;
  headSha: string;
  defaultBase: string;
  /** Remote to fetch the base from (`undefined` for a repository without remotes). */
  remote: string | undefined;
}

const shortSha = (sha: string) => sha.slice(0, 8);

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { db, gh, log } = deps;
  const now = deps.now ?? (() => new Date());

  // In-place reviews of one project share its checkout: run their starts and closes one at a time.
  const checkoutQueues = new Map<string, Promise<unknown>>();
  function serialized<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const previous = checkoutQueues.get(projectId) ?? Promise.resolve();
    const run = previous.then(task, task);
    checkoutQueues.set(
      projectId,
      run.catch(() => undefined),
    );
    return run;
  }

  function projectOrFail(projectId: string) {
    const project = getProject(db, projectId);
    if (!project) throw new AppFailure("project_not_found", "Project not found");
    return project;
  }

  async function resolvePullRequest(root: string, url: string): Promise<ResolvedHead> {
    const ref = parsePullRequestUrl(url);
    if (!ref) {
      throw new AppFailure(
        "invalid_source",
        "Only GitHub pull request links are supported (https://github.com/<owner>/<repo>/pull/<n>)",
      );
    }
    const repo = `${ref.owner}/${ref.repo}`.toLowerCase();
    const remote = (await listRemotes(root)).find((r) => githubRepoOf(r.url) === repo);
    if (!remote) {
      throw new AppFailure(
        "pr_repo_mismatch",
        `This project has no remote for ${repo}; the pull request belongs to another repository`,
      );
    }
    const info = await gh.viewPullRequest(repo, ref.number);
    // Fetch into the app's own namespace, so parallel starts never race on FETCH_HEAD.
    const target = `refs/reviewroom/pull/${ref.number}`;
    await fetchRefspec(root, remote.name, `+refs/pull/${ref.number}/head:${target}`);
    const headSha = await resolveCommit(root, target);
    if (!headSha)
      throw new AppFailure("fetch_failed", `Could not fetch pull request #${ref.number}`);
    return {
      source: { kind: "pull-request", url: info.url, number: info.number, repo },
      title: info.title,
      headBranch: info.headRefName,
      headSha,
      defaultBase: info.baseRefName,
      remote: remote.name,
    };
  }

  async function resolveBranch(root: string, branch: string): Promise<ResolvedHead> {
    await assertBranchName(root, branch);
    const remote = primaryRemote(await listRemotes(root))?.name;
    const headSha = await resolveBranchHead(root, remote, branch);
    return {
      source: { kind: "branch", branch },
      title: branch,
      headBranch: branch,
      headSha,
      defaultBase: await defaultBaseBranch(root, remote),
      remote,
    };
  }

  /** Prepares the in-place checkout; returns the branch to restore on close. */
  async function checkOutInPlace(
    projectId: string,
    root: string,
    sha: string,
  ): Promise<string | null> {
    const busy = findOpenInPlaceReview(db, projectId);
    if (busy) {
      throw new AppFailure(
        "checkout_busy",
        `"${busy.title}" is already reviewed in the project folder. Close it, or use an isolated worktree.`,
      );
    }
    if (await hasLocalChanges(root)) {
      throw new AppFailure(
        "local_changes",
        "The project folder has uncommitted changes. Commit or stash them, or use an isolated worktree.",
      );
    }
    const atRisk = await ignoredFilesOverwrittenBy(root, sha);
    if (atRisk.length > 0) {
      const shown = atRisk.slice(0, 3).join(", ") + (atRisk.length > 3 ? ", …" : "");
      throw new AppFailure(
        "ignored_files_at_risk",
        `Checking out this review would overwrite ignored files in the project folder (${shown}). Use an isolated worktree.`,
      );
    }
    const restore = (await currentBranch(root)) ?? null;
    await checkout(root, { sha });
    return restore;
  }

  async function undoCheckout(
    root: string,
    isolated: boolean,
    workdir: string,
    restore: string | null,
  ) {
    try {
      if (isolated) await removeWorktree(root, workdir);
      else if (restore) await checkout(root, { branch: restore });
    } catch (error) {
      log.error("could not undo a failed review start", { workdir, error });
    }
  }

  async function create(input: CreateReviewRequest): Promise<Review> {
    const project = projectOrFail(input.projectId);
    const root = project.path;
    const looksLikeUrl = input.source.includes("://");
    const head = looksLikeUrl
      ? await resolvePullRequest(root, input.source)
      : await resolveBranch(root, input.source);

    const baseBranch = input.base ?? head.defaultBase;
    const baseSha = await resolveBaseCommit(root, head.remote, baseBranch);
    const mergeBaseSha = (await mergeBase(root, head.headSha, baseSha)) ?? null;

    const id = randomUUID();
    const at = now().toISOString();
    const start = async (): Promise<Review> => {
      let workdir = root;
      let restore: string | null = null;
      if (input.isolated) {
        const parent = join(deps.worktreesDir, project.id);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        workdir = join(await realpath(parent), id);
        try {
          await addWorktree(root, workdir, head.headSha);
        } catch (error) {
          // A killed `worktree add` leaves a half-built folder and git's record of it.
          await undoCheckout(root, true, workdir, null);
          throw error;
        }
      } else {
        restore = await checkOutInPlace(project.id, root, head.headSha);
      }

      const review: Review = {
        id,
        projectId: project.id,
        title: head.title,
        source: head.source,
        headBranch: head.headBranch,
        headSha: head.headSha,
        baseBranch,
        baseSha,
        mergeBaseSha,
        workdir,
        isolated: input.isolated,
        prompt: input.prompt,
        status: "idle",
        sessionId: null,
        fixMode: false,
        model: null,
        createdAt: at,
        updatedAt: at,
      };
      try {
        insertReview(db, review, restore);
      } catch (error) {
        await undoCheckout(root, input.isolated, workdir, restore);
        if (isUniqueViolation(error)) {
          throw new AppFailure("checkout_busy", "Another review already uses the project folder", {
            cause: error,
          });
        }
        throw error;
      }
      log.info("review started", {
        id,
        project: project.id,
        isolated: input.isolated,
        head: shortSha(head.headSha),
      });
      return review;
    };
    return serialized(project.id, start);
  }

  /**
   * Puts the project folder back after an in-place review, but only when that is safe: the folder
   * must still be exactly where the review left it (detached at the review's head, no uncommitted
   * changes). Anything else means the user has been working there, so it is left alone.
   */
  async function restoreProjectFolder(root: string, review: Review, restoreBranch: string | null) {
    const head = await resolveCommit(root, "HEAD");
    const untouched = (await currentBranch(root)) === undefined && head === review.headSha;
    if (!untouched)
      return "The project folder has moved on since the review started, so it was left as it is.";
    if (!restoreBranch)
      return `The project folder stays at ${shortSha(review.headSha)} (it was not on a branch before).`;
    if (await hasLocalChanges(root)) {
      return `The project folder has uncommitted changes, so it stays at ${shortSha(review.headSha)}. Switch back to ${restoreBranch} yourself.`;
    }
    await checkout(root, { branch: restoreBranch });
    return `Switched the project folder back to ${restoreBranch}.`;
  }

  /**
   * Closes a review. The record is always archived: if cleaning up the folder fails (project moved,
   * branch deleted), the note says what was left behind instead of keeping the review stuck open.
   */
  async function close(id: string): Promise<CloseReviewResult> {
    const first = getReviewRecord(db, id);
    if (!first || first.closedAt !== null)
      throw new AppFailure("review_not_found", "Review not found");

    return serialized(first.review.projectId, async () => {
      // Re-read inside the queue: a second close of the same review must not clean up twice.
      const record = getReviewRecord(db, id);
      if (!record || record.closedAt !== null)
        throw new AppFailure("review_not_found", "Review not found");
      const { review, restoreBranch } = record;
      const root = projectOrFail(review.projectId).path;

      let note: string | null = null;
      try {
        if (review.isolated) {
          // Defense in depth: only ever delete `<worktreesDir>/<projectId>/<reviewId>`.
          const parent = await realpath(deps.worktreesDir).catch(() => deps.worktreesDir);
          if (review.workdir !== join(parent, review.projectId, review.id)) {
            note = `Did not delete ${review.workdir}: it is not a ReviewRoom worktree.`;
          } else {
            await removeWorktree(root, review.workdir);
          }
        } else {
          note = await restoreProjectFolder(root, review, restoreBranch);
        }
      } catch (error) {
        log.error("review cleanup failed", { id, error });
        const detail = error instanceof Error ? error.message : String(error);
        note = review.isolated
          ? `The worktree could not be removed (${detail}). Delete ${review.workdir} yourself.`
          : `The project folder could not be switched back (${detail}).`;
      }
      markReviewClosed(db, id, now());
      log.info("review closed", { id });
      return { note };
    });
  }

  return {
    list: () => listOpenReviews(db),
    get(id) {
      const record = getReviewRecord(db, id);
      if (!record || record.closedAt !== null)
        throw new AppFailure("review_not_found", "Review not found");
      return record.review;
    },
    create,
    close,
    branches: async (projectId) => listBranches(projectOrFail(projectId).path),
  };
}
