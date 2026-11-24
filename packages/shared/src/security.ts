import { z } from "zod";

/**
 * The security scan of a review. Claude checks every category on every review and reports a scan
 * through `report_findings`, even when nothing is wrong, so the Security tab always says what was
 * checked. Security findings are ordinary findings with a `securityCategory`.
 */

export const SecurityCategorySchema = z.enum([
  "secrets",
  "sensitive-data",
  "injection",
  "attack-surface",
  "unsafe-practices",
]);
export type SecurityCategory = z.infer<typeof SecurityCategorySchema>;

/** Label and what each category covers; shown in the checklist and given to Claude. */
export const SECURITY_CATEGORIES: Record<SecurityCategory, { label: string; covers: string }> = {
  secrets: {
    label: "Leaked secrets and credentials",
    covers:
      "API keys, tokens, passwords, private keys, connection strings, .env contents committed in code, config, tests or fixtures",
  },
  "sensitive-data": {
    label: "Sensitive and personal data",
    covers:
      "personal data, customer records or internal details committed, logged, sent to third parties or exposed in errors",
  },
  injection: {
    label: "Injection",
    covers:
      "SQL, NoSQL, OS command, template, LDAP and XSS injection from untrusted input; unescaped output",
  },
  "attack-surface": {
    label: "Other exploitable vulnerabilities",
    covers:
      "missing authentication or authorization, path traversal, SSRF, open redirects, CSRF, insecure file uploads, race conditions an attacker can use",
  },
  "unsafe-practices": {
    label: "Dangerous practices",
    covers:
      "insecure defaults, unsafe deserialization, weak or home-made crypto, disabled TLS or validation, overly broad permissions, vulnerable dependencies",
  },
};

export const SECURITY_CATEGORY_ORDER: readonly SecurityCategory[] = SecurityCategorySchema.options;

/** `fail`: problems found (reported as findings); `not-applicable`: the change cannot affect it. */
export const SecurityCheckStatusSchema = z.enum(["pass", "fail", "not-applicable"]);
export type SecurityCheckStatus = z.infer<typeof SecurityCheckStatusSchema>;

export const SecurityCheckSchema = z.object({
  category: SecurityCategorySchema,
  status: SecurityCheckStatusSchema,
  /** One or two sentences: what was looked at for this category. */
  note: z.string(),
});
export type SecurityCheck = z.infer<typeof SecurityCheckSchema>;

/** The latest security scan of a review; each report replaces the previous one. */
export const SecurityScanSchema = z.object({
  reviewId: z.string(),
  /** Markdown: what was scanned and the outcome. */
  summary: z.string(),
  /** One entry per category Claude reported, in `SECURITY_CATEGORY_ORDER`. */
  checks: z.array(SecurityCheckSchema),
  updatedAt: z.iso.datetime(),
});
export type SecurityScan = z.infer<typeof SecurityScanSchema>;
