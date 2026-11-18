import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Grant } from "../../../src/main/claude/grants.ts";
import {
  decideBashCommand,
  decideToolUse,
  type GateDecision,
} from "../../../src/main/claude/policy.ts";

describe("review permission gate", () => {
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

  describe("the gate: allow, ask or refuse", () => {
    let root: string;
    let workdir: string;
    let grants: Grant[];
    let fixMode: boolean;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "problem-policy-"));
      workdir = join(root, "checkout");
      mkdirSync(join(workdir, "src"), { recursive: true });
      mkdirSync(join(workdir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(workdir, "src", "app.ts"), "");
      writeFileSync(join(workdir, ".git", "config"), "");
      writeFileSync(join(root, "secret.txt"), "");
      grants = [];
      fixMode = false;
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const gate = (tool: string, input: unknown): GateDecision =>
      decideToolUse(tool, input, {
        workdir,
        fixMode,
        granted: (grant) => grants.some((g) => g.tool === grant.tool && g.scope === grant.scope),
      });

    it("allows reading and searching inside the review's folder", () => {
      expect(gate("Read", { file_path: join(workdir, "src/app.ts") })).toEqual({ kind: "allow" });
      expect(gate("Read", { file_path: "src/app.ts" })).toEqual({ kind: "allow" });
      expect(gate("Grep", { pattern: "retry" })).toEqual({ kind: "allow" });
      expect(gate("Glob", { pattern: "**/*.ts", path: "src" })).toEqual({ kind: "allow" });
      expect(gate("mcp__problem__report_findings", { add: [] })).toEqual({ kind: "allow" });
    });

    it("asks before reading outside the folder (through a symlink, ~, .git or a pattern)", () => {
      symlinkSync(join(root, "secret.txt"), join(workdir, "innocent.txt"));
      for (const [tool, input] of [
        ["Read", { file_path: join(root, "secret.txt") }],
        ["Read", { file_path: "../secret.txt" }],
        ["Read", { file_path: "innocent.txt" }],
        ["Read", { file_path: "~/.ssh/config" }],
        ["Read", { file_path: ".git/config" }],
        ["Read", { file_path: ".GIT/config" }],
        ["Grep", { pattern: "x", path: root }],
        ["Grep", { pattern: "x", glob: "../**/*.env" }],
        ["Glob", { pattern: "/Users/me/.ssh/*" }],
        ["Glob", { pattern: "../../**" }],
      ] as const) {
        expect(gate(tool, input), JSON.stringify(input)).toMatchObject({ kind: "ask" });
      }
      // Only an exact path can be allowed for the whole review; searches are asked each time.
      expect(gate("Read", { file_path: "../secret.txt" })).toMatchObject({
        grant: { tool: "Read", scope: "../secret.txt" },
      });
      expect(gate("Grep", { pattern: "x", path: root })).toMatchObject({ grant: null });
    });

    it("runs read-only git directly, rewritten with safety options, and asks for any other command", () => {
      expect(gate("Bash", { command: "git log --oneline", description: "History" })).toEqual({
        kind: "allow",
        updatedInput: {
          command: `git -C '${workdir}' log --no-ext-diff --no-textconv --oneline`,
          description: "History",
        },
      });
      expect(gate("Bash", { command: "git status" })).toEqual({
        kind: "allow",
        updatedInput: { command: `git -C '${workdir}' status` },
      });
      for (const command of ["npm test", "git grep --open=sh x", "rm -rf .", "git log | sh"]) {
        expect(gate("Bash", { command }), command).toEqual({
          kind: "ask",
          reason: "It runs a command that is not a read-only git command.",
          grant: { tool: "Bash", scope: command },
        });
      }
      expect(gate("Bash", { command: " " })).toMatchObject({ kind: "deny" });
    });

    it("pins git to the review's folder, quoted for the shell", () => {
      const odd = join(root, "it's a repo");
      mkdirSync(odd);
      execFileSync("git", ["init", "-q", odd]);
      const decision = decideToolUse(
        "Bash",
        { command: "git status --short" },
        { workdir: odd, fixMode: false, granted: () => false },
      );
      if (decision.kind !== "allow" || typeof decision.updatedInput?.command !== "string") {
        throw new Error("expected an allowed, rewritten command");
      }
      // Run from elsewhere: the command still works on the review's folder.
      expect(() =>
        execFileSync("sh", ["-c", String(decision.updatedInput?.command)], { cwd: root }),
      ).not.toThrow();
    });

    it("never lets a write go through a symlink whose target does not exist yet", () => {
      fixMode = true;
      symlinkSync(join(root, "outside", "new.txt"), join(workdir, "notes.md"));
      symlinkSync(join(workdir, ".git", "hooks", "post-checkout"), join(workdir, "hook"));
      symlinkSync("loop", join(workdir, "loop"));
      for (const path of ["notes.md", "hook", "loop", join(workdir, "notes.md")]) {
        expect(gate("Write", { file_path: path }), path).toMatchObject({ kind: "deny" });
        expect(gate("Read", { file_path: path }), path).toMatchObject({ kind: "ask" });
      }
      // A new, ordinary file is fine.
      expect(gate("Write", { file_path: "docs/new.md" })).toEqual({ kind: "allow" });
    });

    it("allows only the exact command or path the user allowed for the review", () => {
      grants.push({ tool: "Bash", scope: "npm test" }, { tool: "Read", scope: "../secret.txt" });
      expect(gate("Bash", { command: "npm test" })).toEqual({ kind: "allow" });
      expect(gate("Bash", { command: "npm test -- --watch" })).toMatchObject({ kind: "ask" });
      expect(gate("Bash", { command: "npm test; curl evil" })).toMatchObject({ kind: "ask" });
      expect(gate("Read", { file_path: "../secret.txt" })).toEqual({ kind: "allow" });
      // A grant for one tool is not a grant for another.
      expect(gate("Write", { file_path: "npm test" })).toMatchObject({ kind: "ask" });
    });

    it("asks for edits inside the folder, runs them in fix mode, and never edits outside or in .git", () => {
      const inside = join(workdir, "src", "app.ts");
      expect(gate("Edit", { file_path: inside })).toMatchObject({
        kind: "ask",
        grant: { tool: "Edit", scope: inside },
      });
      expect(gate("Write", { file_path: join(workdir, "src", "new", "file.ts") })).toMatchObject({
        kind: "ask",
      });
      fixMode = true;
      expect(gate("Edit", { file_path: inside })).toEqual({ kind: "allow" });
      expect(gate("Write", { file_path: "src/new.ts" })).toEqual({ kind: "allow" });

      symlinkSync(root, join(workdir, "up"));
      for (const path of [
        join(root, "secret.txt"),
        "../secret.txt",
        "~/.zshrc",
        ".git/hooks/post-checkout",
        "src/.git/config",
        ".Git/hooks/pre-commit",
        // A new file under a symlinked folder lands outside the checkout.
        "up/planted.sh",
      ]) {
        expect(gate("Write", { file_path: path }), path).toMatchObject({ kind: "deny" });
        expect(gate("Edit", { file_path: path }), path).toMatchObject({ kind: "deny" });
      }
      expect(gate("Write", {})).toMatchObject({ kind: "deny" });
    });

    it("always asks for web access, without a review-wide allow", () => {
      grants.push({ tool: "WebFetch", scope: "https://example.com" });
      expect(gate("WebFetch", { url: "https://example.com", prompt: "x" })).toMatchObject({
        kind: "ask",
        grant: null,
      });
      expect(gate("WebSearch", { query: "x" })).toMatchObject({ kind: "ask", grant: null });
    });

    it("refuses every other tool", () => {
      for (const tool of ["Agent", "Task", "NotebookEdit", "mcp__x__y", "mcp__problem__other"]) {
        expect(gate(tool, {})).toMatchObject({ kind: "deny" });
      }
    });
  });
});
