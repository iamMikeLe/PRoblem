# 0013. The Changes view, and moving a review to new commits

- Status: accepted
- Date: 2026-11-18

## Context
A review needs to show what the pull request changes, with Claude's findings on their lines. A
review also falls behind when the branch gets new commits. All of this works on code the pull
request controls: its file names, its `.gitattributes`, its folder layout.

## Options
Diff rendering:
1. **A diff library** (react-diff-view, diff2html). Con: one more dependency, and its own HTML/CSS to fit into Fluent tokens.
2. **Parse git's unified diff in main and render it with our own table.** Con: we own the parser.

Noticing new commits (the user chose 2):
1. Fetch every open review every few minutes. Con: background network traffic.
2. **Check when the Changes tab opens, and on "Check now".**

After a refresh (the user chose 2):
1. Start a Claude turn automatically. Con: a turn costs money each time.
2. **A note on the user's next message**, like the verdict note (ADR 0004).

## Decision
- Option 2 for rendering: `git/diff.ts` parses each file's diff into hunks with line numbers on
  both sides. The UI offers unified and split layouts, and the choice is remembered per viewer.
- **What is compared:** the merge base (or the base, for unrelated histories) with the head.
  Only commits are compared, never the working tree.
- **The diff calls are safe on hostile repositories:**
  - Every diff runs with `--no-ext-diff --no-textconv`. A test plants a diff driver and a text
    converter and checks they never run.
  - Paths are literal (`--literal-pathspecs`), so a file named `*.md` or `:(top)x` never matches other files.
  - Each hunk is read by the line counts in its header, so text that looks like a header, or a
    blank context line, cannot shift line numbers or mix in another file.
  - Output over 2 MB per file is shown as "too large", and file lists are cached per commit pair.
- **Filters** hide tests, generated files and glob patterns, saved per project.
  - Nothing is hidden by default.
  - Hidden files are always listed by name, since a pull request could hide a real change in a `build/` folder.
  - Globs use a memoized matcher, so no pattern can make it take exponential time.
- **Check** fetches the pull request or branch the same way creating a review does. It reports the
  new commits, and a rewritten history (the old head is not an ancestor).
- **Refresh:**
  - **Locking:** it runs under `sessions.withoutTurns`, so no turn runs or starts while the
    folder moves.
  - **Refusals:** it refuses uncommitted changes in the review's folder (fix mode edits). In-place
    reviews also refuse when ignored files are at risk.
  - **The move:** it checks out the new head with hooks and fsmonitor disabled, and recomputes the
    base and merge base.
  - **Telling Claude:** it records `moved_from_sha` (the oldest head Claude has not been told
    about). The next message starts with "[PRoblem] The review was refreshed: the head moved from
    A to B", with the `git log` and `git diff` commands to see the change. That note is cleared
    once Claude has started the turn.

## Consequences
- No new dependency. The parser and the git calls have tests on real repositories.
- Findings point to lines of the head version. After a refresh, Claude updates them when it
  re-checks, prompted by the note.
- Residual risk: `git status` before a refresh still applies a *clean* filter the user configured
  globally to files the pull request assigns to it (same class as ADR 0009 and ADR 0010).
