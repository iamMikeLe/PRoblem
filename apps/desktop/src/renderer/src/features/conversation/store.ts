import type { AppEvent, ReviewStatus, StoredEntry } from "@reviewroom/shared";
import { create } from "zustand";

/**
 * Live state of every review, fed by main-process events (`useAppEvents`). It holds data for all
 * reviews, not only the selected one, so switching reviews shows the latest state at once.
 */
interface ConversationState {
  /** Stored conversation entries by review id, ordered by `seq`. */
  entries: Record<string, StoredEntry[]>;
  /** Text Claude is writing right now, by review id (not stored anywhere). */
  live: Record<string, string>;
  /** Latest status from events; the review list's status is used until one arrives. */
  statuses: Record<string, ReviewStatus>;
  receive(event: AppEvent): void;
  /** Merges a loaded transcript with entries that arrived as events in the meantime. */
  load(reviewId: string, entries: StoredEntry[]): void;
}

function merge(current: StoredEntry[], incoming: StoredEntry[]): StoredEntry[] {
  const bySeq = new Map(current.map((entry) => [entry.seq, entry]));
  for (const entry of incoming) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function without(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useConversationStore = create<ConversationState>()((set) => ({
  entries: {},
  live: {},
  statuses: {},

  receive: (event) =>
    set((state) => {
      switch (event.type) {
        case "review.entry": {
          const { reviewId } = event.entry;
          const kind = event.entry.entry.kind;
          // A complete text block (or the end of the turn) replaces the live text.
          const live =
            kind === "assistant" || kind === "turn-end"
              ? without(state.live, reviewId)
              : state.live;
          return {
            entries: {
              ...state.entries,
              [reviewId]: merge(state.entries[reviewId] ?? [], [event.entry]),
            },
            live,
          };
        }
        case "review.delta":
          return {
            live: {
              ...state.live,
              [event.reviewId]: (state.live[event.reviewId] ?? "") + event.text,
            },
          };
        case "review.status":
          return { statuses: { ...state.statuses, [event.reviewId]: event.status } };
        default:
          return {};
      }
    }),

  load: (reviewId, entries) =>
    set((state) => ({
      entries: { ...state.entries, [reviewId]: merge(state.entries[reviewId] ?? [], entries) },
    })),
}));

/** The live status of a review, falling back to the one from the review list. */
export function useReviewStatus(review: { id: string; status: ReviewStatus }): ReviewStatus {
  return useConversationStore((state) => state.statuses[review.id] ?? review.status);
}

/** Whether Claude is working on the review (or waiting to). */
export const isBusy = (status: ReviewStatus): boolean =>
  status === "queued" || status === "running" || status === "needs-input";
