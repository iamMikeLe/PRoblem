import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  fileDiff,
  MAX_DIFF_BYTES,
  parseUnifiedDiff,
} from "../../../src/main/git/diff.ts";
import { git, makeTempDir } from "../gitFixture.ts";

describe("parseUnifiedDiff", () => {
  it("numbers lines on both sides across hunks and skips no-newline markers", () => {
    const out = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@ function x() {",
      " one",
      "-two",
      "+TWO",
      " three",
      "@@ -10,2 +10,3 @@",
      " ten",
      "+ten and a half",
      " eleven",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const diff = parseUnifiedDiff("a.ts", out);
    expect(diff.binary).toBe(false);
    expect(diff.hunks.map((h) => h.header)).toEqual([
      "@@ -1,3 +1,3 @@ function x() {",
      "@@ -10,2 +10,3 @@",
    ]);
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "one" },
      { kind: "del", oldLine: 2, newLine: null, text: "two" },
      { kind: "add", oldLine: null, newLine: 2, text: "TWO" },
      { kind: "context", oldLine: 3, newLine: 3, text: "three" },
    ]);
    expect(diff.hunks[1]?.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["context", 10, 10],
      ["add", null, 11],
      ["context", 11, 12],
    ]);
  });

  it("reads hunks by their line counts: blank context lines, CRLF, and never a second file", () => {
    const out = [
      "@@ -1,3 +1,3 @@",
      " a",
      "",
      "-b\r",
      "+B\r",
      "diff --git a/other b/other",
      "--- a/other",
      "+++ b/other",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    const diff = parseUnifiedDiff("a.ts", out);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "a" },
      { kind: "context", oldLine: 2, newLine: 2, text: "" },
      { kind: "del", oldLine: 3, newLine: null, text: "b" },
      { kind: "add", oldLine: null, newLine: 3, text: "B" },
    ]);
  });

  it("recognizes binary files and keeps lines that look like headers inside a hunk", () => {
    expect(parseUnifiedDiff("x.png", "Binary files a/x.png and b/x.png differ\n").binary).toBe(
      true,
    );
    const diff = parseUnifiedDiff("a.md", "@@ -0,0 +1,2 @@\n+--- not a header\n++++ neither\n");
    expect(diff.hunks[0]?.lines.map((l) => l.text)).toEqual(["--- not a header", "+++ neither"]);
  });
});

describe("changed files between two commits", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let base: string;
  let head: string;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir("problem-diff-"));
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "keep.ts"), "a\nb\nc\n");
    writeFileSync(join(dir, "old name.ts"), `${"same line\n".repeat(20)}`);
    writeFileSync(join(dir, "gone.txt"), "bye\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "keep.ts"), "a\nB\nc\nd");
    git(dir, "mv", "old name.ts", "new name.ts");
    git(dir, "rm", "-q", "gone.txt");
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0]));
    writeFileSync(join(dir, "huge.txt"), "x".repeat(MAX_DIFF_BYTES + 10));
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "head");
    head = git(dir, "rev-parse", "HEAD");
  });

  afterEach(() => cleanup());

  it("lists added, modified, renamed, deleted and binary files with counts", async () => {
    const files = await changedFiles(dir, base, head);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["keep.ts"]).toEqual({
      path: "keep.ts",
      oldPath: null,
      status: "modified",
      additions: 2,
      deletions: 1,
    });
    expect(byPath["new name.ts"]).toEqual({
      path: "new name.ts",
      oldPath: "old name.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
    });
    expect(byPath["gone.txt"]).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
    expect(byPath["image.png"]).toMatchObject({
      status: "added",
      additions: null,
      deletions: null,
    });
    expect(byPath["huge.txt"]).toMatchObject({ status: "added", additions: 1 });
  });

  it("diffs one file, and gives up on huge ones", async () => {
    const files = await changedFiles(dir, base, head);
    const file = (path: string) => {
      const found = files.find((f) => f.path === path);
      if (!found) throw new Error(path);
      return found;
    };
    const keep = await fileDiff(dir, base, head, file("keep.ts"));
    expect(keep.hunks[0]?.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "context:a",
      "del:b",
      "add:B",
      "context:c",
      "add:d",
    ]);
    expect((await fileDiff(dir, base, head, file("new name.ts"))).hunks).toEqual([]);
    expect((await fileDiff(dir, base, head, file("image.png"))).binary).toBe(true);
    expect(await fileDiff(dir, base, head, file("huge.txt"))).toEqual({
      path: "huge.txt",
      binary: false,
      tooLarge: true,
      hunks: [],
    });
  });

  it("treats file names literally (a PR can add a file called *.md) and keeps tabs in names", async () => {
    writeFileSync(join(dir, "*.md"), "star\n");
    writeFileSync(join(dir, "b.md"), "bee\n");
    writeFileSync(join(dir, "tab\there.txt"), "x\ny\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "more");
    const next = git(dir, "rev-parse", "HEAD");
    const files = await changedFiles(dir, head, next);
    const star = files.find((f) => f.path === "*.md");
    if (!star) throw new Error("*.md");
    const diff = await fileDiff(dir, head, next, star);
    expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toEqual(["star"]);
    expect(files.find((f) => f.path === "tab\there.txt")).toMatchObject({
      additions: 2,
      deletions: 0,
    });
  });

  it("runs no diff driver or text converter the repository configures", async () => {
    writeFileSync(join(dir, ".gitattributes"), "*.ts diff=evil\n");
    git(dir, "config", "diff.evil.textconv", "sh -c 'echo PWNED > pwned.txt; cat'");
    git(dir, "config", "diff.evil.command", "sh -c 'echo PWNED > pwned2.txt'");
    const files = await changedFiles(dir, base, head);
    const keep = files.find((f) => f.path === "keep.ts");
    if (!keep) throw new Error("keep.ts");
    await fileDiff(dir, base, head, keep);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, "pwned.txt")) || existsSync(join(dir, "pwned2.txt"))).toBe(false);
  });
});
