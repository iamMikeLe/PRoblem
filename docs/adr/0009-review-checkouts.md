# 0009. How a review checks out code

- Status: accepted
- Date: 2026-11-17

## Context
A review needs the pull request's code on disk, so Claude can read it and later run it. That code
is written by someone else and must be treated as hostile. The user also keeps working in the
same repository, so a review must not disturb their checkout unless they ask for it.

## Options
1. **Isolated worktree per review** (`git worktree add --detach`): parallel reviews, the user's
   checkout is untouched. Con: disk space; tools that need a full setup (node_modules) start cold.
2. **In-place, on a local branch** (create or move `pr/<n>` and check it out): familiar for running
   the code. Con: creates and moves branches in the user's repository and leaves them there.
3. **In-place, detached** at the review's commit, restoring the previous branch on close.

## Decision
Isolated worktrees by default; in-place as an opt-in using option 3, at most one per project
(partial unique index `reviews_one_in_place`, plus a per-project queue in the service). In-place
refuses to start over uncommitted tracked changes and never switches back over them on close.

Supporting rules:
- **No hooks on checkout.** Every fetch, worktree add and checkout runs with
  `-c core.hooksPath=/dev/null`. With an in-tree hooks folder (husky), hooks come from the PR
  itself and would run on checkout. A test plants a `post-checkout` hook and proves it never runs.
- **Nothing from the PR runs or downloads on checkout**: the same commands also set
  `submodule.recurse=false`, fetch with `--no-recurse-submodules`, and set
  `GIT_LFS_SKIP_SMUDGE=1` (a PR's `.lfsconfig` could point LFS at any server).
- **Tools are never resolved relative to a review folder**: relative and empty `PATH` entries
  (`./node_modules/.bin`) are dropped at startup, or a PR could ship its own `git`.
- **In-place never destroys local files**: it refuses when the review's commit tracks a path
  that is an ignored file in the user's checkout (`.env`, build output), because `git checkout`
  overwrites ignored files silently and switching back would delete them. On close it switches
  back only if the folder is still exactly where the review left it (detached at the review's
  head, no uncommitted changes); otherwise it leaves the folder alone and says why.
- **Close never gets stuck**: if cleanup fails (project moved, branch deleted), the review is
  still archived and the note says what was left behind.
- **A failed fetch is an error**, except "the remote has no such branch" (then a local branch is
  used): reviewing a stale local copy silently would be worse.
- **Pull requests are fetched into our own namespace** (`refs/reviewroom/pull/<n>`), not
  `FETCH_HEAD`, so parallel starts do not race.
- **Inputs never reach git as options**: branch names pass `git check-ref-format` and may not
  start with `-`; positional arguments follow `--end-of-options`; PR links must be
  `https://github.com/<owner>/<repo>/pull/<n>` for a repository that is one of the project's remotes.
- **Close only deletes what we created**: a worktree is removed only if it lies inside
  `~/.reviewroom/worktrees`.
- The base defaults to the PR's base branch, else the remote's default branch (`origin/HEAD`).
  Unlike the reference tool, we do not guess the branch a feature split off from; the user can
  pick another base in the dialog.

## Consequences
- Many reviews can run side by side; in-place is for the "I want to run it in my IDE" case.
- Projects with open reviews cannot be removed (their worktrees would be orphaned).
- Residual risk: a filter driver the user configured themselves (e.g. git-crypt) still runs on
  files a PR marks with that filter in `.gitattributes`. It is the user's own program, but it
  gets PR content as input.
- The new rules came out of the Phase 2 security and code review; each has a regression test.
- Disabling hooks also disables legitimate ones (e.g. Git LFS `post-checkout`); LFS files then
  stay pointers in review worktrees. Acceptable for reading code; revisit if Fix mode needs it.
- Worktrees cost disk space; closing a review removes its worktree.
