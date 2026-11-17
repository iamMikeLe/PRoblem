import type { Project, ReviewStatus } from "@reviewroom/shared";

/**
 * Static data so the shell can be demoed before the reviews API exists.
 * Delete in Phase 2, when the list pane reads real reviews from the server.
 */
export interface ReviewListItem {
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  status: ReviewStatus;
  updated: string;
}

const samples: readonly Omit<ReviewListItem, "id" | "projectId">[] = [
  {
    title: "#482 Retry idempotent webhooks",
    subtitle: "3 findings · 1 blocker",
    status: "running",
    updated: "2m",
  },
  {
    title: "feature/ledger-export",
    subtitle: "Waiting for approval: run tests",
    status: "needs-input",
    updated: "14m",
  },
  {
    title: "#1290 Dark mode for settings",
    subtitle: "5 findings · all triaged",
    status: "idle",
    updated: "1h",
  },
  {
    title: "fix/timezone-rounding",
    subtitle: "Claude could not check out the branch",
    status: "failed",
    updated: "3h",
  },
];

/** Two deterministic demo reviews per project, cycling through the sample reviews. */
export function placeholderReviewsFor(projects: readonly Project[]): ReviewListItem[] {
  return projects.flatMap((project, index) =>
    [0, 1].flatMap((offset) => {
      const sample = samples[(index * 2 + offset) % samples.length];
      return sample
        ? [{ ...sample, id: `${project.id}:demo-${offset + 1}`, projectId: project.id }]
        : [];
    }),
  );
}
