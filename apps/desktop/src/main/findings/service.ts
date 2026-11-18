import type { DatabaseSync } from "node:sqlite";
import type { AppEvent, Finding, FindingCounts, SetVerdictRequest } from "@problem/shared";
import { AppFailure } from "../errors.ts";
import { getReviewRecord } from "../reviews/repository.ts";
import { applyReport, type ReportOutcome } from "./report.ts";
import { countFindings, listFindings, setVerdict } from "./repository.ts";

export interface FindingsServiceDeps {
  db: DatabaseSync;
  broadcast: (event: AppEvent) => void;
  now?: () => Date;
}

export interface FindingsService {
  list(reviewId: string): Finding[];
  counts(): Record<string, FindingCounts>;
  setVerdict(request: SetVerdictRequest): Finding;
  /** Claude's `report_findings` call for a review; saved findings are broadcast. */
  report(reviewId: string, workdir: string, input: unknown): ReportOutcome;
}

export function createFindingsService({
  db,
  broadcast,
  now,
}: FindingsServiceDeps): FindingsService {
  const clock = now ?? (() => new Date());

  function assertOpenReview(reviewId: string): void {
    const record = getReviewRecord(db, reviewId);
    if (!record || record.closedAt !== null) {
      throw new AppFailure("review_not_found", "Review not found");
    }
  }

  const publish = (reviewId: string, findings: Finding[]) =>
    broadcast({ type: "review.findings", reviewId, findings });

  return {
    list(reviewId) {
      assertOpenReview(reviewId);
      return listFindings(db, reviewId);
    },
    counts: () => countFindings(db),
    setVerdict({ id, number, verdict }) {
      assertOpenReview(id);
      const finding = setVerdict(db, id, number, verdict, clock());
      if (!finding) throw new AppFailure("finding_not_found", `Finding #${number} not found`);
      publish(id, listFindings(db, id));
      return finding;
    },
    report(reviewId, workdir, input) {
      const record = getReviewRecord(db, reviewId);
      if (!record || record.closedAt !== null) {
        return { ok: false, text: "Nothing was saved: this review has been closed." };
      }
      const outcome = applyReport(db, reviewId, workdir, input, clock());
      if (outcome.ok) publish(reviewId, outcome.findings);
      return outcome;
    },
  };
}
