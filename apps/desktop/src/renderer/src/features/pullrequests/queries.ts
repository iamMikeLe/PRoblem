import type { PostReviewRequest } from "@problem/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";
import { findingsKey } from "../findings/queries.ts";

export const conversationKey = (reviewId: string) => ["github", reviewId, "conversation"] as const;
const previewKey = (reviewId: string) => ["github", reviewId, "preview"] as const;

/** The PR's discussion, fetched when the tab opens (and on Reload). */
export function usePrConversation(reviewId: string) {
  return useQuery({
    queryKey: conversationKey(reviewId),
    queryFn: () => api.pullRequests.conversation(reviewId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** What posting would send; always fresh when the dialog opens. */
export function usePostPreview(reviewId: string, enabled: boolean) {
  return useQuery({
    queryKey: previewKey(reviewId),
    queryFn: () => api.pullRequests.preview(reviewId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function usePostReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PostReviewRequest) => api.pullRequests.post(request),
    onSuccess: async (_, request) => {
      await client.invalidateQueries({ queryKey: findingsKey(request.id) });
      await client.invalidateQueries({ queryKey: conversationKey(request.id) });
    },
  });
}

export function useOpenGitHub() {
  return useMutation({ mutationFn: (url: string) => api.pullRequests.open(url) });
}
