import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_REVIEW_PROMPT, type Project } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChangesService } from "../../../src/main/changes/service.ts";
import { openDatabase } from "../../../src/main/db/database.ts";
import { AppFailure, silentLogger } from "../../../src/main/errors.ts";
import { createProjectService } from "../../../src/main/projects/service.ts";
import { movedFrom } from "../../../src/main/reviews/repository.ts";
import { createReviewService, type ReviewService } from "../../../src/main/reviews/service.ts";
import { type GitHubFixture, git, makeGitHubFixture, makeTempDir } from "../gitFixture.ts";

const PR_URL = "https://github.com/acme/payments/pull/7";

describe("checking for new commits and refreshing a review", () => {
  let db: DatabaseSync;
  let dir: string;
  let cleanup: () => Promise<void>;
  let fx: GitHubFixture;
  let project: Project;
  let reviews: ReviewService;
  let other: string;

  /** Pushes a commit to `feature` (and PR #7) from another clone, like a teammate would. */
  function pushCommit(file: string, message: string, force = false): string {
    writeFileSync(join(other, file), `${message}\n`);
    git(other, "add", file);
    git(other, "commit", "-q", "-m", message);
    const flag = force ? ["--force"] : [];
    git(other, "push", "-q", ...flag, "origin", "HEAD:feature", "HEAD:refs/pull/7/head");
    return git(other, "rev-parse", "HEAD");
  }

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir("problem-refresh-"));
    fx = makeGitHubFixture(dir);
    other = join(dir, "other");
    git(dir, "clone", "-q", join(dir, "origin.git"), other);
    git(other, "checkout", "-q", "feature");
    db = openDatabase(":memory:");
    project = await createProjectService({ db, home: dir, log: silentLogger }).create({
      path: fx.repo,
    });
    reviews = createReviewService({
      db,
      worktreesDir: join(dir, "worktrees"),
      gh: {
        viewPullRequest: vi.fn(async () => ({
          number: 7,
          title: "Retry webhooks",
          url: PR_URL,
          headRefName: "feature",
          headRefOid: fx.featureSha,
          baseRefName: "main",
        })),
        pullRequestsForBranch: vi.fn(async () => []),
        graphql: vi.fn(async () => {
          throw new Error("not used");
        }),
        postReview: vi.fn(async () => {
          throw new Error("not used");
        }),
      },
      log: silentLogger,
    });
  });

  afterEach(async () => {
    db.close();
    await cleanup();
  });

  const start = (source: string, isolated = true) =>
    reviews.create({ projectId: project.id, source, isolated, prompt: DEFAULT_REVIEW_PROMPT });

  it("reports nothing new, then the new commits, for a branch and a pull request", async () => {
    for (const source of ["feature", PR_URL]) {
      const review = await start(source);
      expect(await reviews.checkUpdate(review.id)).toEqual({
        headSha: fx.featureSha,
        latestSha: fx.featureSha,
        newCommits: 0,
        commits: [],
        rewritten: false,
      });
      await reviews.close(review.id);
    }
    const review = await start("feature");
    const first = pushCommit("c.txt", "add c");
    const second = pushCommit("d.txt", "add d");
    expect(await reviews.checkUpdate(review.id)).toEqual({
      headSha: fx.featureSha,
      latestSha: second,
      newCommits: 2,
      commits: [
        { sha: second, subject: "add d" },
        { sha: first, subject: "add c" },
      ],
      rewritten: false,
    });
  });

  it("notices rewritten history (force-push)", async () => {
    const review = await start(PR_URL);
    git(other, "reset", "-q", "--hard", fx.mainSha);
    pushCommit("e.txt", "rewritten", true);
    expect(await reviews.checkUpdate(review.id)).toMatchObject({ newCommits: 1, rewritten: true });
  });

  it("moves an isolated review to the new head and remembers where it came from", async () => {
    const review = await start("feature");
    const latest = pushCommit("c.txt", "add c");
    const refreshed = await reviews.refresh(review.id);
    expect(refreshed.headSha).toBe(latest);
    expect(refreshed.mergeBaseSha).toBe(fx.mainSha);
    expect(git(review.workdir, "rev-parse", "HEAD")).toBe(latest);
    expect(existsSync(join(review.workdir, "c.txt"))).toBe(true);
    expect(movedFrom(db, review.id)).toBe(fx.featureSha);

    // A second refresh keeps the oldest head Claude has not been told about.
    const newer = pushCommit("d.txt", "add d");
    expect((await reviews.refresh(review.id)).headSha).toBe(newer);
    expect(movedFrom(db, review.id)).toBe(fx.featureSha);
    // Nothing new: nothing changes.
    expect((await reviews.refresh(review.id)).headSha).toBe(newer);

    // The Changes view now covers the new commits.
    const changes = createChangesService({ review: (id) => reviews.get(id) });
    expect((await changes.files(review.id)).files.map((f) => f.path).sort()).toEqual([
      "b.txt",
      "c.txt",
      "d.txt",
    ]);
  });

  it("moves an in-place review in the project folder", async () => {
    const review = await start("feature", false);
    const latest = pushCommit("c.txt", "add c");
    await reviews.refresh(review.id);
    expect(git(fx.repo, "rev-parse", "HEAD")).toBe(latest);
  });

  it("refuses to refresh over uncommitted edits in the review's folder", async () => {
    const review = await start("feature");
    pushCommit("c.txt", "add c");
    writeFileSync(join(review.workdir, "b.txt"), "edited in fix mode\n");
    await expect(reviews.refresh(review.id)).rejects.toMatchObject({ code: "local_changes" });
    expect(reviews.get(review.id).headSha).toBe(fx.featureSha);
    expect(movedFrom(db, review.id)).toBeNull();
  });

  it("serves only files git listed as changed", async () => {
    const review = await start("feature");
    const changes = createChangesService({ review: (id) => reviews.get(id) });
    expect((await changes.file(review.id, "b.txt")).hunks).toHaveLength(1);
    await expect(changes.file(review.id, "a.txt")).rejects.toBeInstanceOf(AppFailure);
    await expect(changes.file(review.id, "../../etc/passwd")).rejects.toMatchObject({
      code: "file_not_in_changes",
    });
  });
});
