import { randomUUID } from "node:crypto";
import type { ApprovalDecision, PendingApproval } from "@problem/shared";
import { AppFailure } from "../errors.ts";

/**
 * Tool calls waiting for the user (ADR 0012). Pending approvals live in memory: Claude Code waits
 * in `canUseTool` for the answer, so after an app restart there is nothing left to answer.
 */
export type ApprovalAnswer =
  | { decision: Exclude<ApprovalDecision, "deny"> }
  | { decision: "deny"; message: string | null }
  /** The turn ended (Stop, close, quit), or Claude Code withdrew the request, before an answer. */
  | { decision: "expired" };

export type ApprovalRequest = Omit<PendingApproval, "id" | "requestedAt">;

export interface ApprovalQueue {
  /** Adds a card; the promise settles when the user answers or `signal` aborts. */
  add(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): { approval: PendingApproval; answer: Promise<ApprovalAnswer> };
  answer(reviewId: string, id: string, answer: ApprovalAnswer): void;
  list(): PendingApproval[];
  count(reviewId: string): number;
  /** Reviews with at least one pending approval. */
  waitingReviews(): number;
  /** Expires every pending approval of a review (its turn is being stopped). */
  expire(reviewId: string): void;
}

export function createApprovalQueue(now: () => Date = () => new Date()): ApprovalQueue {
  const pending = new Map<
    string,
    { approval: PendingApproval; settle: (answer: ApprovalAnswer) => void }
  >();

  return {
    add(request, signal) {
      const approval: PendingApproval = {
        ...request,
        id: randomUUID(),
        requestedAt: now().toISOString(),
      };
      const answer = new Promise<ApprovalAnswer>((resolve) => {
        const settle = (value: ApprovalAnswer) => {
          if (!pending.delete(approval.id)) return;
          signal.removeEventListener("abort", expire);
          resolve(value);
        };
        const expire = () => settle({ decision: "expired" });
        pending.set(approval.id, { approval, settle });
        if (signal.aborted) expire();
        else signal.addEventListener("abort", expire, { once: true });
      });
      return { approval, answer };
    },

    answer(reviewId, id, value) {
      const entry = pending.get(id);
      if (!entry || entry.approval.reviewId !== reviewId) {
        throw new AppFailure(
          "approval_not_found",
          "This request was already answered or has ended.",
        );
      }
      entry.settle(value);
    },

    list: () => [...pending.values()].map((entry) => entry.approval),
    count: (reviewId) =>
      [...pending.values()].filter((entry) => entry.approval.reviewId === reviewId).length,
    waitingReviews: () =>
      new Set([...pending.values()].map((entry) => entry.approval.reviewId)).size,
    expire(reviewId) {
      for (const entry of [...pending.values()]) {
        if (entry.approval.reviewId === reviewId) entry.settle({ decision: "expired" });
      }
    },
  };
}
