import { describe, expect, it } from "vitest";
import { PullRequestLinkSchema } from "../src/pullrequests.ts";

describe("pull request link", () => {
  it("reads a link saved before Bitbucket support as GitHub's", () => {
    const saved = {
      repo: "acme/payments",
      number: 7,
      url: "https://github.com/acme/payments/pull/7",
    };
    expect(PullRequestLinkSchema.parse(saved).host).toBe("github");
  });

  it("keeps the host of a newer link and refuses an unknown one", () => {
    const link = {
      repo: "ws/repo",
      number: 3,
      url: "https://bitbucket.org/ws/repo/pull-requests/3",
    };
    expect(PullRequestLinkSchema.parse({ ...link, host: "bitbucket" }).host).toBe("bitbucket");
    expect(PullRequestLinkSchema.safeParse({ ...link, host: "gitlab" }).success).toBe(false);
  });
});
