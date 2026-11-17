# 0004. Claude reports findings through an MCP tool

- Status: accepted (implemented in Phase 4)
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
