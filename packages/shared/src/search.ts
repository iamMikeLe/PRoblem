import { z } from "zod";
import { SeveritySchema } from "./domain.ts";

/** At most this many results per group (reviews, findings, files). */
export const SEARCH_LIMIT = 8;
export const SEARCH_TEXT_MAX = 200;

export const SearchRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(SEARCH_TEXT_MAX),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const ReviewHitSchema = z.object({
  reviewId: z.string(),
  title: z.string(),
  /** Project and branches, e.g. "payments-api · feature/x → main". */
  detail: z.string(),
});
export type ReviewHit = z.infer<typeof ReviewHitSchema>;

export const FindingHitSchema = z.object({
  reviewId: z.string(),
  reviewTitle: z.string(),
  number: z.number().int().positive(),
  severity: SeveritySchema,
  title: z.string(),
  /** Where the words were found, when not in the title: a path, or a line of the problem. */
  excerpt: z.string().nullable(),
});
export type FindingHit = z.infer<typeof FindingHitSchema>;

export const FileHitSchema = z.object({
  reviewId: z.string(),
  reviewTitle: z.string(),
  path: z.string(),
});
export type FileHit = z.infer<typeof FileHitSchema>;

/** Matches in open reviews, best first; each group holds at most `SEARCH_LIMIT`. */
export const SearchResultsSchema = z.object({
  reviews: z.array(ReviewHitSchema),
  findings: z.array(FindingHitSchema),
  files: z.array(FileHitSchema),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;

/** The words of a search: every one must appear (case-insensitive). */
export function searchTerms(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}
