# Presenting PRoblem

Talking points and a demo script, built from the repository: README, ARCHITECTURE, the ADRs, the
roadmap, `.claude/` and `git log`.

## 1. Pitch (30 seconds)

Reviewing several pull requests with an AI assistant in a terminal means constant context
switching: which review was where, what you asked, which findings you already checked. PRoblem is a
desktop app that gives every review its own room. You start a Claude Code review from a branch or a
PR link, many at once and across repositories. Each review keeps its own live conversation and a
list of numbered findings that you accept, dismiss or ask about. Claude is read-only unless you
approve more. Nothing reaches GitHub until you click Post.

## 2. Demo script (5½ minutes)

Before you start:

- Open `pnpm dev` with two projects added, one of them the sandbox repository.
- Have one review already finished, so findings exist without waiting for Claude.
- Have one review of sandbox PR #1 open.
- `gh` is logged in.

1. **The shell (20 s).** Show the Teams layout: app rail, reviews grouped by project, the review
   area. Say: "Fluent UI v9 with the Teams theme: Microsoft's own design system, not a look-alike."
   Press `?` to show the keyboard shortcuts.
2. **Start a review (40 s).** Click New review and paste the sandbox PR link.
   - Point at **Isolated worktree**: "Each review checks out the code in its own `git worktree`, so
     my working copy is never touched."
   - Start it, then start a second review of a branch in the other project.
   - Say: "Up to three turns run at once; the rest wait as queued."
3. **Live conversation (40 s).** Claude's reply streams in, and tool calls appear as collapsible
   cards. Then ask a follow-up in the message box, for example "Why is #2 a blocker?"
4. **Findings (60 s).** Press `2`, then `J`/`K` to walk them.
   - Show a finding: severity, problem, **How to reproduce**, suggestion.
   - Accept one, dismiss one.
   - Click a `file:line` link to open the file in the editor.
   - Click **Ask about #N**: the question about that finding is prefilled.
   - Say: "Claude reports findings through a tool, so the numbers never change. If Claude re-checks
     after a new commit, it updates or withdraws #3 instead of renumbering."
5. **Permission gate (40 s).** Turn on **Fix mode** and ask Claude to run the tests.
   - An approval card appears with the exact command: allow once, allow for this review, or deny.
   - Say: "A PreToolUse hook decides every tool call. Approved commands run in Claude Code's OS
     sandbox, with writes only inside the review's folder and no network."
6. **Changes (30 s).** Press `3`.
   - Show the file tree, the unified and split layouts, and the findings marked on their lines.
   - Show **Check now**, which moves the review to new commits.
   - Resize or collapse the file list.
7. **PR comments and posting (40 s).** Press `4`.
   - Show the PR discussion, then **Post to GitHub…**: a preview of exactly what will be posted.
   - Post it, then show it on GitHub. Say: "Nothing is written to GitHub without this click."
8. **Find anything (20 s).** Press `⌘K` and type a word. Results come from every open review's
   titles, findings and changed files. Press Enter to jump to the result.
9. **Activity (20 s).** Click Activity on the rail: the badge counts what you haven't seen.
   - Rows say what finished (with its new findings), failed, waits for approval, or got new
     commits or PR comments, across every review.
   - Click a row: its review opens beside the feed, on the finding or tab it is about.
10. **Close (10 s).** Close a review: its worktree is removed. Then show the theme switch in
    Settings.

If Claude is slow or offline, the screenshots in the README come from the end-to-end test
(`pnpm e2e`), which drives the real app with a scripted Claude.

## 3. Architecture walkthrough

