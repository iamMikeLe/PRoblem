import type { Review } from "@problem/shared";

export const shortSha = (sha: string): string => sha.slice(0, 8);

/** "PR #7 · feature → main" or "feature → main", plus where it is checked out if in place. */
export function describeReview(review: Review): string {
  const range = `${review.headBranch} → ${review.baseBranch}`;
  const what =
    review.source.kind === "pull-request" ? `PR #${review.source.number} · ${range}` : range;
  return review.isolated ? what : `${what} · in project folder`;
}

/** Compact age like Teams' chat list: "now", "5m", "3h", "2d", then the date. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
