import { describe, expect, it } from "vitest";
import {
  type GitHost,
  hostByKind,
  hostOfUrl,
  isHttpsLinkTo,
} from "../../../src/main/pullrequests/host.ts";

const fakeHost = (kind: GitHost["kind"], hostname: string): GitHost => ({
  kind,
  repoOfRemote: () => undefined,
  isWebUrl: (url) => isHttpsLinkTo(url, hostname),
  parsePrUrl: () => undefined,
  pullRequestUrl: () => "",
  fetchSource: () => ({ from: "origin", refspec: "" }),
  viewPullRequest: async () => {
    throw new Error("unused");
  },
  openPullRequestsForBranch: async () => [],
  isHead: (a, b) => a === b,
  conversation: async () => ({ status: "none", reason: "unused" }),
  post: async () => ({ url: "", submittedAt: null }),
});

describe("git hosts", () => {
  const hosts = [fakeHost("github", "github.com"), fakeHost("bitbucket", "bitbucket.org")];

  it("finds a host by kind and by the website of a link", () => {
    expect(hostByKind(hosts, "bitbucket")?.kind).toBe("bitbucket");
    expect(hostByKind([], "github")).toBeUndefined();
    expect(hostOfUrl(hosts, "https://github.com/a/b/pull/1")?.kind).toBe("github");
    expect(hostOfUrl(hosts, "https://bitbucket.org/w/r/pull-requests/1")?.kind).toBe("bitbucket");
    expect(hostOfUrl(hosts, "https://gitlab.com/a/b")).toBeUndefined();
  });

  it("accepts only https links to exactly the host, without credentials", () => {
    expect(isHttpsLinkTo("https://bitbucket.org/w/r", "bitbucket.org")).toBe(true);
    for (const bad of [
      "http://bitbucket.org/w/r",
      "https://bitbucket.org.evil.io/w",
      "https://api.bitbucket.org/2.0",
      "https://me:pw@bitbucket.org/w",
      "javascript:alert(1)",
      "nope",
    ]) {
      expect(isHttpsLinkTo(bad, "bitbucket.org"), bad).toBe(false);
    }
  });
});
