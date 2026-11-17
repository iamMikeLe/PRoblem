import type { ReviewStatus } from "@reviewroom/shared";

/**
 * Static data so the shell can be demoed before the reviews API exists.
 * Delete in Phase 2, when the list pane reads real reviews from the server.
 */
export interface ReviewListItem {
  id: string;
  project: string;
  title: string;
  subtitle: string;
  status: ReviewStatus;
  updated: string;
}

export const placeholderReviews: readonly ReviewListItem[] = [
  {
    id: "r1",
    project: "payments-api",
    title: "#482 Retry idempotent webhooks",
    subtitle: "3 findings · 1 blocker",
    status: "running",
    updated: "2m",
  },
  {
    id: "r2",
    project: "payments-api",
    title: "feature/ledger-export",
    subtitle: "Waiting for approval: run tests",
    status: "needs-input",
    updated: "14m",
  },
  {
    id: "r3",
    project: "web-portal",
    title: "#1290 Dark mode for settings",
    subtitle: "5 findings · all triaged",
    status: "idle",
    updated: "1h",
  },
];