Use the diagram in [ARCHITECTURE.md](ARCHITECTURE.md#overview):

- the sandboxed React renderer;
- a tiny preload bridge;
- the main process, holding the IPC dispatcher, the services, the session service, the permission
  gate, the `report_findings` tool and SQLite;
- the user's own Claude Code.

Three places worth opening:

1. **The typed IPC boundary:** `apps/desktop/src/main/ipc/dispatcher.ts:38`.
   - Every channel's input is checked against its zod schema before any handler runs.
   - `ipc/register.ts:10` rejects calls that don't come from the app's own window.
   - The schemas live in `packages/shared`, so a contract change is one edit that both sides
     type-check against.
2. **The permission gate:** `apps/desktop/src/main/claude/policy.ts:457` (`decideToolUse`).
   - Read-only tools inside the review's folder are allowed.
   - Git commands are checked against an allowlist per subcommand (`policy.ts:146`).
   - Everything else is denied or asked.
   - `claude/sessions.ts:492` is a second line of defense: a tool result for a call that never
     passed the hook stops the turn.
3. **Stable findings:** `apps/desktop/src/main/findings/report.ts:142` (`applyReport`).
   - The app, not the model, assigns numbers.
   - Updates and withdrawals refer to existing numbers.
   - Each review has a cap (200) that bounds a prompt-injected loop.

## 4. Decisions I can defend

| ADR | Decision | Trade-off |
| --- | --- | --- |
| 0001 | Fluent UI v9 with the Teams themes | Exact Teams look and three themes for free, but a large bundle. Phase 8 split and minified it (3.1 MB → 1.3 MB loaded at startup) |
| 0002 → 0008 | Started as Fastify plus a web UI, then moved to Electron with typed IPC | Lost the browser, gained no open port, native dialogs, and Node 24 in-process for the Agent SDK and SQLite |
| 0003 | One zod contract package for both sides | Validation at every boundary; more schemas to keep, but one place |
| 0004 | Findings arrive through an MCP tool, not by parsing text | Reliable structured output and stable numbers; the prompt must tell Claude when to call it |
| 0005 | The app's own PreToolUse permission gate | Full control over what Claude may run; the allowlist parser is security-critical and needs heavy tests |
| 0006 | `node:sqlite` with append-only migrations | No native dependency; the API is still young, so its use is kept inside `db/` and the repositories |
| 0007 | A project is its repository root; the review prompt is stored as text | Duplicates caught however the path is typed; a changed default reaches new projects only |
| 0009 | Isolated worktrees by default, in-place as an option (one per project) | Safe parallel reviews; in-place refuses to start over uncommitted changes |
| 0010 | Run the user's installed `claude`, one `query()` per turn with resume, at most 3 at once | Uses their login and settings; sessions survive restarts; extra reviews queue |
| 0011 | Open in editor through presets or a template split into words before filling | No shell, no injection through file names; the editor's command must be on PATH |
| 0012 | Approval cards, "Allow for this review" by exact match, fix mode, OS sandbox | Safe by default, at the cost of more clicks when fixing |
| 0013 | Own diff parser; compare merge base with head, commits only | No new dependency; findings point at head lines and are re-checked after a refresh |
| 0014 | `gh` for reading the discussion and posting a review | Reuses the user's GitHub login; long discussions are truncated, and the UI says so |
| 0015 | A stored Activity feed written by the services, not derived from other tables | Read state and events with no history of their own (commits, comments); one more table and a call at each source |
| 0017 | The user edits each finding's text before posting; main posts exactly that text | The user's words under their name; main can no longer promise that edited text mentions no one, so Claude's text stays neutralized and the dialog says what an edit does |

## 5. How I work with Claude Code

The `.claude/` folder turns Claude Code into a team that follows this project's rules:

- **`CLAUDE.md`**
  - Commands, layout, conventions and the hard rules: sandboxed renderer, every IPC call through the
    dispatcher, read-only by default, nothing posted without a click.
  - "Done" means `pnpm verify` passes and the change was seen in the window.
- **Agents**
  - `architect` plans a phase before any code.
  - `code-reviewer`, `security-auditor` and `ui-reviewer` review independently and read-only.
  - `test-engineer` writes and runs tests.
  - Reviewers can't edit, so a review stays a review.
- **Skills** hold the knowledge that a reminder in `CLAUDE.md` is too short for:
  - `ship-feature`: plan → implement → verify → review → tick the roadmap.
  - `ipc-contract`: adding a channel end to end.
  - `agent-sdk-integration`.
  - `fluent-teams-ui`.
  - `write-adr`.
- **Commands**
  - `/phase` starts a roadmap phase.
  - `/review` runs the three reviewers in parallel.
  - `/verify` runs the checks.
  - `/adr` records a decision.
  - `/demo-prep` wrote this file.
- **Hooks**
  - `session-context` tells each new session where the roadmap stands.
  - `format-on-edit` formats every file Claude writes.
  - `protect-files` blocks edits to the lockfile, `.env` files, git internals and the reference
    app that PRoblem must not copy from.

## 6. Likely questions

- **Why Electron and not a web app?**
  - It started as one (ADR 0002).
  - The Agent SDK, SQLite and git need Node and the local machine anyway, and an open local port
    is a risk.
  - Electron removed the server entirely (ADR 0008).
- **How do you stop Claude from doing damage?**
  - Read-only by default.
  - A hook decides every tool call, with a git allowlist.
  - Approvals are per review.
  - Approved commands run in the OS sandbox.
  - A tool that slipped past the hook stops the turn.
  - The renderer is sandboxed with a strict CSP.
- **How is it tested?**
  - 354 unit and component tests (Vitest; main process in Node, UI in jsdom).
  - Git code is tested on real repositories.
  - One Playwright end-to-end test drives the built app with a scripted Claude that goes through
    the real permission hook.
  - CI runs `pnpm verify`.
- **What was hard?**
  - The permission gate.
  - Claude Code can run several tool calls at once and withdraw older permission requests, so
    the approval cards must handle "superseded".
  - Keeping finding numbers stable across new commits.
  - Moving from a web server to Electron midway without losing the services: they were already
    Electron-free.
- **What would you do next?**
  - Run the end-to-end test in CI under a virtual display.
  - Signed and notarized macOS builds with auto-update.
  - A packaged `.dmg` checked on a clean machine.
  - Bitbucket Cloud.
- **What did Claude Code do, and what did you do?**
  - I set the product, the rules and the reviews; Claude implemented within them.
  - Every phase went through a plan, tests, `pnpm verify` and the reviewer agents.
  - Each real trade-off was written down as an ADR.
