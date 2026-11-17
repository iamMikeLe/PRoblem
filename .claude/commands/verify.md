---
description: Run lint, type check, tests and build; diagnose any failure
allowed-tools: Bash(pnpm verify:*), Bash(pnpm lint:*), Bash(pnpm typecheck:*), Bash(pnpm test:*), Bash(pnpm build:*), Read, Grep, Glob
---

Run `pnpm verify` (lint → typecheck → test → build).

- If everything passes, reply with one line per step and its result.
- If something fails, stop at the first failing step, show the relevant error output, find the root
  cause in the code, and propose the minimal fix. Do not change any files unless I ask.
