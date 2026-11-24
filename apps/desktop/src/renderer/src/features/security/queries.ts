import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const securityScanKey = (reviewId: string) => ["security", "scan", reviewId] as const;

/** The review's latest security scan. `review.securityScan` events replace it (`useAppEvents`). */
export function useSecurityScan(reviewId: string) {
  return useQuery({
    queryKey: securityScanKey(reviewId),
    queryFn: () => api.security.scan(reviewId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
