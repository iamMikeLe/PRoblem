# ReviewRoom

Local web app for running many Claude Code reviews of branches and pull requests at once, across
several repositories. Teams-style dark UI. Single user, localhost only.

Read `docs/ARCHITECTURE.md` for the design and `docs/ROADMAP.md` for what is built and what is next.

## Commands

```sh
pnpm install          # once
pnpm dev              # server on 127.0.0.1:4400 + Vite on http://localhost:5173
pnpm verify           # lint + typecheck + test + build (run before saying "done")
pnpm test             # all Vitest suites
pnpm --filter @reviewroom/server exec vitest run test/health.test.ts   # one file
pnpm format           # Biome format + safe fixes
```

## Layout

- `packages/shared`: zod schemas = the contract (domain, API, WS events). No runtime deps besides zod.
- `apps/server`: Fastify 5 on Node 24, TypeScript run directly (no build). `src/modules/<feature>/`
  holds `routes.ts` + `repository.ts`. SQLite via `node:sqlite`, migrations in `src/db/migrations.ts`.
- `apps/web`: React 19 + Vite + Fluent UI v9 (`teamsDarkTheme`). `src/app/` = shell,
  `src/features/<feature>/` = feature UI, queries and store, `src/lib/` = API client and socket.

## Conventions

- Contract first: change the zod schema in `packages/shared`, then server, then web.
- Server code must be erasable TypeScript: no `enum`, `namespace`, parameter properties;
  relative imports end in `.ts`.
- Strict TypeScript: no `any`, no non-null `!`, no unchecked `as` at boundaries. Validate external
  data (HTTP bodies, WS messages, SDK messages, `gh` output) with zod.
- UI: Fluent components and `tokens` only, no hard-coded colors (see the `fluent-teams-ui` skill).
- Child processes: `spawn`/`execFile` with an argument array, never a shell string.
- Migrations are append-only. Never edit one that has been committed.
- Tests sit in each package's `test/` folder and mirror `src/`. New behavior ships with its test.
- Conventional Commits: `feat(web): ...`, `fix(server): ...`, `docs: ...`.

## Hard rules

- The server binds `127.0.0.1` only and every request passes the origin guard.
- Claude is read-only by default when reviewing; only the app's permission gate may allow more.
- Nothing is written to GitHub/Bitbucket without an explicit user click for that review.

## Workflow

Use the `ship-feature` skill for any roadmap item (`/phase <n>` starts a phase). Plans come from
the `architect` agent; reviews from `code-reviewer`, `security-auditor`, `ui-reviewer` (`/review`).
Record real trade-offs as ADRs (`/adr <title>`). Done means `pnpm verify` passes and the roadmap
item is ticked.
