import { create } from "zustand";

/**
 * Unsent composer text per review. Kept outside the composer so "Ask about #N" in the Findings tab
 * can fill it in, and so a draft survives switching tabs or reviews.
 */
interface DraftState {
  drafts: Record<string, string>;
  setDraft(reviewId: string, update: string | ((current: string) => string)): void;
}

export const useDrafts = create<DraftState>()((set) => ({
  drafts: {},
  setDraft: (reviewId, update) =>
    set((state) => {
      const current = state.drafts[reviewId] ?? "";
      const next = typeof update === "function" ? update(current) : update;
      return { drafts: { ...state.drafts, [reviewId]: next } };
    }),
}));

export function useDraft(reviewId: string) {
  const text = useDrafts((state) => state.drafts[reviewId] ?? "");
  const setDraft = useDrafts((state) => state.setDraft);
  return [
    text,
    (update: string | ((current: string) => string)) => setDraft(reviewId, update),
  ] as const;
}
