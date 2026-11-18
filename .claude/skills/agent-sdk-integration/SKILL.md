---
name: agent-sdk-integration
description: How ReviewRoom drives Claude through the Claude Agent SDK - one query() per turn with session resume, streaming SDK messages to the renderer, the report_findings MCP tool, the PreToolUse permission gate, interrupt, and testing with a fake query. Use for any work in apps/desktop/src/main/claude or anything that starts, streams, stops or permissions a Claude turn.
---

# Claude Agent SDK integration

Package: `@anthropic-ai/claude-agent-sdk`, pinned to the version matching the user's Claude Code.
The SDK API moves quickly: **before writing code, read the installed typings**
(`apps/desktop/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) and correct this skill if
it is out of date. Decisions are in ADR 0010.

## Where the code lives

- `src/main/claude/sessions.ts`: queue, turns, Stop, recovery, catalog. Electron-free; `runQuery`,
  `broadcast` and `claudePath` are injected.
- `src/main/claude/normalize.ts`: `toSignals(message, cwd)` turns one SDK message into
  `session` / `entry` / `delta` signals. Every SDK shape used is a narrow zod schema; anything
  else is ignored. The UI depends only on `ConversationEntry` (`packages/shared/src/conversation.ts`).
- `src/main/claude/policy.ts`: the read-only `PreToolUse` decision (`decideToolUse`).
- `src/main/claude/entries.ts`: `review_entries` table (append-only, `seq` per review).

## Session model

- A review has at most one running or queued turn (`review_busy` otherwise); at most 3 turns run
  app-wide, the rest are `queued`.
- Each message starts one `query({ prompt, options })` with `cwd` = the review's workdir and
  `pathToClaudeCodeExecutable` = the user's `claude` from PATH (the bundled binary is not used).
- The first message is `firstTurnPrompt(review)` (review prompt + head/base/merge base), sent when
  the review is created. The `session_id` of `system/init` is stored on the review; later turns
  pass `resume`, which also works after an app restart.
- Options that keep a review read-only (do not loosen without an ADR):
  `tools: ["Read", "Grep", "Glob", "Bash"]`, the `PreToolUse` hook, a deny-all `canUseTool`,
  `permissionMode: "default"`, `settingSources: ["user"]`, `strictMcpConfig: true`, `mcpServers: {}`,
  `settings: { disableAllHooks: false }`, `env: reviewEnv(process.env)` (no `GIT_*`, no LFS smudge).
  The Bash policy is a per-subcommand git **allowlist** (git abbreviates long options, so a
  denylist was bypassed: see ADR 0010); add an option only with a test that it cannot execute,
  write, or read outside the checkout.
  Never add `"project"`: a pull request's `.claude/settings.json` hooks would run as shell commands
  (verified with a control run, ADR 0010).

## Streaming

- For every SDK message: entries are appended to SQLite, then broadcast as `review.entry`; text
  deltas (`includePartialMessages: true`) are broadcast as `review.delta` only, never stored.
- The `result` message becomes a `turn-end` entry (outcome, cost, duration, error). Every turn
  ends with exactly one `turn-end`, even when the SDK throws or the turn is stopped.
- Status: `queued` → `running` → `idle` (or `failed` after an error), as `review.status` events.
- Stop: a queued turn is dropped; a running one gets `interrupt()`, then `AbortController.abort()`
  after 10 s. Closing a review aborts at once. At startup, reviews left `queued`/`running` get an
  "interrupted" entry and become `idle` (`recover()`).
- Models and slash commands come from `supportedModels()` / `supportedCommands()` of the first
  turn of the app run (`claude:catalog`).

## Findings via an MCP tool (ADR 0004)

Claude reports findings by calling a tool, not by printing JSON:

- `claude/findingsTool.ts`: `findingsServer(report)` = `createSdkMcpServer` with one
  `tool("report_findings", …, ReportShape, handler)`. It is created per turn in `optionsFor`,
  bound to the review, and is the only entry in `mcpServers` (`strictMcpConfig: true`). Its
  tool name `mcp__reviewroom__report_findings` (`claude/names.ts`) is allowed by the policy.
  Needs the peer `@modelcontextprotocol/sdk`.
- `findings/report.ts`: `ReportShape` (`add` / `update` by number / `withdraw` with reason) and
  `applyReport`. It checks everything first, then saves in one transaction, or saves nothing and
  returns a text that tells Claude what to fix. Numbers are `MAX+1` per review; Claude never
  picks one. Paths are relative to the repository root, at most 200 findings per review, and
  titles are one line.
- Verdicts belong to the user. When Claude updates a finding that already has a verdict, it is
  marked `changedSinceVerdict`. Verdicts changed since the last message are prepended to the next
  message (`verdictNote`). The queue item carries them, and they are marked as told on the turn's
  `session` signal.
- The system prompt appendix (`REVIEW_SYSTEM_APPEND`) tells Claude when to call the tool.
- Test the handler directly: `reportFindingsTool(report).handler(input, {})`.

## Permission gate (ADR 0005)

- Register a `PreToolUse` hook for every tool (`matcher` omitted). It returns allow, deny, or
  waits for the user's decision from an approval card.
- Read-only tools and the `report_findings` tool are allowed. Bash is allowed only for commands
  matching the read-only allowlist; everything else asks.
- User `allow` rules must not widen this: force `permissionMode: "default"`.
- While waiting, the review status is `needs-input`; the pending request is persisted so the
  card survives a page reload (but not an app restart; the turn is then aborted).

## Testing

Never call the real SDK in tests. `test/main/claude/sessions.test.ts` has `fakeClaude(script)`, a
scripted `RunQuery` whose turns can be held open (to test busy, Stop and the queue) and that
records the options each turn received. Test with an in-memory database (`openDatabase(":memory:")`).

Covered: order and numbering of entries, session id stored and resumed, read-only options and the
gate, busy, Stop (running and queued), the concurrency limit, a missing `claude`, error results,
recovery after a quit, the catalog. The policy has its own table-driven tests (`policy.test.ts`).
A real turn is checked by hand in a second app instance (`REVIEWROOM_HOME` + `--user-data-dir`) driven over CDP.
