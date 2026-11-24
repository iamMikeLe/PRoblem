import { type ActivityDetail, type ActivityItem, hostLabel } from "@problem/shared";
import type { SearchTarget } from "../search/GlobalSearch.tsx";

const SEVERITY = { blocker: "Blocker", major: "Major", minor: "Minor", nit: "Nit" } as const;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The row's headline and its second line, e.g. "Review finished" / "2 new findings · #4 Blocker: …". */
export function describeActivity(detail: ActivityDetail): { title: string; summary: string } {
  switch (detail.kind) {
    case "approval":
      return { title: "Needs your approval", summary: `Claude wants to use ${detail.toolName}` };
    case "finished":
      return {
        title: "Claude finished",
        summary:
          detail.added === 0
            ? "No new findings"
            : `${plural(detail.added, "new finding")}${
                detail.top
                  ? ` · #${detail.top.number} ${SEVERITY[detail.top.severity]}: ${detail.top.title}`
                  : ""
              }`,
      };
    case "failed":
      return { title: "Claude failed", summary: detail.message || "The turn ended with an error" };
    case "commits":
      return {
        title: detail.rewritten ? "History rewritten" : "New commits",
        summary: detail.rewritten
          ? "The branch was force-pushed; refresh to review the new head"
          : `${plural(detail.newCommits, "new commit")}; refresh to review them`,
      };
    case "comments":
      return { title: "New PR comments", summary: plural(detail.count, "new comment") };
    case "posted":
      return {
        title: `Posted to ${hostLabel(detail.url)}`,
        summary: `${plural(detail.findings, "finding")} on the pull request`,
      };
  }
}

/** Where a row takes the user: the tab (or finding) it is about. */
export function activityTarget(item: ActivityItem): SearchTarget {
  const { reviewId, detail } = item;
  switch (detail.kind) {
    case "finished":
      return detail.top
        ? { kind: "finding", reviewId, number: detail.top.number }
        : { kind: "tab", reviewId, tab: "conversation" };
    case "commits":
      return { kind: "tab", reviewId, tab: "changes" };
    case "comments":
    case "posted":
      return { kind: "tab", reviewId, tab: "comments" };
    case "approval":
    case "failed":
      return { kind: "tab", reviewId, tab: "conversation" };
  }
}
