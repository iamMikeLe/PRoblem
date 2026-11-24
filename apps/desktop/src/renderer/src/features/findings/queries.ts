import type { Finding, OpenInEditorRequest, SetVerdictRequest } from "@problem/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const findingsKey = (reviewId: string) => ["findings", "list", reviewId] as const;
export const findingCountsKey = ["findings", "counts"] as const;

/**
 * Findings of a review (none while `reviewId` is undefined). `review.findings` events replace the
 * cached list (see `useAppEvents`).
 */
export function useFindings(reviewId: string | undefined) {
  return useQuery({
    queryKey: findingsKey(reviewId ?? ""),
    queryFn: () => (reviewId === undefined ? [] : api.findings.list(reviewId)),
    enabled: reviewId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Open findings and blockers per review, for the list pane. */
export function useFindingCounts() {
  return useQuery({ queryKey: findingCountsKey, queryFn: () => api.findings.counts() });
}

export function useSetVerdict() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SetVerdictRequest) => api.findings.setVerdict(request),
    onSuccess: (updated) => {
      client.setQueryData<Finding[]>(findingsKey(updated.reviewId), (list) =>
        list?.map((finding) => (finding.number === updated.number ? updated : finding)),
      );
      return client.invalidateQueries({ queryKey: findingCountsKey });
    },
  });
}

export function useOpenInEditor() {
  return useMutation({ mutationFn: (request: OpenInEditorRequest) => api.editor.open(request) });
}
