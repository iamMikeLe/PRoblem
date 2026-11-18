# 0012. Approval cards, "Allow for this review" and fix mode

- Status: accepted
- Date: 2026-11-18

## Context
Until Phase 5 a review was read-only: everything the read-only policy did not allow was refused
(ADR 0010). Reviews also need to run tests, look at the web, or fix what they found, and the user
decides that per call. The pull request can prompt-inject Claude, so a call must never run just
because Claude asked convincingly.

## Options
For asking the user:
1. **`permissionDecision: "ask"` from the app's `PreToolUse` hook, answered in `canUseTool`.**
   The SDK keeps Claude waiting while `canUseTool` awaits the user. Con: the answer is lost when
   the app quits.
2. **Deny, show a card, and let the user re-send the request as a message.** Con: clumsy, and
   Claude may retry in another form.

For "allow again":
1. **Exact match.** The same Bash command string, or the same path for Read/Edit/Write.
2. **Same program or prefix** (all `npm test …`). Con: arguments change what runs.

## Decision
- Option 1 for asking, and exact match for "Allow for this review" (the user's choice).
- `decideToolUse` (`claude/policy.ts`) returns allow, deny or ask:
  - **Allow:**
    - reading inside the review's folder;
    - read-only git (allowlist, ADR 0010);
    - `report_findings`;
    - edits inside the folder in fix mode;
    - an exact grant.
  - **Ask:** any other Bash command, reading or searching outside the folder, edits when fix mode
    is off, WebFetch and WebSearch. Web access never gets "Allow for this review": a URL can
    carry data out.
  - **Deny:** edits outside the folder or in any `.git`. Also any tool not in the list.
    Paths resolve through the deepest folder that exists, so a write under a symlinked folder
    is placed where it would really land.
- `canUseTool` runs the gate again before showing a card. A probe showed that a hook's "ask"
  reaches `canUseTool` even when a settings allow rule matches, so the user's own allow rules
  cannot skip a card.
- **Pending cards** live in memory in main (`claude/approvals.ts`).
  - The renderer loads them with `approvals:list` and follows `review.approval` /
    `review.approvalDone` events, so a page reload keeps them.
  - Stop, close and quit expire them. After a restart the turn is reported as interrupted (ADR 0010).
  - Each answer is stored as an `approval` entry in the transcript.
- **Waiting reviews** show `needs-input`. If the window is not focused, a native notification
  appears, and clicking it shows the review. The dock badge counts the waiting reviews.
- **Fix mode** is a per-review switch (`reviews.fix_mode`), off by default. The gate reads it at
  every call, and the system prompt states it at the start of each turn.
- **Grants** are stored in `review_grants` and deleted with their review.

## Security audit (2026-11-18)
The audit found the following, and each has a regression test:
- **High: a write through a symlink whose target does not exist yet** counted as inside the
  folder. Example: a PR ships `notes.md -> ../../.zshenv` or `hook -> .git/hooks/post-checkout`.
  Fix: a path part that exists but cannot be resolved is never inside.
- **High: the card could hide the command that runs.**
  - The cause: the card showed only the first line, shortened, and the full request was cut
    at 20 000 characters. So a command padded with spaces, or a second line, could hide a
    `;curl …`.
  - The fix:
    - The card shows the exact command, URL, query or path, never shortened.
    - Requests too long to show (over 4 000 characters, or over 20 000 for the full request)
      are refused.
    - Control, bidi and non-ASCII characters are shown as `\u{…}`.
    - Notifications never contain Claude's text.
- **Medium: a Bash grant plus an edit.** `npm test` allowed for the review would run code Claude
  had just edited in fix mode. Fix: every allowed Edit or Write removes the review's Bash grants.
- **Low: an approved `cd` moved the git commands that run without a card.** Fix: they are
  rewritten to `git -C '<folder>' …`.
- **Low: a tool could run without the hook** (if a setting disabled it). Fix: a tool result for
  a call the gate never saw stops the turn with an error.
- **Low: card flooding.** Fix: at most 5 waiting cards per review, and one notification per
  review.

## Sandbox (follow-up, 2026-11-18)
An approved command used to run with the user's full rights. Every Bash command of a review now
runs in Claude Code's OS sandbox (`REVIEW_SANDBOX` in `claude/sessions.ts`; seatbelt on macOS).
This was the user's choice: sandbox, no network.
- **What the sandbox allows:** writes only inside the review's folder, and no network
  (`allowedDomains: []`, `strictAllowlist`).
- **No escape:** `allowUnsandboxedCommands: false`, so Claude cannot opt a command out, and
  `failIfUnavailable: true`, so a missing sandbox stops the turn rather than running commands
  unsandboxed.
- **Still asks:** `autoAllowBashIfSandboxed: false`, so sandboxed commands still need the gate's approval.
- **Verified in a real run:**
  - A write inside the folder worked.
  - A write to the home folder failed with `EPERM`.
  - `curl` was blocked (`deny network-outbound`).
- The system prompt asks Claude to request approval-needing calls one at a time. Claude Code
  withdraws an older permission request when a newer one arrives, so parallel requests would
  lose all but the last.

## Consequences
- A card blocks only its own review. The other reviews keep running.
- When Claude makes several calls at once, Claude Code may withdraw an older request ("a newer
  request superseded it"). The transcript then shows "Withdrawn before you answered".
- An approved command runs in the sandbox. It can read the user's files but write only inside the
  review's folder and reach no network, so installs and downloads fail inside reviews.
- Fix-mode edits are blocked inside `.git`. An approved Bash command can still write anywhere,
  so the app's own git calls keep hooks disabled (ADR 0009).
