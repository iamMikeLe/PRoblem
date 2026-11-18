# 0004. Claude reports findings through an MCP tool

- Status: accepted (implemented in Phase 4, 2026-11-18)
- Date: 2026-11-17

## Context
Each review keeps a numbered findings list that must stay in sync with the conversation, and a
number must always mean the same finding, even after many turns and new commits.

## Options
1. **Parse a fenced JSON block at the end of each answer**: simple. Con: Claude may forget or
   malform the block, numbering is Claude's job, and the block clutters the transcript.
2. **In-process MCP tool `report_findings`** (Agent SDK `createSdkMcpServer` + `tool()`): input is
   validated by a zod schema, the server assigns numbers, the tool result confirms what was saved.
   Con: one more moving part in the session setup.
3. **Second "extractor" model call after each turn**: robust to format. Con: extra cost and latency,
   can disagree with the conversation.

## Decision
Option 2. Structured tool calls are what the model is trained to produce reliably, validation is
free, and the server owns numbering, so stability is guaranteed by construction.

## Consequences
- The tool is always allowed by the permission gate.
- The prompt appendix tells Claude when to call it; tests cover create, update and withdraw.
- Findings update live (tool call → broadcast) instead of at the end of the turn.

## Implementation notes (Phase 4)
- **The tool.** `report_findings` takes `add`, `update` (by number, only the fields given) and
  `withdraw` (by number, with a reason). The main process checks the whole report first and saves
  it in one transaction, or saves nothing and tells Claude what to fix. Paths are made relative to
  the repository root. A review keeps at most 200 findings, and titles are one line.
- **One server per turn.** `createSdkMcpServer` is created for each turn and bound to that
  review. `strictMcpConfig` keeps it the only MCP server, and the gate allows exactly
  `mcp__problem__report_findings`.
- **Verdicts are the user's.** Claude's updates never change a verdict. A finding Claude changes
  after a verdict is marked "changed since your verdict".
- **Claude learns the verdicts.** Verdicts changed since the last message start the user's next
  message as a `[PRoblem] …` note, with each title quoted.
  - They are marked as told only once Claude has started that turn, so a stopped message tells
    Claude again next time.
  - The note is part of the stored user message, so the transcript shows exactly what Claude was told.
