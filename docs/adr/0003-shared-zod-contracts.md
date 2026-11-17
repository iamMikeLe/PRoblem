# 0003. One zod contract package shared by server and web

- Status: accepted
- Date: 2026-11-17

## Context
Data crosses several trust boundaries: browser ↔ server (HTTP, WebSocket), server ↔ Claude
(tool inputs), server ↔ `git`/`gh` output. Shapes drift when each side declares its own types.

## Options
1. **zod schemas in `packages/shared`, types inferred**: one source, runtime validation everywhere.
   Con: schemas are more verbose than plain interfaces.
2. **Plain TypeScript interfaces shared**: no runtime cost. Con: no validation of untrusted data.
3. **OpenAPI + codegen**: language-neutral. Con: heavy for a single-language local app.

## Decision
zod 4 schemas in `packages/shared`; `z.infer` types everywhere. The Agent SDK also takes zod
shapes for MCP tool inputs, so the same schemas describe what Claude may send.

## Consequences
- Changing a contract is a single edit that both sides type-check against.
- Every boundary validates; invalid input fails loudly with a clear error.

## Update (ADR 0008)
The transport is now Electron IPC instead of HTTP and WebSocket. The decision stands: the IPC
contract (`packages/shared/src/ipc.ts`) is the same idea, channel → input and output schemas.
