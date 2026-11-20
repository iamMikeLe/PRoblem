import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type CreateReviewRequest, DEFAULT_REVIEW_PROMPT, type Project } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/main/db/database.ts";
import { AppFailure, silentLogger } from "../../../src/main/errors.ts";
import type { GhClient } from "../../../src/main/git/gh.ts";
import { createProjectService, type ProjectService } from "../../../src/main/projects/service.ts";
import { createBitbucketHost } from "../../../src/main/pullrequests/bitbucket.ts";
import type { BitbucketApi } from "../../../src/main/pullrequests/bitbucketApi.ts";
import { createGitHubHost } from "../../../src/main/pullrequests/github.ts";
import { createReviewService, type ReviewService } from "../../../src/main/reviews/service.ts";
import {
  type GitHubFixture,
  git,
  initRepo,
  makeGitHubFixture,
  makeTempDir,
} from "../gitFixture.ts";

async function failureCode(action: () => unknown): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppFailure) return error.code;
    throw error;
  }
  throw new Error("expected an AppFailure");
}

const PR_URL = "https://github.com/acme/payments/pull/7";

describe("review service", () => {
  let db: DatabaseSync;
  let dir: string;
  let cleanup: () => Promise<void>;
  let fx: GitHubFixture;
  let project: Project;
  let projects: ProjectService;
  let reviews: ReviewService;
  let gh: GhClient;
  /** What the fake Bitbucket answers for any pull request, and the paths asked for. */
  let bitbucketPr: Record<string, unknown>;
  let bitbucketPaths: string[];

  const request = (overrides: Partial<CreateReviewRequest> = {}): CreateReviewRequest => ({
    projectId: project.id,
    source: "feature",
    isolated: true,
    prompt: DEFAULT_REVIEW_PROMPT,
    ...overrides,
  });

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    fx = makeGitHubFixture(dir);
    db = openDatabase(":memory:");
    projects = createProjectService({ db, home: dir, log: silentLogger });
    project = await projects.create({ path: fx.repo });
    gh = {
      viewPullRequest: vi.fn(async () => ({
        number: 7,
        title: "Retry idempotent webhooks",
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
    };
    bitbucketPaths = [];
    bitbucketPr = {
      id: 12,
      title: "Retry on Bitbucket",
      source: {
        branch: { name: "feature" },
        commit: { hash: fx.featureSha.slice(0, 12) },
        repository: { full_name: "acme/payments" },
      },
      destination: { branch: { name: "main" } },
    };
    const api: BitbucketApi = {
      get: async (path, schema) => {
        bitbucketPaths.push(path);
        return schema.parse(bitbucketPr);
      },
      list: async () => ({ values: [], truncated: false }),
      post: async () => {
        throw new Error("not used");
      },
    };
    reviews = createReviewService({
      db,
      worktreesDir: join(dir, "worktrees"),
      hosts: [createGitHubHost(gh), createBitbucketHost(api)],
      log: silentLogger,
    });
  });

  /** Moves the fixture's remote to Bitbucket Cloud (git still fetches from the local copy). */
  function moveRemoteToBitbucket() {
    const origin = join(dir, "origin.git");
    git(fx.repo, "remote", "set-url", "origin", "git@bitbucket.org:acme/payments.git");
    git(fx.repo, "config", `url.${origin}.insteadOf`, "git@bitbucket.org:acme/payments.git");
  }

  afterEach(async () => {
    db.close();
    await cleanup();
  });

  it("reviews a branch in an isolated worktree without touching the project checkout", async () => {
    const review = await reviews.create(request());

    expect(review).toMatchObject({
      title: "feature",
      source: { kind: "branch", branch: "feature" },
      headBranch: "feature",
      headSha: fx.featureSha,
      baseBranch: "main",
      baseSha: fx.mainSha,
      mergeBaseSha: fx.mainSha,
      isolated: true,
      status: "idle",
    });
    expect(review.workdir.startsWith(join(dir, "worktrees", project.id))).toBe(true);
    expect(git(review.workdir, "rev-parse", "HEAD")).toBe(fx.featureSha);
    expect(git(fx.repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(reviews.list()).toEqual([review]);

    expect(await reviews.close(review.id)).toEqual({ note: null });
    expect(existsSync(review.workdir)).toBe(false);
    expect(reviews.list()).toEqual([]);
    expect(await failureCode(() => reviews.close(review.id))).toBe("review_not_found");
  });

  it("reviews a GitHub pull request, using its title, head and base", async () => {
    const review = await reviews.create(request({ source: `${PR_URL}/files` }));

    expect(gh.viewPullRequest).toHaveBeenCalledWith("acme/payments", 7);
    expect(review).toMatchObject({
      title: "Retry idempotent webhooks",
      source: { kind: "pull-request", url: PR_URL, number: 7, repo: "acme/payments" },
      headBranch: "feature",
      headSha: fx.featureSha,
      baseBranch: "main",
    });
    expect(git(fx.repo, "rev-parse", "refs/problem/pull/7")).toBe(fx.featureSha);
  });

  it("reviews a Bitbucket pull request from its link, fetching its source branch", async () => {
    moveRemoteToBitbucket();
    const url = "https://bitbucket.org/acme/payments/pull-requests/12";
    const review = await reviews.create(request({ source: `${url}/diff` }));

    expect(bitbucketPaths).toEqual(["/repositories/acme/payments/pullrequests/12"]);
    expect(review).toMatchObject({
      title: "Retry on Bitbucket",
      source: { kind: "pull-request", url, number: 12, repo: "acme/payments" },
      headBranch: "feature",
      headSha: fx.featureSha,
      baseBranch: "main",
    });
    expect(git(fx.repo, "rev-parse", "refs/problem/pull/12")).toBe(fx.featureSha);
  });

  it("reads #12 as a pull request of the project's own host", async () => {
    expect((await reviews.create(request({ source: "#7" }))).source).toMatchObject({
      kind: "pull-request",
      url: PR_URL,
    });
    moveRemoteToBitbucket();
    expect((await reviews.create(request({ source: "#12" }))).source).toMatchObject({
      kind: "pull-request",
      url: "https://bitbucket.org/acme/payments/pull-requests/12",
    });
  });

  it("fetches a Bitbucket pull request from a fork by a URL the app builds", async () => {
    moveRemoteToBitbucket();
    const origin = join(dir, "origin.git");
    // The fork has the same branch; git is pointed at the local copy for its URL.
    git(
      fx.repo,
      "config",
      "--add",
      `url.${origin}.insteadOf`,
      "git@bitbucket.org:someone/payments.git",
    );
    bitbucketPr = {
      ...bitbucketPr,
      source: {
        branch: { name: "feature" },
        commit: { hash: fx.featureSha.slice(0, 12) },
        repository: { full_name: "Someone/Payments" },
        links: { clone: [{ href: "ext::sh -c touch% /tmp/pwned" }] },
      },
    };
    const review = await reviews.create(
      request({ source: "https://bitbucket.org/acme/payments/pull-requests/12" }),
    );
    expect(review.headSha).toBe(fx.featureSha);

    bitbucketPr = {
      ...bitbucketPr,
      source: { ...(bitbucketPr.source as object), repository: { full_name: "../../etc" } },
    };
    expect(
      await failureCode(() =>
        reviews.create(request({ source: "https://bitbucket.org/acme/payments/pull-requests/12" })),
      ),
    ).toBe("fetch_failed");
  });

  it("refuses a Bitbucket source branch git would read as an option", async () => {
    moveRemoteToBitbucket();
    bitbucketPr = {
      ...bitbucketPr,
      source: { ...(bitbucketPr.source as object), branch: { name: "--upload-pack=touch x" } },
    };
    expect(
      await failureCode(() =>
        reviews.create(request({ source: "https://bitbucket.org/acme/payments/pull-requests/12" })),
      ),
    ).toBe("invalid_source");
  });

  it("rejects pull requests of other repositories and links that are not GitHub PRs", async () => {
    expect(
      await failureCode(() =>
        reviews.create(request({ source: "https://github.com/other/repo/pull/1" })),
      ),
    ).toBe("pr_repo_mismatch");
    expect(
      await failureCode(() =>
        reviews.create(request({ source: "https://gitlab.com/acme/payments/-/merge_requests/1" })),
      ),
    ).toBe("invalid_source");
    expect(gh.viewPullRequest).not.toHaveBeenCalled();
  });

  it("rejects branch names git would read as options or refuse, and unknown branches", async () => {
    for (const source of ["--upload-pack=touch /tmp/pwned", "a..b", "bad name"]) {
      expect(await failureCode(() => reviews.create(request({ source }))), source).toBe(
        "invalid_source",
      );
    }
    expect(await failureCode(() => reviews.create(request({ source: "nope" })))).toBe(
      "branch_not_found",
    );
    expect(await failureCode(() => reviews.create(request({ base: "missing-base" })))).toBe(
      "base_not_found",
    );
  });

  it("never runs repository hooks while checking out code under review", async () => {
    // A PR can ship its own hooks when the repo uses an in-tree hooks folder (husky and friends).
    const hooks = join(fx.repo, ".husky");
    await mkdir(hooks);
    const marker = join(dir, "hook-ran");
    await writeFile(join(hooks, "post-checkout"), `#!/bin/sh\ntouch "${marker}"\n`);
    await chmod(join(hooks, "post-checkout"), 0o755);
    git(fx.repo, "config", "core.hooksPath", ".husky");

    await reviews.create(request());
    await reviews.create(request({ source: PR_URL, isolated: false }));
    expect(existsSync(marker)).toBe(false);
  });

  describe("in place", () => {
    it("checks out the head detached, allows one per project, and restores the branch on close", async () => {
      const review = await reviews.create(request({ isolated: false }));
      expect(review.workdir).toBe(fx.repo);
      expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.featureSha);
      expect(git(fx.repo, "status", "--porcelain=v2", "--branch")).toContain(
        "# branch.head (detached)",
      );

      expect(await failureCode(() => reviews.create(request({ isolated: false })))).toBe(
        "checkout_busy",
      );
      // Isolated reviews still work next to it.
      await reviews.create(request());

      expect(await reviews.close(review.id)).toEqual({
        note: "Switched the project folder back to main.",
      });
      expect(git(fx.repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
    });

    it("refuses to start over uncommitted changes", async () => {
      await writeFile(join(fx.repo, "a.txt"), "edited\n");
      expect(await failureCode(() => reviews.create(request({ isolated: false })))).toBe(
        "local_changes",
      );
      expect(git(fx.repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
    });

    it("closes without switching back when the folder has changes, and says so", async () => {
      const review = await reviews.create(request({ isolated: false }));
      await writeFile(join(fx.repo, "a.txt"), "edited\n");
      const result = await reviews.close(review.id);
      expect(result.note).toMatch(/uncommitted changes.*Switch back to main yourself/);
      expect(reviews.list()).toEqual([]);
    });

    it("serializes parallel in-place starts so only one wins", async () => {
      const results = await Promise.allSettled([
        reviews.create(request({ isolated: false })),
        reviews.create(request({ isolated: false, source: PR_URL })),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(reviews.list()).toHaveLength(1);
    });
  });

  describe("hardening (Phase 2 review)", () => {
    it("refuses an in-place checkout that would overwrite an ignored local file", async () => {
      await writeFile(join(fx.repo, ".gitignore"), ".env\nbuild/\n");
      git(fx.repo, "add", ".gitignore");
      git(fx.repo, "commit", "--quiet", "-m", "ignore .env");
      git(fx.repo, "push", "--quiet", "origin", "main");
      // The PR force-adds a file that is ignored (and present) in the user's checkout.
      git(fx.repo, "checkout", "--quiet", "-b", "leak");
      await writeFile(join(fx.repo, ".env"), "FROM_PR=1\n");
      git(fx.repo, "add", "--force", ".env");
      git(fx.repo, "commit", "--quiet", "-m", "leak");
      git(fx.repo, "push", "--quiet", "origin", "leak");
      git(fx.repo, "checkout", "--quiet", "main");
      await writeFile(join(fx.repo, ".env"), "SECRET=mine\n");

      expect(
        await failureCode(() => reviews.create(request({ source: "leak", isolated: false }))),
      ).toBe("ignored_files_at_risk");
      expect(await readFile(join(fx.repo, ".env"), "utf8")).toBe("SECRET=mine\n");
      // An isolated worktree is unaffected.
      await reviews.create(request({ source: "leak" }));
    });

    it("leaves the project folder alone on close when the user has moved on", async () => {
      const review = await reviews.create(request({ isolated: false }));
      await writeFile(join(fx.repo, "mine.txt"), "work\n");
      git(fx.repo, "add", "mine.txt");
      git(fx.repo, "commit", "--quiet", "-m", "my work on the detached head");
      const mine = git(fx.repo, "rev-parse", "HEAD");

      const { note } = await reviews.close(review.id);
      expect(note).toMatch(/moved on since the review started/);
      expect(git(fx.repo, "rev-parse", "HEAD")).toBe(mine);
    });

    it("says where it stays when the project folder was detached before the review", async () => {
      git(fx.repo, "checkout", "--quiet", "--detach", "main");
      const review = await reviews.create(request({ isolated: false }));
      expect((await reviews.close(review.id)).note).toMatch(/was not on a branch before/);
    });

    it("still closes when the branch to restore is gone, and says so", async () => {
      // A local-only branch: once deleted, git cannot recreate it from the remote.
      git(fx.repo, "checkout", "--quiet", "-b", "mine");
      const review = await reviews.create(request({ isolated: false }));
      git(fx.repo, "branch", "--quiet", "-D", "mine");
      const { note } = await reviews.close(review.id);
      expect(note).toMatch(/could not be switched back/);
      expect(reviews.list()).toEqual([]);
    });

    it("still closes when the project folder has moved, and says what was left behind", async () => {
      const review = await reviews.create(request());
      await rename(fx.repo, `${fx.repo}-moved`);
      const { note } = await reviews.close(review.id);
      expect(note).toMatch(/worktree could not be removed/);
      expect(reviews.list()).toEqual([]);
    });

    it("closes cleanly when the worktree folder was already deleted by hand", async () => {
      const review = await reviews.create(request());
      await rm(review.workdir, { recursive: true, force: true });
      expect(await reviews.close(review.id)).toEqual({ note: null });
      expect(git(fx.repo, "worktree", "list")).not.toContain(review.id);
    });

    it("never deletes a folder that is not the review's own worktree", async () => {
      const review = await reviews.create(request());
      db.prepare("UPDATE reviews SET workdir = ? WHERE id = ?").run(fx.repo, review.id);
      const { note } = await reviews.close(review.id);
      expect(note).toMatch(/is not a PRoblem worktree/);
      expect(existsSync(join(fx.repo, "a.txt"))).toBe(true);
    });

    it("cleans up only once when the same review is closed twice at the same time", async () => {
      const review = await reviews.create(request({ isolated: false }));
      const results = await Promise.allSettled([
        reviews.close(review.id),
        reviews.close(review.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    });

    it("reports a failed fetch instead of reviewing a stale local branch", async () => {
      git(fx.repo, "branch", "--quiet", "feature", "main"); // stale local copy
      git(
        fx.repo,
        "config",
        `url.${join(dir, "offline.git")}.insteadOf`,
        "https://github.com/acme/payments.git",
      );
      git(fx.repo, "config", "--unset-all", `url.${join(dir, "origin.git")}.insteadOf`);
      expect(await failureCode(() => reviews.create(request()))).toBe("fetch_failed");
    });

    it("falls back to a local branch the remote does not have", async () => {
      git(fx.repo, "branch", "--quiet", "local-only", "main");
      const review = await reviews.create(request({ source: "local-only" }));
      expect(review.headSha).toBe(fx.mainSha);
    });
  });

  it("works for a repository without remotes, using local branches", async () => {
    const local = join(dir, "local");
    await mkdir(local);
    initRepo(local);
    git(local, "checkout", "--quiet", "-b", "topic");
    git(local, "commit", "--quiet", "--allow-empty", "-m", "topic");
    git(local, "checkout", "--quiet", "main");
    const localProject = await projects.create({ path: local });

    const review = await reviews.create(request({ projectId: localProject.id, source: "topic" }));
    expect(review).toMatchObject({ headBranch: "topic", baseBranch: "main" });
  });

  it("lists branch names for autocomplete without remote prefixes", async () => {
    expect(await reviews.branches(project.id)).toEqual(["feature", "main"]);
  });

  it("keeps a project with open reviews from being removed", async () => {
    const review = await reviews.create(request());
    expect(await failureCode(() => projects.remove(project.id))).toBe("project_has_reviews");
    await reviews.close(review.id);
    projects.remove(project.id);
    expect(projects.list()).toEqual([]);
  });
});
