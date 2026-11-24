import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createBitbucketApi,
  MAX_PAGES,
  testBitbucketConnection,
} from "../../../src/main/pullrequests/bitbucketApi.ts";

const CREDENTIALS = { email: "me@example.com", token: "ATATT-token" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function setup(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    answer(String(input), init ?? {}),
  );
  const api = createBitbucketApi({ fetch, credentials: () => CREDENTIALS, timeoutMs: 50 });
  return { api, fetch };
}

const Item = z.object({ id: z.number() });

describe("Bitbucket API client", () => {
  it("sends Basic auth to the API, refuses redirects and validates the answer", async () => {
    const { api, fetch } = setup(() => json({ id: 7 }));
    expect(await api.get("/repositories/acme/payments/pullrequests/7", Item)).toEqual({ id: 7 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.bitbucket.org/2.0/repositories/acme/payments/pullrequests/7");
    expect(init?.redirect).toBe("error");
    const auth = new Headers(init?.headers).get("authorization");
    expect(auth).toBe(`Basic ${Buffer.from("me@example.com:ATATT-token").toString("base64")}`);
  });

  it("says when no credentials are saved, without calling Bitbucket", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createBitbucketApi({ fetch, credentials: () => undefined });
    await expect(api.get("/user", Item)).rejects.toMatchObject({
      code: "bitbucket_not_configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows next links on the API and stops after the page limit", async () => {
    let page = 0;
    const { api, fetch } = setup(() => {
      page++;
      return json({
        values: [{ id: page }],
        next: `https://api.bitbucket.org/2.0/repositories/acme/payments/pullrequests?page=${page + 1}`,
      });
    });
    const result = await api.list("/repositories/acme/payments/pullrequests", Item);
    expect(result.values).toHaveLength(MAX_PAGES);
    expect(result.truncated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(MAX_PAGES);

    const short = setup(() => json({ values: [{ id: 1 }] }));
    expect(await short.api.list("/x", Item)).toEqual({ values: [{ id: 1 }], truncated: false });
  });

  it("never sends the credentials to a next link off the API", async () => {
    for (const next of [
      "https://evil.example/2.0/x",
      "http://api.bitbucket.org/2.0/x",
      "https://api.bitbucket.org.evil.io/2.0/x",
      "https://u:p@api.bitbucket.org/2.0/x",
      "https://api.bitbucket.org:8443/2.0/x",
      "https://api.bitbucket.org/1.0/x",
      "not a url",
    ]) {
      const { api, fetch } = setup(() => json({ values: [{ id: 1 }], next }));
      await expect(api.list("/x", Item), next).rejects.toMatchObject({ code: "bitbucket_failed" });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("explains Bitbucket's errors", async () => {
    const cases: [Response, string, RegExp][] = [
      [json({}, 401), "bitbucket_auth_failed", /email and API token/],
      [
        json({ error: { message: "missing scope" } }, 403),
        "bitbucket_forbidden",
        /missing scope.*scopes/,
      ],
      [json({}, 404), "bitbucket_failed", /did not find/],
      [json({}, 429, { "retry-after": "30" }), "bitbucket_rate_limited", /in 30 s/],
      [json({}, 429), "bitbucket_rate_limited", /later/],
      [json({ error: { message: "boom" } }, 500), "bitbucket_failed", /500: boom/],
      [json({ unexpected: true }), "bitbucket_failed", /unexpected answer/],
      [new Response("<html>", { status: 200 }), "bitbucket_failed", /unexpected answer/],
    ];
    for (const [response, code, message] of cases) {
      const { api } = setup(() => response);
      await expect(api.get("/x", Item)).rejects.toMatchObject({
        code,
        message: expect.stringMatching(message),
      });
    }
  });

  it("tells unreachable from timed out, and a timed-out write is uncertain", async () => {
    const offline = setup(() => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.api.get("/x", Item)).rejects.toMatchObject({
      code: "bitbucket_unreachable",
    });
    // A dropped connection before the write: Bitbucket did not get it.
    await expect(offline.api.post("/x", {}, Item)).rejects.toMatchObject({
      code: "bitbucket_unreachable",
    });

    const slow = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(slow.api.get("/x", Item)).rejects.toMatchObject({ code: "bitbucket_unreachable" });
    await expect(slow.api.post("/x", {}, Item)).rejects.toMatchObject({ code: "post_uncertain" });
  });

  it("posts JSON, and an accepted write it cannot read is uncertain", async () => {
    const { api, fetch } = setup(() => json({ id: 3 }, 201));
    expect(await api.post("/c", { content: { raw: "hi" } }, Item)).toEqual({ id: 3 });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ content: { raw: "hi" } }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");

    const odd = setup(() => new Response("", { status: 201 }));
    await expect(odd.api.post("/c", {}, Item)).rejects.toMatchObject({ code: "post_uncertain" });
    const refused = setup(() => json({}, 400));
    await expect(refused.api.post("/c", {}, Item)).rejects.toMatchObject({
      code: "bitbucket_failed",
    });
  });
});

describe("Bitbucket connection test", () => {
  it("names the account, accepts a token without profile access, and explains failures", async () => {
    const ok = setup(() => json({ display_name: "Mike" }));
    expect(await testBitbucketConnection(ok.api)).toEqual({
      ok: true,
      message: "Connected to Bitbucket as Mike.",
    });
    const scoped = setup(() => json({}, 403));
    expect(await testBitbucketConnection(scoped.api)).toMatchObject({ ok: true });
    const wrong = setup(() => json({}, 401));
    expect(await testBitbucketConnection(wrong.api)).toEqual({
      ok: false,
      message: expect.stringMatching(/refused the email and API token/),
    });
    const none = createBitbucketApi({ fetch: vi.fn(), credentials: () => undefined });
    expect(await testBitbucketConnection(none)).toMatchObject({ ok: false, message: /Settings/ });
  });
});
