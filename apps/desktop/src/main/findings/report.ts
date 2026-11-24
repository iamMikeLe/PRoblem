import { realpathSync } from "node:fs";
import { isAbsolute, posix } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type Finding,
  SECURITY_CATEGORY_ORDER,
  SecurityCategorySchema,
  SecurityCheckStatusSchema,
  type SecurityScan,
  SeveritySchema,
} from "@problem/shared";
import { z } from "zod";
import {
  countAllFindings,
  type FindingContent,
  getFinding,
  getSecurityScan,
  insertFinding,
  listFindings,
  saveSecurityScan,
  updateFindingContent,
  type VerdictChange,
  withdrawFinding,
} from "./repository.ts";

/**
 * What Claude sends to the `report_findings` tool (ADR 0004). It is a raw zod shape because the
 * SDK's `tool()` takes one; `ReportSchema` is the same shape as an object.
 */
const NO_CONTROL = /^[^\p{Cc}]*$/u;
/** Findings per review, withdrawn ones included: bounds what a prompt-injected loop can store. */
export const MAX_FINDINGS_PER_REVIEW = 200;
const NumberSchema = z.number().int().positive().describe("The finding's number, e.g. 3 for #3.");
const fields = {
  severity: SeveritySchema.describe(
    "blocker: must be fixed before merging; major: should be fixed; minor: worth fixing; nit: optional polish.",
  ),
  security: SecurityCategorySchema.describe(
    "Only for a security problem: its category. Omit for any other finding.",
  ),
  // One line: titles are echoed into Claude's next prompt (verdictNote), so no line breaks.
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(NO_CONTROL, "A title is one line without control characters.")
    .describe("One line, like a commit subject."),
  file: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .regex(NO_CONTROL, "A path has no control characters.")
    .describe("Path relative to the repository root, e.g. src/app.ts. Omit for the whole change."),
  line: z.number().int().positive().describe("Line in the head version of the file."),
  problem: z.string().trim().min(1).max(10_000).describe("What is wrong and why (markdown)."),
  suggestion: z.string().trim().max(10_000).describe("The concrete change you suggest (markdown)."),
  reproduction: z
    .string()
    .trim()
    .max(10_000)
    .describe(
      "Numbered steps to reproduce the problem (in the UI, on the command line, with a request or a test), then the expected and the actual result (markdown). Give them for every finding that can be shown by running something, even when it takes setup; omit only when nothing can show it, such as a pure style nit.",
    ),
};

const NewFindingSchema = z.object({
  ...fields,
  security: fields.security.optional(),
  file: fields.file.optional(),
  line: fields.line.optional(),
  reproduction: fields.reproduction.optional(),
});

export const ReportShape = {
  add: z
    .array(NewFindingSchema)
    .max(50)
    .optional()
    .describe("New findings. Numbers are assigned for you."),
  update: z
    .array(
      z.object({
        number: NumberSchema,
        severity: fields.severity.optional(),
        security: fields.security
          .nullable()
          .optional()
          .describe("New security category, or null when it is not a security problem."),
        title: fields.title.optional(),
        file: fields.file.nullable().optional().describe("New path, or null to clear it."),
        line: fields.line.nullable().optional(),
        problem: fields.problem.optional(),
        suggestion: fields.suggestion.optional(),
        reproduction: fields.reproduction.optional(),
      }),
    )
    .max(50)
    .optional()
    .describe("Changes to existing findings; only the fields you pass change."),
  withdraw: z
    .array(z.object({ number: NumberSchema, reason: z.string().trim().min(1).max(2000) }))
    .max(50)
    .optional()
    .describe("Findings that no longer apply (for example fixed by a new commit), with why."),
  securityScan: z
    .object({
      summary: z
        .string()
        .trim()
        .min(1)
        .max(10_000)
        .describe(
          "What you scanned (files, kinds of change) and the outcome, in a few sentences (markdown).",
        ),
      checks: z
        .array(
          z.object({
            category: SecurityCategorySchema,
            status: SecurityCheckStatusSchema.describe(
              "fail: you reported security findings in this category; pass: checked, nothing found; not-applicable: the change cannot affect it.",
            ),
            note: z
              .string()
              .trim()
              .min(1)
              .max(1000)
              .describe("One or two sentences: what you looked at for this category."),
          }),
        )
        .max(SECURITY_CATEGORY_ORDER.length)
        .describe("Exactly one entry per security category."),
    })
    .optional()
    .describe(
      "The security scan of the change. Send it after every review pass, also when nothing was found; it replaces the previous scan.",
    ),
};
export const ReportSchema = z.object(ReportShape);
export type Report = z.infer<typeof ReportSchema>;

