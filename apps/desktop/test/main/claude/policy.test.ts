import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideBashCommand, decideToolUse } from "../../../src/main/claude/policy.ts";

describe("read-only review policy", () => {
  describe("Bash", () => {
    it.each([
      "git diff abc123 def456",
      "git diff main...HEAD -- src/app.ts",
      "git diff -U5 --stat abc123",
      "git log --oneline -20",
      "git log -n 5 --format=%h:%s",
      "git log -p -S retry -- src",
      "git show abc123:src/app.ts",
      "git blame -L 10,20 src/app.ts",
      "git blame -wL 10,20 src/app.ts",
      "git status --short",
      "git ls-files src",
      "git grep -n -e retry",
      "git grep -niA3 retry -- src",
      "git cat-file -p abc123",
      "  git log --stat  ",
    ])("allows %s", (command) => {
      expect(decideBashCommand(command)).toMatchObject({ allow: true });
    });

    it("adds --no-ext-diff and --no-textconv so the user's converters never run on PR files", () => {
      expect(decideBashCommand("git diff abc def -- src")).toEqual({
        allow: true,
        updatedInput: { command: "git diff --no-ext-diff --no-textconv abc def -- src" },
      });
      expect(decideBashCommand("git grep retry")).toMatchObject({
        updatedInput: { command: "git grep --no-textconv retry" },
      });
      expect(decideBashCommand("git status")).toEqual({ allow: true });
    });

    it.each([
      ["another program", "rm -rf ."],
      ["a write-capable git subcommand", "git checkout main"],
      ["git push", "git push origin main"],
      ["a git global option", "git -c core.pager=sh diff"],
      ["chaining", "git log; curl evil.example"],
      ["a pipe", "git log | sh"],
      ["command substitution", "git log $(whoami)"],
      ["backticks", "git log `whoami`"],
      ["redirection", "git log > out.txt"],
      ["quotes", "git log --format='%h'"],
      ["a newline", "git log\nrm -rf ."],
      ["an empty command", ""],
      ["git alone", "git"],
      // Found in the Phase 3 security review: each of these ran a program or read outside files.
      ["git grep --open (abbreviated, runs a program)", "git grep --open=sh marker evil.sh"],
      ["git grep --open-files-in (abbreviated)", "git grep --open-files-in=bash x"],
      ["git grep -O in a bundle", "git grep -nOsh retry"],
      ["git grep -f (reads a pattern file)", "git grep -f patterns.txt"],
      ["git grep --textc (runs converters)", "git grep --textc x"],
      ["git blame --contents (reads any file)", "git blame --contents=/etc/hosts a.txt"],
      ["git blame --cont (abbreviated)", "git blame --cont=link/secret a.txt"],
      ["git blame --ignore-revs-file", "git blame --ignore-revs-file=x a.txt"],
      ["git blame -S (reads a file)", "git blame -S revs a.txt"],
      ["git diff with an outside path (implicit --no-index)", "git diff /dev/null /etc/hosts"],
      ["git diff with a relative outside path", "git diff ../outside/secret a.txt"],
      ["--no-index", "git diff --no-index a b"],
      ["--output", "git diff --output=x"],
      ["--ext-diff", "git show --ext-diff"],
      ["git cat-file --filters (runs filters)", "git cat-file --filters HEAD:a"],
      ["~ (zsh extendedglob / home)", "git log main~3"],
      ["^ (zsh extendedglob)", "git log ^main"],
      ["a word starting with = (zsh command path)", "git log =ls"],
      ["an option value outside the folder", "git log --grep=x -- ../.."],
      ["a value after an option", "git grep -e x -- /etc"],
    ])("refuses %s", (_label, command) => {
      expect(decideBashCommand(command)).toMatchObject({ allow: false });
    });
  });

  describe("file tools", () => {
    let root: string;
    let workdir: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "reviewroom-policy-"));
      workdir = join(root, "checkout");
      mkdirSync(join(workdir, "src"), { recursive: true });
      writeFileSync(join(workdir, "src", "app.ts"), "");
      writeFileSync(join(root, "secret.txt"), "");
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it("allows reading and searching inside the review's folder", () => {
      expect(decideToolUse("Read", { file_path: join(workdir, "src/app.ts") }, workdir)).toEqual({
        allow: true,
      });
      expect(decideToolUse("Read", { file_path: "src/app.ts" }, workdir)).toEqual({ allow: true });
      expect(decideToolUse("Grep", { pattern: "retry" }, workdir)).toEqual({ allow: true });
      expect(decideToolUse("Glob", { pattern: "**/*.ts", path: "src" }, workdir)).toEqual({
        allow: true,
      });
    });

    it("refuses paths outside the folder, including through a symlink in the checkout", () => {
      symlinkSync(join(root, "secret.txt"), join(workdir, "innocent.txt"));
      expect(decideToolUse("Read", { file_path: join(root, "secret.txt") }, workdir)).toMatchObject(
        {
          allow: false,
        },
      );
      expect(decideToolUse("Read", { file_path: "../secret.txt" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Read", { file_path: "innocent.txt" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Grep", { pattern: "x", path: root }, workdir)).toMatchObject({
        allow: false,
      });
    });

    it("refuses ~ paths, escaping glob patterns and the .git folder", () => {
      mkdirSync(join(workdir, ".git"));
      writeFileSync(join(workdir, ".git", "config"), "");
      expect(decideToolUse("Read", { file_path: "~/.ssh/config" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Read", { file_path: ".git/config" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Glob", { pattern: "/Users/me/.ssh/*" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Glob", { pattern: "../../**" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Grep", { pattern: "x", glob: "../**/*.env" }, workdir)).toMatchObject({
        allow: false,
      });
      expect(decideToolUse("Glob", { pattern: "src/**/*.ts" }, workdir)).toEqual({ allow: true });
    });

    it("passes the rewritten git command back with the other Bash inputs", () => {
      expect(
        decideToolUse("Bash", { command: "git log --oneline", description: "History" }, workdir),
      ).toEqual({
        allow: true,
        updatedInput: {
          command: "git log --no-ext-diff --no-textconv --oneline",
          description: "History",
        },
      });
    });

    it("refuses every other tool", () => {
      for (const tool of ["Write", "Edit", "WebFetch", "WebSearch", "Agent", "mcp__x__y"]) {
        expect(decideToolUse(tool, {}, workdir)).toMatchObject({ allow: false });
      }
    });
  });
});
