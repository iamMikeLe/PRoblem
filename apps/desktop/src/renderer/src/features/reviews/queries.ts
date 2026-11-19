import type { CreateReviewRequest, Review } from "@problem/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";
import { activityKey } from "../activity/queries.ts";

export const reviewsKey = ["reviews"] as const;

export function useReviews() {
  return useQuery({ queryKey: reviewsKey, queryFn: (): Promise<Review[]> => api.reviews.list() });
}

export function useCreateReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReviewRequest) => api.reviews.create(body),
    onSuccess: () => client.invalidateQueries({ queryKey: reviewsKey }),
  });
}

export function useCloseReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reviews.close(id),
    // A closed review's Activity rows leave the feed.
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: reviewsKey }),
        client.invalidateQueries({ queryKey: activityKey }),
      ]),
  });
}

/** Branch names of a project, for autocomplete. Disabled until a project is chosen. */
export function useBranches(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "branches"],
    queryFn: () => (projectId ? api.projects.branches(projectId) : Promise.resolve([])),
    enabled: projectId !== undefined,
    staleTime: 30_000,
  });
}
