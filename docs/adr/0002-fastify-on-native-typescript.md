# 0002. Fastify on Node's native TypeScript, no server build

- Status: superseded by [0008](0008-electron-with-typed-ipc.md)
- Date: 2026-11-17

## Context
The server is a local tool: an HTTP API, a WebSocket and long-running Claude sessions. We want
fast iteration, testable routes and no compile step between editing and running.

## Options
1. **Fastify 5**: plugins, lifecycle hooks (origin guard), `inject()` for tests without a socket,
   first-party WebSocket plugin. Con: one more framework to learn than raw `node:http`.
2. **Raw `node:http` + `ws`**: no dependencies. Con: routing, body parsing, error handling and
   test helpers by hand.
3. **Hono**: small and fast. Con: Node WebSocket support is an adapter, less mature hooks.

Runtime: Node 24 strips TypeScript types natively; `tsx` or a build step are alternatives.

## Decision
Fastify 5, run with `node src/index.ts`. `tsc --noEmit` type-checks only.

## Consequences
- Server code must be erasable TypeScript (no enums, namespaces, parameter properties) and
  relative imports carry `.ts`. `erasableSyntaxOnly` in `tsconfig` enforces it.
- Workspace packages are consumed as `.ts` source, so `packages/shared` follows the same rules.
- Route tests run in-process with `app.inject()`, which keeps them fast.
