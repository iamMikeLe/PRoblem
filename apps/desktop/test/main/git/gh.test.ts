import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGhClient } from "../../../src/main/git/gh.ts";

/** A fake `gh` on PATH: logs its arguments and stdin, prints `$FAKE_GH_OUT`, exits `$FAKE_GH_EXIT`. */
describe("gh client", () => {
  let dir: string;
  let path: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "problem-gh-"));
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/args"\ncat > "${dir}/stdin"\nprintf '%s' "$FAKE_GH_OUT"\nexit "\${FAKE_GH_EXIT:-0}"\n`,
    );
    chmodSync(join(dir, "gh"), 0o755);
    path = process.env.PATH;
    process.env.PATH = `${dir}:${path ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = path;
    delete process.env.FAKE_GH_OUT;
    delete process.env.FAKE_GH_EXIT;
    rmSync(dir, { recursive: true, force: true });
  });

  const args = () => readFileSync(join(dir, "args"), "utf8").trim().split("\n");
  const pr = (number: number, cross: boolean) => ({
    number,
    title: "t",
    url: `https://github.com/acme/payments/pull/${number}`,
    headRefName: "feature",
    headRefOid: "a".repeat(40),
    baseRefName: "main",
    isCrossRepository: cross,
  });

  it("passes strings raw (-f, never read as @file) and numbers typed (-F)", async () => {
    process.env.FAKE_GH_OUT = "{}";
    await createGhClient().graphql("query { x }", { owner: "@etc/passwd", number: 7 });
    expect(args()).toEqual([
      "api",
      "graphql",
      "-f",
      "query=query { x }",
      "-f",
      "owner=@etc/passwd",
      "-F",
      "number=7",
    ]);
  });

  it("leaves out pull requests from forks with the same branch name", async () => {
    process.env.FAKE_GH_OUT = JSON.stringify([pr(1, true), pr(2, false)]);
    const list = await createGhClient().pullRequestsForBranch("acme/payments", "feature");
    expect(list.map((p) => p.number)).toEqual([2]);
    expect(args().join(" ")).toContain("isCrossRepository");
    expect(args().join(" ")).toContain("--head feature");
  });

  it("posts JSON on stdin and reports GitHub's own error message", async () => {
    process.env.FAKE_GH_OUT = JSON.stringify({ html_url: "https://github.com/x" });
    await createGhClient().postReview("acme/payments", 7, { event: "COMMENT" });
    expect(args()).toEqual([
      "api",
      "--method",
      "POST",
      "repos/acme/payments/pulls/7/reviews",
      "--input",
      "-",
    ]);
    expect(JSON.parse(readFileSync(join(dir, "stdin"), "utf8"))).toEqual({ event: "COMMENT" });

    process.env.FAKE_GH_OUT = JSON.stringify({
      message: "Unprocessable Entity",
      errors: ["Can not approve your own pull request"],
    });
    process.env.FAKE_GH_EXIT = "1";
    await expect(createGhClient().postReview("acme/payments", 7, {})).rejects.toMatchObject({
      code: "gh_failed",
      message: expect.stringContaining("Can not approve your own pull request"),
    });
  });

  it("says a post is uncertain when GitHub's answer cannot be read", async () => {
    process.env.FAKE_GH_OUT = "not json";
    await expect(createGhClient().postReview("acme/payments", 7, {})).rejects.toMatchObject({
      code: "post_uncertain",
    });
  });
});
