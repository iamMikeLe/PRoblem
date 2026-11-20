import { describe, expect, it } from "vitest";
import { bitbucketRepoOf, parseBitbucketPullRequestUrl } from "../../../src/main/git/bitbucket.ts";

describe("parseBitbucketPullRequestUrl", () => {
  it("reads the workspace, repository and number", () => {
    for (const url of [
      "https://bitbucket.org/acme/payments/pull-requests/7",
      "https://bitbucket.org/acme/payments/pull-requests/7/",
      "https://bitbucket.org/acme/payments/pull-requests/7/diff",
      "https://bitbucket.org/acme/payments/pull-requests/7?w=1#comment-3",
      "  https://BITBUCKET.org/acme/payments/pull-requests/7  ",
    ]) {
      expect(parseBitbucketPullRequestUrl(url), url).toEqual({
        owner: "acme",
        repo: "payments",
        number: 7,
      });
    }
  });

  it("refuses other hosts, look-alikes and other pages", () => {
    for (const url of [
      "http://bitbucket.org/acme/payments/pull-requests/7",
      "https://bitbucket.org.evil.io/acme/payments/pull-requests/7",
      "https://api.bitbucket.org/acme/payments/pull-requests/7",
      "https://me:pw@bitbucket.org/acme/payments/pull-requests/7",
      "https://bitbucket.org/acme/payments/pull-requests/0",
      "https://bitbucket.org/acme/payments/pull-requests/abc",
      "https://bitbucket.org/acme/payments/branch/feature",
      "https://github.com/acme/payments/pull/7",
      "#7",
      "not a url",
    ]) {
      expect(parseBitbucketPullRequestUrl(url), url).toBeUndefined();
    }
  });
});

describe("bitbucketRepoOf", () => {
  it("reads every form of a Bitbucket Cloud remote", () => {
    for (const url of [
      "https://bitbucket.org/acme/payments.git",
      "https://bitbucket.org/acme/payments",
      "https://mike@bitbucket.org/Acme/Payments.git",
      "ssh://git@bitbucket.org/acme/payments.git",
      "git@bitbucket.org:acme/payments.git",
      "git@bitbucket.org:acme/payments",
    ]) {
      expect(bitbucketRepoOf(url), url).toBe("acme/payments");
    }
    expect(bitbucketRepoOf("git@bitbucket.org:acme/my.lib.git")).toBe("acme/my.lib");
  });

  it("is undefined for other hosts and look-alikes", () => {
    for (const url of [
      "git@github.com:acme/payments.git",
      "https://bitbucket.org.evil.io/acme/payments.git",
      "https://evilbitbucket.org/acme/payments.git",
      "http://bitbucket.org/acme/payments.git",
      "https://bitbucket.example.com/scm/acme/payments.git",
      "git@bitbucket.org:acme.git",
      "/local/path",
    ]) {
      expect(bitbucketRepoOf(url), url).toBeUndefined();
    }
  });
});
