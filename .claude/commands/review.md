---
description: Review the current changes with the code, security and UI reviewer agents in parallel
argument-hint: "[optional git range or path, default: uncommitted changes + branch]"
---

Review the current changes. Scope: `$ARGUMENTS` (if empty: uncommitted changes plus commits not on `main`).

1. Run `git status` and `git diff --stat` to see what changed.
2. In a single message, launch in parallel:
   - `code-reviewer` on the whole change,
   - `security-auditor` if anything under `apps/desktop/src/main` or `src/preload` changed that
     touches commands, paths, permissions, tokens, window settings or the IPC boundary,
   - `ui-reviewer` if anything under `apps/desktop/src/renderer` changed.
3. Verify each reported finding against the code before passing it on. Drop the ones that do
   not hold up and say why.
4. Report one merged list, most severe first, with `path:line` and the suggested fix. End with a
   verdict. Do not edit files.
