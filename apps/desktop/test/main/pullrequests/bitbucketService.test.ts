import type { DatabaseSync } from "node:sqlite";
import type { FileDiff, Review } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ActivityService, createActivityService } from "../../../src/main/activity/service.ts";
import { openDatabase } from "../../../src/main/db/database.ts";
import { AppFailure, silentLogger } from "../../../src/main/errors.ts";
import { insertFinding, setVerdict } from "../../../src/main/findings/repository.ts";
import { insertProject } from "../../../src/main/projects/repository.ts";
import { createBitbucketHost } from "../../../src/main/pullrequests/bitbucket.ts";
import type { BitbucketApi } from "../../../src/main/pullrequests/bitbucketApi.ts";
import {
  createPullRequestService,
  type PullRequestService,
} from "../../../src/main/pullrequests/service.ts";
import { getReviewRecord, insertReview } from "../../../src/main/reviews/repository.ts";
import { git, makeGitHubFixture, makeTempDir } from "../gitFixture.ts";

const HEAD = "a".repeat(40);
const PR_URL = "https://bitbucket.org/acme/payments/pull-requests/7";
const AT = "2026-11-20T10:00:00.000Z";

const diff: FileDiff = {
  path: "src/app.ts",
  binary: false,
  tooLarge: false,
  hunks: [
    {
      header: "@@ -10,2 +10,3 @@",
      lines: [
        { kind: "context", oldLine: 10, newLine: 10, text: "a" },
        { kind: "add", oldLine: null, newLine: 11, text: "b" },
        { kind: "add", oldLine: null, newLine: 12, text: "c" },
      ],
    },
  ],
};

/** A fake Bitbucket API: a pull request, its comments, and a script for writes. */
interface Fake {
  configured: boolean;
  comments: unknown[];
  /** Answers the n-th POST; throw to fail it. */
  onPost: (n: number, path: string) => unknown;
  posts: string[];
}

