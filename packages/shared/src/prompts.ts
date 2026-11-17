/**
 * The review prompt a new project starts with. The text is copied into the project when it is
 * created (ADR 0007), so editing this constant changes new projects only.
 */
export const DEFAULT_REVIEW_PROMPT = `Review the changes on this branch against its base.

Focus on what would hurt in production, in this order:
1. Correctness: logic errors, broken edge cases, wrong assumptions about inputs.
2. Security: injection, missing authorization, secrets, unsafe handling of untrusted data.
3. Data integrity: data loss, migrations, transactions, race conditions.
4. Error handling and resilience: swallowed errors, missing timeouts, unclear failure modes.
5. Tests: behavior that changed without a test that would catch a regression.
Mention style only when it hides a real problem.

For every finding:
- point to the exact file and line,
- give a severity: blocker, major, minor or nit,
- explain the problem and the concrete change you suggest.

Do not modify any files. Do not repeat issues already raised in existing review comments.
If the change looks good, say so briefly and explain what you checked.`;
