# ReviewRoom

Electron desktop app for running many Claude Code reviews of branches and pull requests at once,
across several repositories. Teams-style dark UI. Single user, local machine.

Read `docs/ARCHITECTURE.md` for the design and `docs/ROADMAP.md` for what is built and what is next.

## Commands

```sh
pnpm install          # once (downloads the Electron binary)
pnpm dev              # Electron window with hot reload (electron-vite)
pnpm verify           # lint + typecheck + test + build (run before saying "done")
pnpm test             # all Vitest suites (main: node, renderer: jsdom)
pnpm --filter @reviewroom/desktop exec vitest run test/main/ipc/dispatcher.test.ts   # one file
pnpm package          # build a distributable with electron-builder (apps/desktop/dist)
pnpm format           # Biome format + safe fixes
```

## Layout

- `packages/shared`: zod schemas = the contract: domain, IPC channels (`ipc.ts`), events.
  `channels.ts` is zod-free so the preload can import it.
- `apps/desktop/src/main`: Electron main process. `ipc/` (dispatcher, handlers, sender trust,
  registration), `projects/` (`service.ts` + `repository.ts`), `db/` (`node:sqlite` + migrations),
  `git/`. Only `index.ts`, `window.ts` and `ipc/register.ts` may import `electron`.
- `apps/desktop/src/preload`: the `window.reviewroom` bridge (`invoke`, `onEvent`). Keep it tiny.
- `apps/desktop/src/renderer/src`: React 19 + Fluent UI v9 (`teamsDarkTheme`). `app/` = shell,
  `features/<feature>/` = UI, queries and store, `lib/api.ts` = typed IPC client.
- Tests: `apps/desktop/test/main` mirrors `src/main`, `apps/desktop/test/renderer` mirrors the UI.

## Conventions

- Contract first: add the channel to `IPC_CHANNELS` and `ipcContract`, then the handler, then the
  `api` method and React Query hook (see the `ipc-contract` skill).
- Services are Electron-free and take their dependencies as arguments, so they test in plain Node.
- Expected failures throw `AppFailure(code, message)` with a code from `AppErrorCodeSchema`.
- Strict TypeScript: no `any`, no non-null `!`, no unchecked `as` at boundaries. Validate external
  data (IPC input, events, SDK messages, `git`/`gh` output) with zod.
- UI: Fluent components and `tokens` only, no hard-coded colors (see the `fluent-teams-ui` skill).
- Child processes: `execFile`/`spawn` with an argument array, never a shell string.
- Migrations are append-only. Never edit one that has been committed.
- New behavior ships with its test. Conventional Commits: `feat(desktop): ...`, `fix(shared): ...`.

## Hard rules

- Renderer stays sandboxed: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP.
  Never expose `ipcRenderer` or Node APIs through the preload.
- Every IPC handler is reached only through the dispatcher (input validated, sender checked).
- Claude is read-only by default when reviewing; only the app's permission gate may allow more.
- Nothing is written to GitHub/Bitbucket without an explicit user click for that review.

## Workflow

Use the `ship-feature` skill for any roadmap item (`/phase <n>` starts a phase). Plans come from
the `architect` agent; reviews from `code-reviewer`, `security-auditor`, `ui-reviewer` (`/review`).
Record real trade-offs as ADRs (`/adr <title>`). Done means `pnpm verify` passes, the feature was
seen working in the Electron window, and the roadmap item is ticked.
