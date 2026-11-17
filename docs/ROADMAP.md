# Roadmap

Each phase ends with something demoable and `pnpm verify` green. Work an item with `/phase <n>`
(the `ship-feature` workflow). Tick items as they land.

## Phase 0: Foundation

- [x] pnpm monorepo: `apps/server`, `apps/web`, `packages/shared`
- [x] Strict TypeScript 7, Biome, Vitest in every package
- [x] Fastify server on Node 24 native TS, loopback only, origin guard, `/api/health`, `/ws` hello
- [x] SQLite with append-only migrations
- [x] Fluent UI Teams-dark shell: title bar, app rail, list pane, main pane (placeholder data)
- [x] Claude Code setup: `CLAUDE.md`, agents, skills, commands, hooks, permissions
- [x] CI workflow, ADRs 0001–0006
- [ ] Initialize git and make the first commit

## Phase 1: Projects

- [x] `projects` repository + `GET/POST/PATCH/DELETE /api/projects`; validate the path is a git repo
- [x] Projects section in the rail: list, add by folder path (Dialog), remove
- [x] Per-project review prompt editor with a sensible default prompt
- [x] Reviews in the list pane grouped by project (still placeholder reviews)

## Phase 2: Review lifecycle (no Claude yet)

- [ ] Git module: fetch, resolve branch/PR head, default base, merge base (argument-array spawns)
- [ ] Create a review from a branch name or a GitHub PR URL (`gh pr view`), in an isolated
      worktree or in the project checkout (refuse a dirty tree)
- [ ] `reviews` table and API; list pane shows real reviews with status dots; delete placeholders
- [ ] New review dialog (source, base, isolated checkbox remembered per project, prompt)
- [ ] Close a review: confirm, remove its worktree, archive the record

## Phase 3: Claude sessions

- [ ] Add the Agent SDK; session service with one `query()` per turn and `resume`
- [ ] Normalize SDK messages into review events; persist and broadcast over `/ws`
- [ ] Zustand store fed by the socket for all reviews; status dots update live
- [ ] Conversation tab: markdown messages, collapsible tool-call cards, auto-scroll that respects the user
- [ ] Composer: send, `/skill` completion, Stop (interrupt), model picker
- [ ] Survives restart: transcript reloads, next message resumes the same session

## Phase 4: Findings

- [ ] `report_findings` MCP tool with server-assigned stable numbers (ADR 0004)
- [ ] Findings tab: Fluent DataGrid with severity, title, location, verdict; filter by verdict
- [ ] Accept / dismiss / reopen; "Ask about #N" prefills the composer
- [ ] Open `file:line` in the editor (configurable command template), in the review's workdir
- [ ] Findings count and blockers in the list pane subtitle

## Phase 5: Permission gate

- [ ] `PreToolUse` gate: read-only tools and allowlisted read-only Bash run; the rest asks (ADR 0005)
- [ ] Approval cards in the conversation: Allow once / Allow for this review / Deny with message
- [ ] `needs-input` status and a notification when a review waits for you
- [ ] Untrusted PR checkouts never load their own `.claude/` or `.mcp.json`
- [ ] Fix mode per review: allow edits inside the workdir only
- [ ] Security audit of the whole gate (`security-auditor`)

## Phase 6: Changes view

- [ ] Diff against the merge base, file tree with +/- counts
- [ ] Filters: tests / generated / glob patterns, remembered per project
- [ ] Findings shown on their lines; line numbers open the editor
- [ ] Detect new commits on the PR; Refresh moves the review and tells Claude what changed

## Phase 7: Git host integration

- [ ] Read PR comments and review threads (GitHub via `gh`); show them in the PR comments tab
- [ ] Give Claude a digest of existing comments so it does not repeat them
- [ ] Post findings as a GitHub review after a preview dialog (inline or summary)
- [ ] Approve / request changes / comment
- [ ] Stretch: Bitbucket Cloud

## Phase 8: Polish

- [ ] Theme switch: Teams dark, light, high contrast (persisted)
- [ ] Search in the title bar across reviews and findings
- [ ] Keyboard shortcuts (next review, next finding, focus composer)
- [ ] Toasts, error boundary, empty states, loading skeletons
- [ ] Server serves the built UI: one `pnpm start` for production use

## Phase 9: Showcase

- [ ] End-to-end smoke test (Playwright) of the main flow with a fake Claude
- [ ] Screenshots and a short GIF in the README
- [ ] `/demo-prep` → `docs/DEMO.md`; rehearse the demo
- [ ] Stretch: desktop packaging (Tauri)
