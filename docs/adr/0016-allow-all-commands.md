# 0016. "Allow all commands" for one review

- Status: accepted (widens ADR 0012's exact-match grants for Bash)
- Date: 2026-11-19

## Context
"Allow for this review" stores the exact command (ADR 0012). Claude rarely runs the same command
twice (`cat a.ts`, then `cat -n b.ts`, then `grep …`), so in practice every command showed a new
card, and a review that runs tests or explores the code asked again and again. Every Bash command
already runs in the review's OS sandbox: writes only inside the review's folder, no network.

## Options
1. **Keep exact match only.** Safest. Con: the clicks this ADR is about.
2. **Allow by program or prefix** (`npm test …`). Con: arguments change what runs, and a parser
   for "the same program" is easy to fool (`npm test; …`, `env x=… npm`).
3. **Auto-allow read-only commands** (`cat`, `ls`, `grep`). Con: more security-critical parsing
   (pipes, `find -exec`), and test runs would still ask.
4. **One click allows every Bash command of the review**, relying on the sandbox for the limits.
   Con: a prompt-injected command runs unasked, within those limits.

## Decision
Option 4, per review (the user's choice; not per project or app-wide, so the next PR, with its
own possible injection, asks once more):
- A Bash card offers **Allow all commands** next to "Allow for this review". It stores
  `ALL_COMMANDS` (`claude/grants.ts`): tool `Bash` with an empty scope, which no real command can
  match, since the gate refuses an empty command first. No migration.
- The gate allows any Bash command once that grant exists. Plain git is still pinned with
  `git -C` (ADR 0012).
- The same click allows the review's other Bash cards that are waiting. Web cards keep waiting.
- The grant survives fix-mode edits, unlike exact grants: unlimited Bash can already change and
  run any file in the folder, so dropping it after an Edit would protect nothing.
- Web access, reads outside the folder and edits outside fix mode still ask. The grant is removed
  with its review.

## Consequences
- One click per review instead of one per command.
- An injected command can read the user's files (the sandbox limits writes and network, not
  reads) and show them in the transcript. It cannot send them anywhere: no network, web calls
  still ask, and posting to GitHub needs the user's click.
- Writes inside the folder include `.git` in an in-place review, so a planted hook could run on
  the user's next own git command there. The app's git calls keep hooks off (ADR 0009); isolated
  worktrees (the default) are not the user's checkout.
- There is no way to take the grant back short of closing the review; a "Revoke" control would
  be the next step if needed.
