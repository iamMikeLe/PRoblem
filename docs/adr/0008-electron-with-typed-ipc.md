# 0008. Electron desktop app with a typed IPC contract

- Status: accepted (supersedes [0002](0002-fastify-on-native-typescript.md))
- Date: 2026-11-17

## Context
PRoblem started as a local web app: a Fastify server on `127.0.0.1` plus a React UI in the
browser. The product is a desktop tool for one person, and it should feel like one (own window,
native folder picker, notifications, dock badge). A local HTTP server is also an attack surface:
any web page in the user's browser can try to reach it (CSRF, DNS rebinding), which needed an
origin guard and a host allowlist.

## Options
1. **Keep the web app, wrap it** (local server + a desktop shell such as Tauri or Electron loading
   `http://127.0.0.1`). Smallest change, the browser mode stays. Con: keeps the open port and its
   defenses; Tauri has no Node, so the app must download and run a Node runtime for the server.
2. **Electron with IPC only.** Main process runs the services in-process; the sandboxed renderer
   talks to it through a preload `contextBridge`. No port at all. Con: a rewrite of the transport;
   no plain-browser mode; Electron apps are large (~100 MB+).
3. **Tauri with Rust commands.** Tiny binaries. Con: the Claude Agent SDK is a Node library, so a
   Node sidecar is needed anyway; two languages for one person to maintain.

## Decision
Option 2. Electron ships Node 24 (with `node:sqlite` and the Agent SDK's requirements), so the
services run in the main process unchanged. The transport is a single typed contract:

- `packages/shared/src/ipc.ts`: channel → zod input and output schemas.
- Main validates every input (`ipc/dispatcher.ts`) and answers with an `IpcResult` envelope,
  because Electron passes only an error's message across IPC.
- The preload exposes one generic `invoke` limited to the contract's channels, plus `onEvent`.
- The renderer validates every output (`lib/api.ts`).

Security baseline: `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP, IPC accepted
only from our own frame (`ipc/trust.ts`), no navigation and no new windows, single instance.

## Consequences
- The origin guard, host allowlist and WebSocket hub are gone; there is nothing listening.
- Services stay Electron-free (`projects/service.ts`, `db/`, `git/`), so they are tested in plain
  Node; only `index.ts`, `window.ts` and `ipc/register.ts` touch Electron.
- UI tests stub `window.problem` and parse inputs with the same contract.
- Builds use electron-vite (main, preload as CommonJS for the sandbox, renderer) and
  electron-builder. Signing and notarization are open (Phase 9).
- The browser can no longer be used for quick UI checks; `pnpm dev` opens the Electron window
  with hot reload instead.
