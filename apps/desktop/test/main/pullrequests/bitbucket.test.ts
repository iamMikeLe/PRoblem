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
      sourceRepo: "acme/payments",
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

describe("posting to Bitbucket", () => {
  const BASE = "/repositories/acme/payments/pullrequests/7";
  const post = (event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" = "APPROVE") => ({
    pullRequest: link,
    commitId: "c".repeat(40),
    event,
    body: "Summary\n\n---\n\n**Minor: x**",
    inline: [
      { number: 1, path: "src/app.ts", line: 12, text: "one" },
      { number: 2, path: "src/b.ts", line: 3, text: "two" },
    ],
    summaryNumbers: [3],
  });

  /** A fake Bitbucket for writes: `answer(n)` gives the n-th POST's response. */
  function writer(answer: (n: number) => Response | Promise<Response>) {
    const calls: { path: string; body: unknown }[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        path: new URL(String(input)).pathname.replace("/2.0", ""),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const n = calls.length;
      // Like the real fetch: a timeout (abort) rejects a request that has not answered.
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        Promise.resolve(answer(n)).then(resolve, reject);
      });
    });
    const api = createBitbucketApi({
      fetch,
      credentials: () => ({ email: "me@x.io", token: "t" }),
      timeoutMs: 50,
    });
    const marked: [number[], string][] = [];
    return {
      host: createBitbucketHost(api),
      calls,
      marked,
      onPosted: (numbers: number[], url: string) => marked.push([numbers, url]),
    };
  }
  const created = (id: number) => new Response(JSON.stringify({ id }), { status: 201 });

  it("posts each inline finding, then the summary, then the approval", async () => {
    const w = writer((n) => (n <= 3 ? created(100 + n) : new Response("{}", { status: 200 })));
    const result = await w.host.post(post(), w.onPosted);

    expect(w.calls).toEqual([
      {
        path: `${BASE}/comments`,
        body: { content: { raw: "one" }, inline: { path: "src/app.ts", to: 12 } },
      },
      {
        path: `${BASE}/comments`,
        body: { content: { raw: "two" }, inline: { path: "src/b.ts", to: 3 } },
      },
      { path: `${BASE}/comments`, body: { content: { raw: "Summary\n\n---\n\n**Minor: x**" } } },
      { path: `${BASE}/approve`, body: undefined },
    ]);
    expect(w.marked).toEqual([
      [[1], `${PR_URL}#comment-101`],
      [[2], `${PR_URL}#comment-102`],
      [[3], `${PR_URL}#comment-103`],
    ]);
    expect(result).toEqual({ url: `${PR_URL}#comment-103`, submittedAt: null });
  });

  it("requests changes, and posts no verdict for a comment", async () => {
    const changes = writer((n) => (n <= 3 ? created(n) : new Response("{}", { status: 200 })));
    await changes.host.post(post("REQUEST_CHANGES"), changes.onPosted);
    expect(changes.calls.at(-1)?.path).toBe(`${BASE}/request-changes`);

    const comment = writer((n) => created(n));
    await comment.host.post(post("COMMENT"), comment.onPosted);
    expect(comment.calls.map((c) => c.path.split("/").at(-1))).toEqual([
      "comments",
      "comments",
      "comments",
    ]);
  });

  it("stops at a failure, keeps what was posted and never approves", async () => {
    const w = writer((n) =>
      n <= 2
        ? created(n)
        : new Response(JSON.stringify({ error: { message: "bad line" } }), { status: 400 }),
    );
    await expect(w.host.post(post(), w.onPosted)).rejects.toMatchObject({
      code: "post_partial",
      message: expect.stringMatching(/Posted 2 of 4 parts.*bad line.*still selectable/),
    });
    expect(w.marked.map(([numbers]) => numbers)).toEqual([[1], [2]]);
    expect(w.calls.some((c) => c.path.endsWith("/approve"))).toBe(false);

    const first = writer(() => new Response("{}", { status: 401 }));
    await expect(first.host.post(post(), first.onPosted)).rejects.toMatchObject({
      code: "bitbucket_auth_failed",
    });
    expect(first.marked).toEqual([]);
  });

  it("marks a finding whose comment may exist after a timeout", async () => {
    const w = writer((n) =>
      n === 1
        ? created(1)
        : new Promise<Response>(() => {
            // Never answers: the client times out.
          }),
    );
    await expect(w.host.post(post(), w.onPosted)).rejects.toMatchObject({ code: "post_uncertain" });
    expect(w.marked).toEqual([
      [[1], `${PR_URL}#comment-1`],
      [[2], PR_URL],
    ]);
    expect(w.calls).toHaveLength(2);
  });
});
