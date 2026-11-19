# 0017. The user edits each finding's text before posting; main posts exactly that text

- Status: accepted (amends 0014)
- Date: 2026-11-19

## Context
The post dialog (ADR 0014) showed each finding's text read-only, and main rebuilt the text itself
when posting. Claude's wording is often close but not quite what the user wants to say under their
own name: a softer tone, a shorter suggestion, a link, a mention of the right teammate. Copying the
text to GitHub by hand defeats the dialog. Two rules still hold: nothing reaches GitHub without
the user's click, and every IPC input is validated by zod in the dispatcher.

## Options
Where the final text comes from:
1. **The renderer sends each selected finding's final text** (`findings: { number, text }[]`):
   main posts exactly what the user saw. Con: main no longer owns the text, so it must check it
   (size, non-empty) and keep checking which findings may be posted and where.
2. **Main rebuilds the text and the renderer sends only edits.** Two sources of truth; what is
   posted could differ from what was on screen.
3. **Edit after posting, on GitHub.** No work here, but the first version (and its notifications)
   goes out as Claude wrote it.

Mentions in edited text:
1. **Neutralize everything, always.** Safe, but the user cannot mention a teammate they mean to.
2. **Neutralize Claude's text; post the user's edit as typed.**
3. Neutralize nothing. An unedited Claude text could ping anyone a pull request mentions.

## Decision
- **Option 1.** `PostReviewRequestSchema.findings` is a list of strict `{ number, text }`. Each text
  must be non-empty after trimming and at most 65,536 characters (GitHub's comment limit), all
  texts together at most 1,000,000, numbers unique, at most 200. The text is never trimmed or
  changed: what the user saw is what is posted.
- Main still decides everything else from its own preview: only findings it offers (not dismissed,
  withdrawn or already posted), inline only when the line is in the diff, otherwise in the
  summary, whose total length is checked against GitHub's limit with the edited texts.
- **Mentions, option 2.** The preview's text stays neutralized (`@` + zero-width space), so an
  unedited finding never notifies anyone, and Claude's mentions stay neutralized inside an edit
  unless the user deletes the invisible character. Text the user typed is the user's own words,
  shown in full before the click, and is posted as typed: an `@name` they type notifies. The
  dialog says so under each edited finding.
- The dialog has Write / Preview tabs (the app's GitHub-flavored renderer, no new dependency), a
  "Reset to Claude's text" action, and the same editor for the summary.
- **Edits live only in the dialog.** Closing it drops them; they are not stored.

## Consequences
- The user can fix wording, tone and mentions before anything is posted, and sees the rendered
  result first.
- Main can no longer guarantee that no posted text mentions anyone: it guarantees that only for
  text the user did not change. A compromised renderer could send any text, but it could already
  send any summary; the click and the preview remain the boundary.
- The preview is the app's renderer, not GitHub's: links and images show as text, raw HTML is not
  rendered, and GitHub-only syntax (issue references, emoji shortcodes) looks different.
- Edits are lost when the dialog closes, including by accident. Storing drafts would need a table
  and a rule for when a draft goes stale after Claude updates a finding; not worth it yet.
