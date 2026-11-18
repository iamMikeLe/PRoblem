# 0005. App-owned PreToolUse permission gate

- Status: accepted (deny-only form in Phase 3, ADR 0010; approvals in Phase 5)
- Date: 2026-11-17

## Context
Claude reviews code written by others; the PR itself may contain prompt injection. Reviewing must
be read-only by default, and the user's own Claude Code allow rules (made for their own work) must
not silently widen what runs during a review.

## Options
1. **`canUseTool` callback**: simple. Con: skipped when a settings rule already allows the call.
2. **`PreToolUse` hook registered by the app**: sees every tool call, including MCP and subagent
   tools, regardless of settings. Con: we maintain the read-only allowlist ourselves.
3. **OS sandbox only**: strong isolation. Con: no per-call approval UX; platform-specific.

## Decision
A `PreToolUse` hook decides every call: allow (read-only tools, allowlisted read-only commands,
`report_findings`), deny, or ask the user through an approval card. Sandboxing Bash on top is
a candidate hardening step.

## Consequences
- The allowlist parser is security-critical: unit-tested heavily, and audited by `security-auditor`.
- Approval waits block the turn; the UI must make waiting reviews obvious (`needs-input`).
