# 0010. How a review runs Claude

- Status: accepted
- Date: 2026-11-18

## Context
Phase 3 gives every review a Claude Code session through the Claude Agent SDK. Claude reads code
written by someone else, so the session must not run anything the pull request controls. The
approval cards of the permission gate (ADR 0005) arrive only in Phase 5.

A pull request can ship `.claude/settings.json`. Claude Code runs the hooks in it as shell commands.
A control run confirmed this: with `settingSources: ["user", "project"]` in a checkout of such a
branch, its `SessionStart` and `UserPromptSubmit` hooks ran. With `["user"]`, nothing ran.

## Options
1. **Run the SDK's bundled `claude` binary.** It works even without Claude Code installed. Con:
   a 350 MB download per platform, and its own login.
2. **Run the user's installed `claude`** (`pathToClaudeCodeExecutable`, found on the login-shell
   PATH). Con: Claude Code must be installed; a missing binary must be explained in the UI.

For the tool policy until Phase 5:

1. **Deny everything that is not read-only** (an app-owned `PreToolUse` hook plus a narrow
   `tools` list). Con: Claude cannot run tests yet.
2. **Bring the approval cards forward from Phase 5.** Con: Phase 3 becomes twice as big.

## Decision
- Run the user's installed `claude` (option 2). It uses their login and the package stays small.
- **One `query()` per turn**, with `resume: sessionId` after the first turn. The session id is
  stored on the review, so a conversation continues after the app restarts.
- **At most 3 turns run at once.** The others wait as `queued`, and Stop can remove them from the queue.
- **Read-only until Phase 5:**
  - Allowed tools: `tools: ["Read", "Grep", "Glob", "Bash"]`. A `PreToolUse` hook (`claude/policy.ts`) then decides each call:
    - Read, Grep and Glob only inside the review's folder, never in its `.git`, never with `~`.
      Symlinks are resolved, so a link in the PR cannot point Read outside the folder. Glob and
      Grep patterns must be relative and contain no `..` segment.
    - Bash only for git, through an **allowlist per subcommand**: `diff`, `log`, `show`, `blame`,
      `status`, `ls-files`, `ls-tree`, `rev-parse`, `merge-base`, `grep`, `cat-file`, `shortlog`,
      each with the options it may take. Path and revision arguments must not be absolute or
      contain `..` segments. Commands contain no shell syntax at all, and no `~` or `^`, which
      zsh's `extendedglob` would treat as glob operators.
    - Allowed git commands are rewritten (`updatedInput`) to add `--no-ext-diff --no-textconv`,
      so converters the user configured never run on PR files.
    - Everything else is denied, with a reason Claude can see.
  - `canUseTool` denies anything that still reaches a permission prompt.
  - `permissionMode: "default"`, so the user's own `defaultMode` (for example `bypassPermissions`) never applies.
  - `settings: { disableAllHooks: false }`, so the user's settings cannot switch the gate off.
  - The Claude process gets no inherited `GIT_*` variables, plus `GIT_LFS_SKIP_SMUDGE=1`.
- **No settings from the checkout:**
  - `settingSources: ["user"]`, plus `strictMcpConfig` with no MCP servers. A PR's `.claude/` folder, `.mcp.json` and `CLAUDE.md` are never loaded.
  - Project-level settings loaded from the main checkout are deferred to Phase 5.
- **The UI never sees SDK shapes:**
  - `claude/normalize.ts` validates each SDK message it uses with zod and turns it into a `ConversationEntry`.
  - Entries are appended to `review_entries` and broadcast.
  - Text deltas (`includePartialMessages`) are broadcast for live display only. They are never stored.

## Why an allowlist (security review, 2026-11-18)
The first version refused known-bad git options. A review found three bypasses, and all of them were reproduced:
- `git grep --open=sh marker evil.sh` runs a PR file as a script. Git accepts abbreviated long
  options, and `--open` is short for `--open-files-in-pager`.
- `git blame --contents=<file>` and `--ignore-revs-file` read files outside the checkout.
- `git diff /dev/null <outside file>` switches to no-index mode by itself.

Refusing options can never be complete, so each subcommand now lists what it accepts. Every
bypass is a regression test in `policy.test.ts`. A real turn confirmed two more things:
- Claude Code expands `~` before the hook sees it.
- Its Grep and Glob do not follow a symlinked folder in the checkout.

## Consequences
- Reviews read code and run git, but cannot run tests, edit or reach the network until Phase 5.
- The git allowlist and the path check are security-critical. They have their own tests
  (`test/main/claude/policy.test.ts`), and the Phase 5 audit covers them.
- A user without Claude Code sees a clear error turn instead of a crash.
- The user's own Claude Code settings (their hooks and plugins) still apply. That is their choice
  on their machine.
- Residual risks:
  - A *clean* filter the user configured can still run when Claude's `git diff` or `git status`
    looks at a worktree file the PR assigns to that filter. This is the same class as ADR 0009.
  - That `settings.disableAllHooks: false` overrides a user-level `true` is assumed from Claude
    Code's settings precedence, not tested.
