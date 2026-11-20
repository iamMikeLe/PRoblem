# Roadmap

Each phase ends with something demoable and `pnpm verify` green. Work an item with `/phase <n>`
(the `ship-feature` workflow). Tick items as they land.

## Phase 0: Foundation

- [x] pnpm monorepo: `apps/server`, `apps/web`, `packages/shared` (later merged into `apps/desktop`)
- [x] Strict TypeScript 7, Biome, Vitest in every package
- [x] Fastify server on Node 24 native TS, loopback only, origin guard, `/api/health`, `/ws` hello (replaced by Electron IPC in Phase 1.5)
- [x] SQLite with append-only migrations
- [x] Fluent UI Teams-dark shell: title bar, app rail, list pane, main pane (placeholder data)
- [x] Claude Code setup: `CLAUDE.md`, agents, skills, commands, hooks, permissions
- [x] CI workflow, ADRs 0001–0006
- [x] Initialize git and make the first commit

## Phase 1: Projects

- [x] `projects` repository + create/list/update/remove (first over HTTP, now IPC); validate the path is a git repo
- [x] Projects section in the rail: list, add by folder path (Dialog), remove
- [x] Per-project review prompt editor with a sensible default prompt
- [x] Reviews in the list pane grouped by project (still placeholder reviews)

## Phase 1.5: Desktop app (Electron)

- [x] `apps/desktop`: Electron 45 + electron-vite; services moved into the main process (ADR 0008)
- [x] Typed IPC contract in `packages/shared`; dispatcher validates input, renderer validates output
- [x] Secure window: context isolation, sandbox, CSP, sender check, no navigation, single instance
- [x] Teams-style title bar is the window title bar (traffic lights / caption buttons)
- [x] Native folder picker in Add project
- [x] Remove Fastify, WebSocket, origin guard; port all tests
- [ ] Packaged `.dmg` with electron-builder (`pnpm package`), checked on a clean machine
- [x] Main → renderer event wiring used by the UI (landed with Phase 3 streaming)

## Phase 2: Review lifecycle (no Claude yet)

- [x] Git module: fetch, resolve branch/PR head, default base, merge base (argument-array spawns,
      hooks disabled on checkout, ADR 0009)
- [x] Create a review from a branch name or a GitHub PR URL (`gh pr view`), in an isolated
      worktree or in the project checkout (detached; refuse a dirty tree; one per project)
- [x] `reviews` table and IPC channels; list pane shows real reviews with status dots; delete placeholders
- [x] New review dialog (source with branch autocomplete, base, isolated switch remembered per project, prompt)
- [x] Close a review: confirm, remove its worktree or restore the project branch, archive the record
- [x] Login-shell PATH for the packaged app, so `gh`/`git` from Homebrew are found
- [x] Link a branch review to its open PR automatically (done in Phase 7)

## Phase 3: Claude sessions

- [x] Add the Agent SDK; session service with one `query()` per turn and `resume` (ADR 0010)
- [x] Normalize SDK messages into review events; persist and broadcast to the renderer
- [x] Zustand store fed by `onEvent` for all reviews; status dots update live
- [x] Conversation tab: markdown messages, collapsible tool-call cards, auto-scroll that respects the user
- [x] Composer: send, `/skill` completion, Stop (interrupt), model picker
- [x] Survives restart: transcript reloads, next message resumes the same session
- [x] First turn starts when the review is created; at most 3 turns at once, the rest queued
- [x] Read-only until Phase 5: own tool list, `PreToolUse` policy, no settings or MCP from the checkout

## Phase 4: Findings

- [x] `report_findings` MCP tool with stable numbers assigned by the main process (ADR 0004)
- [x] Findings tab: Fluent DataGrid with severity, title, location, verdict; filter by verdict
- [x] Accept / dismiss / reopen; "Ask about #N" prefills the composer
- [x] Open `file:line` in the editor: presets or a custom command template, no shell (ADR 0011)
- [x] Claude is told about verdicts on the next message; Settings page for the editor
- [x] Findings count and blockers in the list pane subtitle

## Phase 5: Permission gate

- [x] `PreToolUse` gate: read-only tools and allowlisted read-only Bash run; the rest asks (ADR 0005)
- [x] Approval cards in the conversation: Allow once / Allow for this review / Deny with message
- [x] `needs-input` status, a native notification and dock badge when a review waits for you
- [x] Untrusted PR checkouts never load their own `.claude/` or `.mcp.json`
- [x] Fix mode per review: allow edits inside the workdir only
- [x] Security audit of the whole gate: 2 high, 1 medium, 3 low found and fixed (ADR 0012)

## Phase 6: Changes view

- [x] Diff against the merge base, file tree with +/- counts
- [x] Filters: tests / generated / glob patterns, remembered per project
- [x] Findings shown on their lines; line numbers open the editor
- [x] Detect new commits (when the tab opens or on "Check now"); Refresh moves the review and tells Claude on the next message (ADR 0013)

## Phase 7: Git host integration

- [x] Read PR comments and review threads (GitHub via `gh`); show them in the PR comments tab
- [x] Give Claude a digest of existing comments so it does not repeat them
- [x] Post findings as a GitHub review after a preview dialog (inline or summary)
- [x] Approve / request changes / comment
- [x] Branch reviews find their open PR (`gh pr list --head`) (ADR 0014)
- [x] Stretch: Bitbucket Cloud: PR links and `#n`, comments, posting; API token in Settings (ADR 0019)

## Phase 8: Polish

- [x] Theme switch: Teams dark, light, high contrast (Settings; remembered on this machine)
- [x] Search in the title bar across reviews, findings and changed files (⌘K / Ctrl+K)
- [x] Keyboard shortcuts: Alt+↑/↓ reviews, 1–4 tabs, J/K findings, R reply, ⌘B reviews list, ? list
- [x] Toasts, error boundaries (window, pane, tab; crashes go to the app log), empty states, loading skeletons
- [x] Renderer bundle: minified, Projects, Settings, Changes and PR comments load on first use (3.1 MB → 1.3 MB)

## Phase 9: Showcase

- [x] End-to-end smoke test (Playwright's Electron support) of the main flow with a fake Claude (`pnpm e2e`)
- [x] Screenshots in the README, taken by the end-to-end test
- [x] A short GIF in the README (`demo:gif`: recorded by Playwright, assembled by ffmpeg)
- [x] `/demo-prep` → `docs/DEMO.md`
- [ ] Rehearse the demo
- [ ] Code signing and notarization for macOS; auto-update

## Phase 10: Activity

- [x] `activity` table and service: approvals asked, turns finished (with new findings) or failed, new commits, new PR comments, posted reviews (ADR 0015)
- [x] Background check for new commits after every turn
- [x] Activity pane: All / Unread, mark all as read; a row opens its review on the right tab or finding
- [x] Unread count on the rail; end-to-end test and screenshot
- [x] "Allow all commands" on Bash cards: one grant per review, still sandboxed (ADR 0016)
