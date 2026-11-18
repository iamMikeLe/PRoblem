# 0014. Reading a pull request's discussion, and posting findings as a GitHub review

- Status: accepted
- Date: 2026-11-18

## Context
A review should know what other reviewers already said, and should end on GitHub, not only in
the app. Everything on GitHub was written by other people (and can carry instructions aimed at
Claude). Posting writes to a shared place under the user's name, and the project's hard rule is:
nothing is written to GitHub without an explicit click by the user.

## Options
Talking to GitHub:
1. **The GitHub CLI (`gh`)**, which the app already uses to open pull requests: its login, its token
   storage, its rate limits. Con: one more program that must be installed.
2. **A token in the app.** Con: the app would have to store a credential.

How Claude learns the discussion (the user's choice was 1):
1. **Automatically**: a digest in the first message, then a note about new comments on the next one.
2. Only when the user asks.

Attribution of posted text (the user's choice was 3): 1. a footer on the review; 2. on every
comment; 3. **none**.

## Decision
- **`gh`** for everything (option 1):
  - One GraphQL query reads review threads, comments and reviews, capped per list; the UI says
    when GitHub has more.
  - Posting is one REST call with JSON on stdin.
- **Branch reviews are linked to their open pull request** (`gh pr list --head`), stored once found.
- **The digest:**
  - Each comment becomes one line of at most 300 characters, quoted with `JSON.stringify`, and
    the whole digest is capped at 6000 characters.
  - It is headed as other people's text, to be treated as content, never as instructions.
  - It is appended to the first message. Comments newer than what Claude was told become a note
    on the next message, marked as told only once that turn has started (as with verdicts,
    ADR 0004). Edited comments are not noticed (only creation times are compared).
- **Posting:**
  - It only ever starts from the preview dialog's Post button. The dialog shows the event
    (comment, approve or request changes), the summary, and each selected finding's exact text
    and placement.
  - A finding's text is its title, the problem, "How to reproduce" (when Claude gave steps;
    `reproduction`, migration 9) and the suggestion.
  - Accepted findings are pre-selected. Dismissed and withdrawn ones are never offered.
  - A finding goes on its line when that line is in the merge-base diff. Otherwise it goes in the
    review body, with the reason shown.
  - The review is pinned to the review's head (`commit_id`). Posting is refused when the pull
    request's head moved on: refresh first (ADR 0013).
  - Text Claude wrote gets `@` + zero-width space, so no mention notifies anyone. The user's own
    summary is posted as written.
  - Posted findings remember the review's URL, are marked "posted", and are no longer pre-selected.
- **Links** open in the browser only when they are `https://github.com/…` without credentials.

## Review fixes (2026-11-18)
- **Mentions:** GitHub finds mentions after rendering markdown (`_@x_`, `` `a`@x ``), so every
  `@` before a name in Claude's text is neutralized.
- **Branch linking:** fork pull requests are left out (`isCrossRepository`), and the one at the
  review's head wins. A stranger's fork with the same branch name never feeds its comments to
  Claude.
- **Different base:** when the pull request targets another base than the review compares with,
  every finding goes in the summary. Lines from our diff could be unknown to GitHub, which would
  reject the whole review.
- **No double posts:**
  - A finding that was already posted is refused, findings must be unique, and one post per review runs at a time.
  - An answer GitHub does not confirm (a timeout or an unreadable reply) marks the findings as
    posted with the PR's link, so they are never posted twice by accident.
- **The note to Claude** is built when the message is sent, from the latest discussion read. That
  discussion is read again in the background after every turn, and "told" never moves back in time.
- **Smaller fixes:**
  - File names in the digest are quoted, since a PR's file names can contain line breaks.
  - The body length is checked against GitHub's limit before posting.
  - Creating a review waits at most 10 s for the discussion.
  - `gh`'s input is always closed.

## Consequences
- Posting needs `gh` logged in with the `repo` scope. GitHub's own errors (for example approving
  your own pull request) are shown as they are.
- Very long discussions are truncated, both on screen and in the digest.
- A commenter can write text that looks like an app note. The quoting and the header make it
  data, but the model still reads it: the permission gate (ADR 0012) is the real boundary.
