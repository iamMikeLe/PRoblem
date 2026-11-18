import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";
import { reviewsKey } from "../reviews/queries.ts";

// Keyed by head: a refresh gives new keys, so nothing stale is shown for the new commits.
export const changeSetKey = (reviewId: string, headSha: string) =>
  ["changes", reviewId, headSha] as const;
const fileDiffKey = (reviewId: string, headSha: string, path: string) =>
  ["changes", reviewId, headSha, "file", path] as const;
export const updateCheckKey = (reviewId: string) => ["changes", reviewId, "update-check"] as const;

export function useChangeSet(reviewId: string, headSha: string) {
  return useQuery({
    queryKey: changeSetKey(reviewId, headSha),
    queryFn: () => api.changes.files(reviewId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useFileDiff(reviewId: string, headSha: string, path: string | undefined) {
  return useQuery({
    queryKey: fileDiffKey(reviewId, headSha, path ?? ""),
    queryFn: () => api.changes.file(reviewId, path ?? ""),
    enabled: path !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Fetches the branch or pull request when the Changes tab opens, and on "Check now". */
export function useUpdateCheck(reviewId: string) {
  return useQuery({
    queryKey: updateCheckKey(reviewId),
    queryFn: () => api.reviews.checkUpdate(reviewId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useRefreshReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reviews.refresh(id),
    onSuccess: async (review) => {
      await client.invalidateQueries({ queryKey: reviewsKey });
      await client.invalidateQueries({ queryKey: updateCheckKey(review.id) });
    },
  });
}
