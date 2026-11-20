import { PrConversationSchema } from "@problem/shared";
import { describe, expect, it, vi } from "vitest";
import { createBitbucketHost } from "../../../src/main/pullrequests/bitbucket.ts";
import { createBitbucketApi } from "../../../src/main/pullrequests/bitbucketApi.ts";

const REPO = "acme/payments";
const PR_URL = "https://bitbucket.org/acme/payments/pull-requests/7";
const HEAD = "0123456789ab";

const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  title: "Retry webhooks",
  source: {
    branch: { name: "feature/retry" },
    commit: { hash: HEAD },
    repository: { full_name: "acme/payments" },
  },
  destination: { branch: { name: "main" } },
  participants: [
    {
      user: { display_name: "Alice" },
      state: "approved",
      participated_on: "2026-11-20T09:00:00.000000+00:00",
    },
    { user: { display_name: "Bob" }, state: null, participated_on: null },
    { user: null, state: "changes_requested", participated_on: "2026-11-20T09:30:00+00:00" },
  ],
  ...overrides,
});

const comment = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  content: { raw: `comment ${id}` },
  user: { display_name: "Alice" },
  created_on: `2026-11-20T10:0${id}:00.000000+00:00`,
  ...fields,
});

/** A fake Bitbucket answering by path; records every URL asked for. */
function host(routes: Record<string, unknown>) {
  const urls: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const path = new URL(url).pathname.replace("/2.0", "");
    if (!(path in routes)) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  });
  const api = createBitbucketApi({ fetch, credentials: () => ({ email: "me@x.io", token: "t" }) });
  return { host: createBitbucketHost(api), urls };
}

const link = { host: "bitbucket", repo: REPO, number: 7, url: PR_URL } as const;

describe("Bitbucket host", () => {
  it("reads a pull request, with its page link built by the app", async () => {
    const { host: bb } = host({
      "/repositories/acme/payments/pullrequests/7": pullRequest({
        links: { html: { href: "https://evil.example/phish" } },
      }),
    });
    expect(await bb.viewPullRequest(REPO, 7)).toEqual({
      number: 7,
      title: "Retry webhooks",
      url: PR_URL,
      headBranch: "feature/retry",
      headSha: HEAD,
      baseBranch: "main",
    });
  });

  it("finds open pull requests of a branch, escaping the query and leaving out forks", async () => {
    const { host: bb, urls } = host({
      "/repositories/acme/payments/pullrequests": {
        values: [
          pullRequest({
            id: 9,
            source: { ...pullRequest().source, repository: { full_name: "someone/payments" } },
          }),
          pullRequest(),
        ],
      },
    });
    const found = await bb.openPullRequestsForBranch(REPO, 'feat/"quoted"\\x');
    expect(found.map((pr) => pr.number)).toEqual([7]);
    const query = new URL(urls[0] ?? "").searchParams;
    expect(query.get("state")).toBe("OPEN");
    expect(query.get("q")).toBe('source.branch.name = "feat/\\"quoted\\"\\\\x"');
  });

  it("compares the short head Bitbucket reports with the review's commit", () => {
    const { host: bb } = host({});
    const full = `${HEAD}${"c".repeat(28)}`;
    expect(bb.isHead(HEAD, full)).toBe(true);
    expect(bb.isHead("fedcba987654", full)).toBe(false);
    expect(bb.isHead("", full)).toBe(false);
  });

  it("maps inline threads, replies, general comments and approvals", async () => {
    const { host: bb } = host({
      "/repositories/acme/payments/pullrequests/7": pullRequest(),
      "/repositories/acme/payments/pullrequests/7/comments": {
        values: [
          comment(1, { inline: { path: "src/app.ts", to: 12 } }),
          comment(2, { parent: { id: 1 }, user: null }),
          comment(3),
          comment(4, { parent: { id: 3 } }),
          comment(5, {
            inline: { path: "src/old.ts", to: null },
            resolution: { type: "resolved" },
          }),
          comment(6, { deleted: true }),
          // A reply whose parent was deleted stands on its own.
          comment(7, { parent: { id: 6 } }),
        ],
      },
    });
    const conversation = await bb.conversation(link);
    if (conversation.status !== "ok") throw new Error(conversation.status);
    expect(conversation.pullRequest).toMatchObject({ host: "bitbucket", headSha: HEAD });
    expect(conversation.threads).toEqual([
      {
        id: "1",
        path: "src/app.ts",
        line: 12,
        isResolved: false,
        isOutdated: false,
        comments: [
          expect.objectContaining({ id: "1", author: "Alice", url: `${PR_URL}#comment-1` }),
          expect.objectContaining({ id: "2", author: "Former user", body: "comment 2" }),
        ],
      },
      expect.objectContaining({ id: "5", line: null, isResolved: true, isOutdated: true }),
    ]);
    expect(conversation.comments.map((c) => c.id)).toEqual(["3", "4", "7"]);
    expect(conversation.reviews).toEqual([
      expect.objectContaining({ author: "Alice", state: "APPROVED", body: "" }),
      expect.objectContaining({ author: "Former user", state: "CHANGES_REQUESTED" }),
    ]);
    expect(conversation.truncated).toBe(false);
    // Bitbucket's times (microseconds, +00:00) fit the shared contract.
    expect(PrConversationSchema.safeParse(conversation).success).toBe(true);
  });

  it("explains a missing or unreachable pull request", async () => {
    const { host: bb } = host({});
    await expect(bb.conversation(link)).rejects.toMatchObject({ code: "bitbucket_failed" });
  });
});
