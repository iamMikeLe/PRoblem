# 0007. A project is its repository root; its review prompt is stored as text

- Status: accepted
- Date: 2026-11-17

## Context
Phase 1 lets the user register local git repositories as projects, each with the prompt a new
review starts from. Two questions follow. What identifies a project: the user can type a
subfolder, a trailing slash, a symlink or `~/...` for the same repository. And how is the
default prompt represented: the committed migration 1 already has `review_prompt TEXT NOT NULL`.

## Options
**Identity**
1. **Path as typed**: simple. Con: the same repository can be added several times.
2. **Reject anything that is not exactly the root**: strict. Con: unfriendly for a subfolder.
3. **Real path of `git rev-parse --show-toplevel`**: one row per work tree, whatever the input.
   Con: one git spawn per add; a repository's own config (`core.worktree`) can redirect it.

**Prompt**
1. **Store the text; copy the default at creation**: what you see is what Claude gets, fits
   the `NOT NULL` column. Con: an improved default does not reach existing projects.
2. **`NULL` means "use the default"**: defaults upgrade for free. Con: needs a table-rebuild
   migration, and "which prompt applies" is resolved in two places.

## Decision
- A project's `path` is the real path of its work-tree root (option 3). A subfolder is
  normalized up; a linked worktree is its own project; bare repositories are rejected.
  The root must contain the folder the user picked, so `core.worktree` cannot redirect it
  (`outside_repository`). Only a leading `~` / `~/` is expanded, with the user's home folder.
- The prompt text is stored (option 1). `DEFAULT_REVIEW_PROMPT` lives in `packages/shared`;
  "Reset to default" puts it back into the editor for the user to save, and the UI shows a
  Default/Custom badge.

## Consequences
- Duplicates are caught by `UNIQUE(path)` regardless of how the path was typed.
- Changing `DEFAULT_REVIEW_PROMPT` only affects new projects; the badge makes stale defaults
  visible, and a later "upgrade prompt" action can be added if needed.
- A folder that is not a repository but sits inside one (e.g. a dotfiles repository in `$HOME`)
  registers the enclosing repository. The dialog shows the resulting path.
- An unsaved prompt edit is discarded when another project is selected; the editor shows
  "Unsaved changes" while it is dirty. Keep drafts in a store if this becomes a problem.
- Phase 2 must decide what deleting a project with reviews does (block or cascade).
- Every later git call in a user or PR checkout must keep the same hygiene: argument arrays,
  `GIT_*` stripped from the environment, a timeout, and config that disables fsmonitor and hooks.
