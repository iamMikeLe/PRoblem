# 0006. `node:sqlite` for persistence

- Status: accepted
- Date: 2026-11-17

## Context
Everything must survive a restart: projects, reviews, transcripts (append-heavy), findings,
verdicts, Claude session ids. Many reviews write concurrently from one process.

## Options
1. **JSON files per entity + JSONL logs**: zero deps, human-readable. Con: hand-rolled atomic
   writes, no queries or transactions.
2. **`node:sqlite` (built into Node 24)**: transactions, indexes, WAL; no native addon to build.
   Con: still flagged experimental in Node 24 (prints a warning, which our scripts silence).
3. **`better-sqlite3` + an ORM**: mature. Con: native build step, more dependencies.

## Decision
`node:sqlite` with a tiny append-only migration runner (`apps/desktop/src/main/db`).

## Consequences
- Repositories are plain functions over `DatabaseSync`; tests use `:memory:`.
- If the API changes before it is stable, the impact is contained in `src/db` and repositories.