export const REPORT_TOOL_DESCRIPTION = `Save your review findings in PRoblem, where the user accepts or dismisses them.
Call it whenever your findings change: add new ones, update existing ones by number, withdraw ones that no longer apply.
The app assigns numbers (#1, #2, ...) and returns them; refer to findings by these numbers afterwards.
Report each distinct problem once; do not re-add a finding that already has a number.`;

export type ReportOutcome =
  | { ok: true; text: string; findings: Finding[]; scan: SecurityScan | null }
  | { ok: false; text: string };

/**
 * A path as Claude gives it, made relative to the review's folder. Paths that leave the folder are
 * refused: they end up in an editor command line (`editor:open`).
 */
export function normalizeFindingPath(file: string, workdir: string): string | undefined {
  let path = file.replaceAll("\\", "/");
  if (isAbsolute(path)) {
    const roots = [workdir, realpathOrSelf(workdir)].map((root) =>
      root.replaceAll("\\", "/").replace(/\/+$/, ""),
    );
    const root = roots.find((candidate) => path.startsWith(`${candidate}/`));
    if (root === undefined) return undefined;
    path = path.slice(root.length + 1);
  }
  if (path.startsWith("~")) return undefined;
  const normalized = posix.normalize(path).replace(/^(\.\/)+/, "");
  if (
    normalized === "." ||
    normalized === "" ||
    normalized.startsWith("../") ||
    normalized === ".."
  )
    return undefined;
  if (normalized.split("/").some((part) => part.toLowerCase() === ".git")) return undefined;
  return normalized;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Applies a report: everything is checked first and saved in one transaction, so a report with a
 * mistake saves nothing and Claude can correct it and call again.
 */
export function applyReport(
  db: DatabaseSync,
  reviewId: string,
  workdir: string,
  input: unknown,
  now: Date,
): ReportOutcome {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, text: `Nothing was saved: ${z.prettifyError(parsed.error)}` };
  }
  const report = parsed.data;
  const problems: string[] = [];

  const location = (
    file: string | null | undefined,
    line: number | null | undefined,
    label: string,
  ): { file: string | null; line: number | null } | undefined => {
    if (file === null || file === undefined) {
      if (line !== null && line !== undefined) problems.push(`${label}: a line needs a file.`);
      return { file: null, line: null };
    }
    const path = normalizeFindingPath(file, workdir);
    if (path === undefined) {
      problems.push(
        `${label}: ${file} is outside the repository; use a path relative to its root.`,
      );
      return undefined;
    }
    return { file: path, line: line ?? null };
  };

  const additions: FindingContent[] = [];
  for (const [index, item] of (report.add ?? []).entries()) {
    const where = location(item.file, item.line, `add[${index}]`);
    if (where) {
      const { security, ...rest } = item;
      additions.push({
        ...rest,
        securityCategory: security ?? null,
        reproduction: item.reproduction ?? "",
        ...where,
      });
    }
  }

  const updates: { number: number; content: FindingContent }[] = [];
  for (const item of report.update ?? []) {
    const label = `#${item.number}`;
    const current = getFinding(db, reviewId, item.number);
    if (!current) {
      problems.push(`${label} does not exist.`);
      continue;
    }
    if (current.withdrawnReason !== null) {
      problems.push(`${label} was withdrawn; add a new finding instead.`);
      continue;
    }
    const file = item.file === undefined ? current.file : item.file;
    const line =
      item.line === undefined ? (item.file === undefined ? current.line : null) : item.line;
    const where = location(file, line, label);
    if (!where) continue;
    updates.push({
      number: item.number,
      content: {
        severity: item.severity ?? current.severity,
        securityCategory: item.security === undefined ? current.securityCategory : item.security,
        title: item.title ?? current.title,
        problem: item.problem ?? current.problem,
        suggestion: item.suggestion ?? current.suggestion,
        reproduction: item.reproduction ?? current.reproduction,
        ...where,
      },
    });
  }

  for (const item of report.withdraw ?? []) {
    const current = getFinding(db, reviewId, item.number);
    if (!current) problems.push(`#${item.number} does not exist.`);
    else if (current.withdrawnReason !== null)
      problems.push(`#${item.number} is already withdrawn.`);
  }
  const scan = report.securityScan;
  if (scan) {
    const reported = scan.checks.map((check) => check.category);
    if (new Set(reported).size !== reported.length) {
      problems.push("securityScan: a category is listed twice.");
    }
    const missing = SECURITY_CATEGORY_ORDER.filter((category) => !reported.includes(category));
    if (missing.length > 0) {
      problems.push(`securityScan: add a check for ${missing.join(", ")}.`);
    }
  }
  const total = countAllFindings(db, reviewId) + additions.length;
  if (additions.length > 0 && total > MAX_FINDINGS_PER_REVIEW) {
    problems.push(
      `A review keeps at most ${MAX_FINDINGS_PER_REVIEW} findings; update or merge existing ones instead.`,
    );
  }

  if (problems.length > 0) {
    return { ok: false, text: `Nothing was saved:\n- ${problems.join("\n- ")}` };
  }
  if (additions.length + updates.length + (report.withdraw?.length ?? 0) === 0 && !scan) {
    return { ok: false, text: "Nothing was saved: the report is empty." };
  }

  const saved: string[] = [];
  db.exec("BEGIN");
  try {
    for (const content of additions) {
      const number = insertFinding(db, reviewId, content, now);
      saved.push(`#${number} added: ${content.title}`);
    }
    for (const { number, content } of updates) {
      updateFindingContent(db, reviewId, number, content, now);
      saved.push(`#${number} updated`);
    }
    for (const { number, reason } of report.withdraw ?? []) {
      withdrawFinding(db, reviewId, number, reason, now);
      saved.push(`#${number} withdrawn`);
    }
    if (scan) {
      const order = SECURITY_CATEGORY_ORDER;
      const checks = [...scan.checks].sort(
        (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
      );
      saveSecurityScan(db, reviewId, { summary: scan.summary, checks }, now);
      saved.push("security scan");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    ok: true,
    text: `Saved:\n- ${saved.join("\n- ")}`,
    findings: listFindings(db, reviewId),
    scan: scan ? getSecurityScan(db, reviewId) : null,
  };
}

const VERDICT_WORDS = { accepted: "accepted", dismissed: "dismissed", open: "reopened" } as const;

/**
 * The note that starts the user's next message when they changed verdicts since the last one, so
 * Claude does not argue for dismissed findings again. `undefined` when there is nothing to tell.
 */
export function verdictNote(changes: readonly VerdictChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  const lines = changes.map(
    // The title is quoted, so it reads as data even though Claude wrote it.
    (change) =>
      `- ${VERDICT_WORDS[change.verdict]} #${change.number} ${JSON.stringify(change.title)}`,
  );
  return `[PRoblem] Since my last message I have:\n${lines.join("\n")}`;
}
