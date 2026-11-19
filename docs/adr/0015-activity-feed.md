# 0015. The Activity feed: a stored list of what happened in open reviews

- Status: accepted
- Date: 2026-11-19

## Context
Several reviews run at once. While the user reads one, others finish, fail, wait for an
approval, or get new commits and PR comments. The status dots show the current state of each
review, not what happened since the user last looked. The Activity rail item, a placeholder until
now, should answer "what needs me?" across all reviews, as Teams' Activity does.

## Options
1. **Derive the feed from existing tables** (conversation entries, findings, reviews). No new
   storage. Con: there is nothing to derive "read" from, verdicts and PR comments keep no history,
   and new commits and comments are not stored at all.
2. **A stored feed:** the services that see an event write a row. One more table, and one call at
   each place that knows something happened.
3. **Notifications only** (the native one already used for approvals). Con: gone once dismissed,
   and noisy if used for every finished turn.

## Decision
Option 2, the `activity` table (migration 10):
- **What is listed** (only what Claude or GitHub did, plus posting, which leaves the app):
  - an approval asked: one row per wait, not per card. It is marked read once the review's cards
    are answered, since it no longer asks for anything;
  - a turn finished, with the findings it added and the most severe of them; or failed, with the
    first line of its error. A stopped turn is the user's own doing and is not listed;
  - new commits on the branch or pull request: once per new head, however often it is checked,
    and marked read once the review is refreshed to them. The check also runs in the background
    after a turn (see below);
  - new PR comments: newer than the newest comment already listed, told to Claude, read earlier
    in this run, or the user's own post. A discussion never seen before is not news (it is the
    first digest, ADR 0014). Times are compared as instants, since GitHub's have no
    milliseconds;
  - a GitHub review posted, with its link and GitHub's time of the post (the user's own comments
    are never news, even when the local clock runs behind GitHub's).
- **Rows** hold the review id, the kind, a JSON detail checked with zod on the way out (a row a
  later version cannot read is skipped), the time and when it was read. The newest 500 are kept.
  Closed reviews' rows leave the list.
- **Recording never throws**: a broken feed must not break the turn or the post it reports on.
- **The window** is told with `activity.changed` and loads the list again. `activity:list` and
  `activity:markRead` go through the dispatcher like every other channel.
- **The UI:** the feed is the list pane, with All and Unread filters and "Mark all as read". A row
  opens its review beside the feed, on the tab or finding it is about, and is marked read. The
  rail shows the unread count. "Mark all as read" marks the rows on screen, never one that
  arrived in the meantime.

## Review fixes (2026-11-19)
The code, security and UI reviewers found, and these were fixed:
- **The background check raced with Refresh.** It fetched the same refs outside the project's
  queue, so a user's Refresh could fail with "cannot lock ref". It now runs in that queue, at most
  once per 5 minutes and one at a time per review, and records nothing if the review was
  refreshed or closed during the fetch.
- **Background fetches were interactive.** Nobody asked for them, yet they could show a
  credential or passphrase dialog and start `git gc`. They now run with
  `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS_REQUIRE=never`, `credential.interactive=never` and no
  auto maintenance.
- **The first comments on a PR that had none** were taken as already seen; they are now listed.
- **Approval rows stayed unread after a quit**: `recover()` marks them read.
- Reading the newest row can no longer throw into the work it serves; inserting and trimming run
  in one transaction; ids sent to `activity:markRead` are limited in length.
- UI: the placeholder is a `main` landmark; closing a review removes its rows at once; rows'
  labels include the project and age; the unread dot is a Fluent `Badge`.

## Consequences
- A new kind of event is one schema case, one `record` call and one line in the UI's description.
- Every finished turn is a row, including answers to follow-up questions. If that is too noisy,
  rows can be grouped per review later.
- New commits are noticed only when a check runs: after a turn (at most every 5 minutes per
  review), or when the Changes tab opens. There is no timer.
- Comments of a pending GitHub review carry their draft time; when that review is submitted
  later, its comments can be older than the newest seen and are not listed.
- The feed is per machine and per app data folder, like everything else.