describe("pull requests on Bitbucket", () => {
  let db: DatabaseSync;
  let dir: string;
  let cleanup: () => Promise<void>;
  let fake: Fake;
  let service: PullRequestService;
  let activity: ActivityService;
  let projectId: string;

  const pullRequest = {
    id: 7,
    title: "Retry webhooks",
    source: {
      branch: { name: "feature" },
      commit: { hash: HEAD.slice(0, 12) },
      repository: { full_name: "acme/payments" },
    },
    destination: { branch: { name: "main" } },
  };

  function addReview(id: string, source: Review["source"]): void {
    insertReview(
      db,
      {
        id,
        projectId,
        title: "Retry webhooks",
        source,
        headBranch: "feature",
        headSha: HEAD,
        baseBranch: "main",
        baseSha: "b".repeat(40),
        mergeBaseSha: "c".repeat(40),
        workdir: dir,
        isolated: true,
        prompt: "Review it.",
        status: "idle",
        sessionId: null,
        model: null,
        fixMode: false,
        createdAt: AT,
        updatedAt: AT,
      },
      null,
    );
  }

  const notConfigured = () =>
    new AppFailure(
      "bitbucket_not_configured",
      "Add your Bitbucket email and API token in Settings.",
    );

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir("problem-bitbucket-"));
    const fx = makeGitHubFixture(dir);
    git(fx.repo, "remote", "set-url", "origin", "git@bitbucket.org:acme/payments.git");
    db = openDatabase(":memory:");
    projectId = insertProject(db, { name: "payments", path: fx.repo, reviewPrompt: "x" }).id;
    fake = { configured: true, comments: [], onPost: (n) => ({ id: n }), posts: [] };
    const api: BitbucketApi = {
      get: async (_path, schema) => {
        if (!fake.configured) throw notConfigured();
        return schema.parse(pullRequest);
      },
      list: async (path, item) => {
        if (!fake.configured) throw notConfigured();
        const values = path.includes("/comments") ? fake.comments : [pullRequest];
        return { values: values.map((value) => item.parse(value)), truncated: false };
      },
      post: async (path, _body, schema) => {
        fake.posts.push(path);
        return schema.parse(fake.onPost(fake.posts.length, path));
      },
    };
    activity = createActivityService({ db, broadcast: () => {}, log: silentLogger });
    service = createPullRequestService({
      db,
      hosts: [createBitbucketHost(api)],
      activity,
      review: (id) => {
        const record = getReviewRecord(db, id);
        if (!record) throw new Error(id);
        return record.review;
      },
      changes: {
        file: async (_id, path) => {
          if (path === "src/app.ts") return diff;
          throw new Error("not changed");
        },
      },
      log: silentLogger,
    });
  });

  afterEach(async () => {
    db.close();
    await cleanup();
  });

  it("links a branch review to its Bitbucket pull request by the short head", async () => {
    addReview("r1", { kind: "branch", branch: "feature" });
    const conversation = await service.conversation("r1");
    expect(conversation).toMatchObject({
      status: "ok",
      pullRequest: { host: "bitbucket", repo: "acme/payments", number: 7, url: PR_URL },
    });
    const stored = db.prepare("SELECT linked_pr FROM reviews WHERE id = 'r1'").get();
    expect(JSON.stringify(stored)).toContain('\\"host\\":\\"bitbucket\\"');

    const preview = await service.preview("r1");
    expect(preview).toMatchObject({ status: "ok", upToDate: true });
  });

  it("shows no pull request, not an error, until a token is saved", async () => {
    fake.configured = false;
    addReview("r1", { kind: "branch", branch: "feature" });
    const reason = "Add your Bitbucket email and API token in Settings.";
    expect(await service.conversation("r1")).toEqual({ status: "none", reason });
    expect(await service.preview("r1")).toEqual({ status: "none", reason });
  });

  describe("posting", () => {
    beforeEach(() => {
      addReview("r1", { kind: "pull-request", url: PR_URL, number: 7, repo: "acme/payments" });
      for (const line of [11, 12]) {
        insertFinding(
          db,
          "r1",
          {
            severity: "major",
            title: `On ${line}`,
            file: "src/app.ts",
            line,
            problem: "p",
            suggestion: "s",
            reproduction: "",
          },
          new Date(AT),
        );
      }
      setVerdict(db, "r1", 1, "accepted", new Date(AT));
      setVerdict(db, "r1", 2, "accepted", new Date(AT));
    });

    it("keeps what landed when a post stops part-way, and offers only the rest again", async () => {
      fake.onPost = (n) => {
        if (n === 2) throw new AppFailure("bitbucket_failed", "Bitbucket answered 500");
        return { id: n, created_on: "2026-11-20T11:00:00.000000+00:00" };
      };
      await expect(
        service.post({
          id: "r1",
          event: "COMMENT",
          body: "",
          findings: [
            { number: 1, text: "one" },
            { number: 2, text: "two" },
          ],
        }),
      ).rejects.toMatchObject({ code: "post_partial" });

      const preview = await service.preview("r1");
      if (preview.status !== "ok") throw new Error(preview.status);
      expect(preview.items.map((i) => [i.number, i.postedUrl, i.selected])).toEqual([
        [1, `${PR_URL}#comment-1`, false],
        [2, null, true],
      ]);
      // What landed is in Activity, with Bitbucket's own time.
      expect(activity.list().map((item) => item.detail)).toEqual([
        expect.objectContaining({
          kind: "posted",
          findings: 1,
          submittedAt: "2026-11-20T11:00:00.000000+00:00",
        }),
      ]);
    });

    it("never lists the user's own comments as new, even when Bitbucket's clock is ahead", async () => {
      await service.conversation("r1");
      fake.onPost = (n) => ({ id: n, created_on: "2099-01-01T00:00:00+00:00" });
      await service.post({
        id: "r1",
        event: "COMMENT",
        body: "",
        findings: [{ number: 1, text: "one" }],
      });
      fake.comments = [
        {
          id: 1,
          content: { raw: "one" },
          user: { display_name: "Me" },
          created_on: "2099-01-01T00:00:00+00:00",
          inline: { path: "src/app.ts", to: 11 },
        },
      ];
      await service.conversation("r1");
      expect(activity.list().map((item) => item.detail.kind)).toEqual(["posted"]);
    });
  });
});
