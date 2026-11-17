---
name: agent-sdk-integration
description: How ReviewRoom drives Claude through the Claude Agent SDK - one query() per turn with session resume, streaming SDK messages to the renderer, the report_findings MCP tool, the PreToolUse permission gate, interrupt, and testing with a fake query. Use for any work in apps/desktop/src/main/claude or anything that starts, streams, stops or permissions a Claude turn.
---

# Claude Agent SDK integration

Package: `@anthropic-ai/claude-agent-sdk` (added in Phase 3). The SDK API moves quickly:
**before writing code, read the installed typings** (`node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts`)
and correct this skill if it is out of date.

## Session model

- A review has at most one running turn. Each user message starts one `query()` call with
  `cwd` set to the review's workdir.
- The first turn's prompt is the project's review prompt filled with base, head, PR info.
- Store the `session_id` from the first `system`/`init` message on the review; later turns pass
  `resume: sessionId`, which also works after the app restarts.
- Load `settingSources: ["user", "project"]` only for trusted checkouts. For an isolated worktree
  of someone's PR, load project settings from the main checkout, never from the PR (see the
  security-auditor invariants).

## Streaming

- Iterate the async generator and, for every SDK message:
  1. append a normalized event to the review's event log (SQLite), then
  2. `broadcast()` it (`ipc/register.ts`) to the renderer, tagged with the review id.
- The Agent SDK runs in the Electron main process (Node 24). Keep the session service
  Electron-free; inject `query` and `broadcast` so it is testable.
- Normalize in one module (`toReviewEvents(message)`), so the UI depends on our event schema,
  not the SDK's message shapes.
- Stop = call `interrupt()` on the running query (keep a `Map<reviewId, Query>`); the review stays
  usable and its status returns to `idle`.

## Findings via an MCP tool (ADR 0004)

Claude reports findings by calling a tool, not by printing JSON:

```ts
const findingsServer = createSdkMcpServer({
  name: "reviewroom",
  version: "1.0.0",
  tools: [
    tool("report_findings", "Create, update or withdraw review findings.", ReportFindingsInputShape,
      async (input) => {
        const saved = upsertFindings(db, reviewId, input); // main assigns stable numbers
        broadcast({ type: "review.findings", reviewId, findings: saved });
        return { content: [{ type: "text", text: summarize(saved) }] };
      }),
  ],
});
```

- New findings get the next free number from the main process; updates reference an existing number.
  Claude never chooses a number, so `#3` always means the same finding.
- The system prompt appendix tells Claude to call `report_findings` at the end of every turn in
  which its view of the findings changed.

## Permission gate (ADR 0005)

- Register a `PreToolUse` hook for every tool (`matcher` omitted). It returns allow, deny, or
  waits for the user's decision from an approval card.
- Read-only tools and the `report_findings` tool are allowed. Bash is allowed only for commands
  matching the read-only allowlist; everything else asks.
- User `allow` rules must not widen this: force `permissionMode: "default"`.
- While waiting, the review status is `needs-input`; the pending request is persisted so the
  card survives a page reload (but not an app restart; the turn is then aborted).

## Testing

Never call the real SDK in tests. Inject the `query` function and fake it:

```ts
const fakeQuery = (messages: SDKMessage[]) => async function* () { yield* messages; };
```

Test: session id is stored and resumed, events are persisted and broadcast in order, interrupt
stops the turn, `report_findings` keeps numbers stable, and the gate denies a write by default.
