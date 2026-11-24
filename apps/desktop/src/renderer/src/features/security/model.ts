import type { Finding, SecurityCategory, SecurityCheckStatus, SecurityScan } from "@problem/shared";

/**
 * What a checklist row shows: Claude's result, "resolved" when it failed but the user dismissed
 * (or Claude withdrew) every finding of it, or "not-scanned" before the first scan.
 */
export type CheckDisplay = SecurityCheckStatus | "resolved" | "not-scanned";

/** A security finding the user still has to deal with: not withdrawn, not dismissed. */
export const isActive = (finding: Finding): boolean =>
  finding.securityCategory !== null &&
  finding.withdrawnReason === null &&
  finding.verdict !== "dismissed";

/**
 * A category fails while it has active findings, whatever the scan said. A failed check whose
 * findings were all dismissed or withdrawn is resolved; otherwise the row shows the scan's result.
 */
export function checkStatus(
  category: SecurityCategory,
  scan: SecurityScan | null | undefined,
  findings: readonly Finding[],
): CheckDisplay {
  if (findings.some((finding) => isActive(finding) && finding.securityCategory === category)) {
    return "fail";
  }
  const status = scan?.checks.find((check) => check.category === category)?.status;
  if (status === undefined) return "not-scanned";
  const closed = findings.some(
    (finding) => finding.securityCategory === category && !isActive(finding),
  );
  return status === "fail" && closed ? "resolved" : status;
}
