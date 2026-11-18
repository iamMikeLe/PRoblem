import type { SendMessageRequest } from "@reviewroom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../lib/api.ts";
import { reviewsKey } from "../reviews/queries.ts";
import { useConversationStore } from "./store.ts";

export const catalogKey = ["claude", "catalog"] as const;

/** Loads a review's stored conversation into the store once; events keep it current after that. */
export function useConversation(reviewId: string) {
  const load = useConversationStore((state) => state.load);
  const query = useQuery({
    queryKey: ["reviews", reviewId, "entries"],
    queryFn: () => api.reviews.events(reviewId),
    staleTime: Number.POSITIVE_INFINITY,
  });
  useEffect(() => {
    if (query.data) load(reviewId, query.data);
  }, [query.data, reviewId, load]);
  const entries = useConversationStore((state) => state.entries[reviewId]);
  const live = useConversationStore((state) => state.live[reviewId]);
  return { entries: entries ?? [], live, isLoading: query.isLoading, error: query.error };
}

export function useSendMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SendMessageRequest) => api.reviews.send(request),
    // The review's model may have changed; the composer reads it when it mounts again.
    onSuccess: () => client.invalidateQueries({ queryKey: reviewsKey }),
  });
}

export function useStopReview() {
  return useMutation({ mutationFn: (id: string) => api.reviews.stop(id) });
}

/** Models and slash commands; refreshed when a session starts (see `useAppEvents`). */
export function useCatalog() {
  return useQuery({ queryKey: catalogKey, queryFn: () => api.claude.catalog() });
}
