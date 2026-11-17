---
name: ship-feature
description: The ReviewRoom delivery workflow. Takes one roadmap item or feature from plan to verified, reviewed change - architect plan, incremental implementation with tests, parallel code/security/UI review, verification, docs update. Use whenever implementing a roadmap item, a phase, or any feature that spans more than one file.
---

# Ship a feature

The workflow every ReviewRoom feature goes through. Each stage has an exit condition; do not move
on until it is met.

## 1. Frame

- Find the item in `docs/ROADMAP.md`. If it is not there, add it to the right phase first.
- Write the acceptance criteria as a checklist in your reply (3 to 7 items, testable).
- Stop and ask the user only about real product decisions, not about things with a clear default.

**Exit:** acceptance criteria agreed or obvious.

## 2. Plan

- Delegate to the `architect` agent with the roadmap item and acceptance criteria.
- Check its plan against the code yourself (do not trust file paths blindly).
- If the plan picks between real alternatives, write an ADR with the `write-adr` skill.
- For a change larger than ~5 files, show the plan to the user and wait for approval.

**Exit:** a step list where every step leaves the build green.

## 3. Build, step by step

For each step:

1. Contract first: add or change zod schemas in `packages/shared` (see the `ipc-contract` skill).
2. Main process, then renderer. UI follows the `fluent-teams-ui` skill; Claude integration follows
   `agent-sdk-integration`.
3. Write the test with the code, not after.
4. Run the narrowest check: `pnpm --filter <package> test` and `pnpm typecheck`.

**Exit:** all steps done, `pnpm verify` passes.

## 4. Review in parallel

Launch in one message, so they run concurrently:

- `code-reviewer` always.
- `security-auditor` if the change touches permissions, commands, paths, tokens, the preload/IPC
  boundary or window settings, or posting to a git host.
- `ui-reviewer` if the change touches `apps/desktop/src/renderer`.
- `test-engineer` if any acceptance criterion has no test yet.

Fix every real finding. If you disagree with one, say why in your report instead of silently
ignoring it. Re-run `pnpm verify` after fixes.

**Exit:** no open critical/high findings; `pnpm verify` passes.

## 5. Close

- Tick the item in `docs/ROADMAP.md`; update `docs/ARCHITECTURE.md` if the design changed.
- See it working: run `pnpm dev` and exercise the feature in the Electron window when it has UI.
- Propose a Conventional Commit message (`feat(desktop): ...`). Commit only if the user asks.

## Report

What changed (by package), acceptance criteria with status, commands run with results, review
findings fixed or declined, and what remains uncertain.
