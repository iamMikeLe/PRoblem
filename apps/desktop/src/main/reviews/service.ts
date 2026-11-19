import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CloseReviewResult,
  CreateReviewRequest,
  Review,
  ReviewSource,
  UpdateCheck,
} from "@problem/shared";
import type { ActivityService } from "../activity/service.ts";
import { AppFailure, type Logger } from "../errors.ts";
import type { GhClient } from "../git/gh.ts";
import { githubRepoOf, parsePullRequestUrl } from "../git/github.ts";
import {
  assertBranchName,
  commitsBetween,
  defaultBaseBranch,
  fetchRefspec,
  isAncestor,
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
  updateReviewHead,
} from "./repository.ts";

export interface ReviewServiceDeps {
  db: DatabaseSync;
  /** Parent folder of all review worktrees (`~/.problem/worktrees`). */
  worktreesDir: string;
  gh: GhClient;
  log: Logger;
  /** The Activity feed: new commits found by a check (ADR 0015). */
  activity?: Pick<ActivityService, "record" | "last" | "resolve">;
  now?: () => Date;
}

export interface ReviewService {
  list(): Review[];
  /** An open review, or `review_not_found`. */
  get(id: string): Review;
  create(input: CreateReviewRequest): Promise<Review>;
  close(id: string): Promise<CloseReviewResult>;
  branches(projectId: string): Promise<string[]>;
  /** Fetches the review's branch or pull request and compares its head (ADR 0013). */
  checkUpdate(id: string): Promise<UpdateCheck>;
  /**
   * The same check without anyone waiting (after a turn): in the project's queue, at most one at
   * a time per review and once per 5 minutes, never prompting for credentials. Lists new commits
   * in Activity; failures are only logged.
   */
  checkInBackground(id: string): void;
  /** Moves the review's folder to the latest head; the caller makes sure Claude is not working. */
  refresh(id: string): Promise<Review>;
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

/** Background checks for new commits of one review run at most this often. */
const BACKGROUND_CHECK_MS = 5 * 60_000;

type Unattended = { unattended?: boolean };

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

  async function resolvePullRequest(
    root: string,
    url: string,
    options: Unattended = {},
  ): Promise<ResolvedHead> {
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
    const target = `refs/problem/pull/${ref.number}`;
    await fetchRefspec(root, remote.name, `+refs/pull/${ref.number}/head:${target}`, options);
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

  async function resolveBranch(
    root: string,
    branch: string,
    options: Unattended = {},
  ): Promise<ResolvedHead> {
    await assertBranchName(root, branch);
    const remote = primaryRemote(await listRemotes(root))?.name;
    const headSha = await resolveBranchHead(root, remote, branch, options);
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
            note = `Did not delete ${review.workdir}: it is not a PRoblem worktree.`;
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

  function openRecord(id: string) {
    const record = getReviewRecord(db, id);
    if (!record || record.closedAt !== null)
      throw new AppFailure("review_not_found", "Review not found");
    return record;
  }

  /** The review's branch or pull request as it is now on the remote. */
  function resolveLatest(
    review: Review,
    root: string,
    options: Unattended = {},
  ): Promise<ResolvedHead> {
    return review.source.kind === "pull-request"
      ? resolvePullRequest(root, review.source.url, options)
      : resolveBranch(root, review.source.branch, options);
  }

  async function checkUpdate(id: string, options: Unattended = {}): Promise<UpdateCheck> {
    const { review } = openRecord(id);
    const root = projectOrFail(review.projectId).path;
    const latest = await resolveLatest(review, root, options);
    if (latest.headSha === review.headSha) {
      return {
        headSha: review.headSha,
        latestSha: latest.headSha,
        newCommits: 0,
        commits: [],
        rewritten: false,
      };
    }
    const rewritten = !(await isAncestor(root, review.headSha, latest.headSha));
    const { count, commits } = await commitsBetween(root, review.headSha, latest.headSha, 20);
    // Once per new head, however often it is checked; and not when the review was refreshed or
    // closed while the fetch ran (the row would be about a head it already has).
    const current = getReviewRecord(db, id);
    const unchanged = current?.closedAt === null && current.review.headSha === review.headSha;
    if (
      deps.activity &&
      unchanged &&
      deps.activity.last(id, "commits")?.detail.latestSha !== latest.headSha
    ) {
      deps.activity.record(id, {
        kind: "commits",
        newCommits: count,
        latestSha: latest.headSha,
        rewritten,
      });
    }
    return {
      headSha: review.headSha,
      latestSha: latest.headSha,
      newCommits: count,
      commits,
      rewritten,
    };
  }

  /** Reviews whose background check runs, and when each last started one. */
  const checking = new Set<string>();
  const lastChecked = new Map<string, number>();

  function checkInBackground(id: string): void {
    const started = now().getTime();
    if (
      checking.has(id) ||
      started - (lastChecked.get(id) ?? Number.NEGATIVE_INFINITY) < BACKGROUND_CHECK_MS
    ) {
      return;
    }
    let projectId: string;
    try {
      projectId = openRecord(id).review.projectId;
    } catch {
      return;
    }
    checking.add(id);
    lastChecked.set(id, started);
    // In the project's queue, so it never fetches the same refs as a Refresh, start or close.
    serialized(projectId, () => checkUpdate(id, { unattended: true }))
      .catch((error: unknown) => log.info("background check failed", { review: id, error }))
      .finally(() => checking.delete(id));
  }

  async function refresh(id: string): Promise<Review> {
    const first = openRecord(id).review;
    return serialized(first.projectId, async () => {
      const { review } = openRecord(id);
      const root = projectOrFail(review.projectId).path;
      const latest = await resolveLatest(review, root);
      if (latest.headSha === review.headSha) return review;
      // Uncommitted edits (fix mode, or the user's own in an in-place review) would be lost or
      // block the checkout: the user decides what to do with them first.
      if (await hasLocalChanges(review.workdir)) {
        throw new AppFailure(
          "local_changes",
          "The review's folder has uncommitted changes. Commit, stash or discard them, then refresh.",
        );
      }
      if (!review.isolated) {
        const atRisk = await ignoredFilesOverwrittenBy(root, latest.headSha);
        if (atRisk.length > 0) {
          throw new AppFailure(
            "ignored_files_at_risk",
            `Moving the project folder would overwrite ignored files (${atRisk.slice(0, 3).join(", ")}).`,
          );
        }
      }
      const baseSha = await resolveBaseCommit(root, latest.remote, review.baseBranch);
      const mergeBaseSha = (await mergeBase(root, latest.headSha, baseSha)) ?? null;
      await checkout(review.workdir, { sha: latest.headSha });
      updateReviewHead(
        db,
        id,
        { title: latest.title, headSha: latest.headSha, baseSha, mergeBaseSha },
        now(),
      );
      // The "New commits" rows asked for this refresh; they no longer ask for anything.
      deps.activity?.resolve(id, "commits");
      log.info("review refreshed", {
        id,
        from: shortSha(review.headSha),
        to: shortSha(latest.headSha),
      });
      return openRecord(id).review;
    });
  }

  return {
    checkUpdate: (id) => checkUpdate(id),
    checkInBackground,
    refresh,
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
