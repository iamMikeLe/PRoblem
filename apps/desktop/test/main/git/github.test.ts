import { describe, expect, it } from "vitest";
import { githubRepoOf, parsePullRequestUrl } from "../../../src/main/git/github.ts";

describe("parsePullRequestUrl", () => {
  it("parses PR links, also with a tab path, query or hash", () => {
    for (const url of [
      "https://github.com/acme/payments/pull/7",
      "https://github.com/acme/payments/pull/7/files?w=1#diff",
      "  https://GitHub.com/acme/payments/pull/7  ",
    ]) {
      expect(parsePullRequestUrl(url), url).toEqual({ owner: "acme", repo: "payments", number: 7 });
    }
  });

  it("rejects other hosts, schemes and paths", () => {
    for (const url of [
      "http://github.com/acme/payments/pull/7",
      "https://github.com.evil.example/acme/payments/pull/7",
      "https://github.com/acme/payments/issues/7",
      "https://github.com/acme/payments/pull/0",
      "feature/branch",
    ]) {
      expect(parsePullRequestUrl(url), url).toBeUndefined();
    }
  });
});

describe("githubRepoOf", () => {
  it("reads owner/repo from https, ssh and scp-like remotes", () => {
    for (const url of [
      "https://github.com/Acme/Payments.git",
      "https://token@github.com/acme/payments",
      "ssh://git@github.com/acme/payments.git",
      "git@github.com:acme/payments.git",
    ]) {
      expect(githubRepoOf(url), url).toBe("acme/payments");
    }
  });

  it("ignores other hosts", () => {
    expect(githubRepoOf("git@gitlab.com:acme/payments.git")).toBeUndefined();
    expect(githubRepoOf("/srv/git/payments.git")).toBeUndefined();
  });
});
