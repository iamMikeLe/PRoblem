import type { DatabaseSync } from "node:sqlite";
import {
  type ChangedFile,
  type FileHit,
  type FindingHit,
  type Review,
  type ReviewHit,
  SEARCH_LIMIT,
  type SearchResults,
  searchTerms,
} from "@problem/shared";
import type { ChangesService } from "../changes/service.ts";
import type { Logger } from "../errors.ts";
import { listFindings } from "../findings/repository.ts";
import { listProjects } from "../projects/repository.ts";
import { listOpenReviews } from "../reviews/repository.ts";

export interface SearchService {
  query(text: string): Promise<SearchResults>;
}

export interface SearchServiceDeps {
  db: DatabaseSync;
  changes: Pick<ChangesService, "files">;
  log: Logger;
}

/** Changed-file lists read from git at the same time (the rest wait). */
const PARALLEL_GIT = 4;
const EXCERPT_RADIUS = 60;

/**
 * Search across open reviews (closed ones are not shown anywhere). Every word must appear,
 * case-insensitive. Plain matching over SQLite rows: a few hundred reviews and findings at most,
 * so a full-text index would add a migration and syncing for no visible gain.
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  const { db, changes } = deps;

  return {
    async query(text) {
      const terms = searchTerms(text);
      const has = (value: string) => {
        const lower = value.toLowerCase();
        return terms.every((term) => lower.includes(term));
      };
      const reviews = listOpenReviews(db);
      const projectName = new Map(listProjects(db).map((p) => [p.id, p.name]));

      const reviewHits: { hit: ReviewHit; rank: number }[] = [];
      for (const review of reviews) {
        const project = projectName.get(review.projectId) ?? "";
        const pr =
          review.source.kind === "pull-request"
            ? `${review.source.repo}#${review.source.number}`
            : "";
        const all = [review.title, review.headBranch, review.baseBranch, project, pr].join(" ");
        if (!has(all)) continue;
        reviewHits.push({
          hit: {
            reviewId: review.id,
            title: review.title,
            detail: `${project} · ${review.headBranch} → ${review.baseBranch}`,
          },
          rank: has(review.title) ? 0 : 1,
        });
      }

      const findingHits: { hit: FindingHit; rank: number }[] = [];
      for (const review of reviews) {
        for (const finding of listFindings(db, review.id)) {
          if (finding.withdrawnReason !== null) continue;
          const path = finding.file ?? "";
          if (!has([finding.title, path, finding.problem].join(" "))) continue;
          const inTitle = has(finding.title);
          const inPath = !inTitle && has(`${finding.title} ${path}`);
          findingHits.push({
            hit: {
              reviewId: review.id,
              reviewTitle: review.title,
              number: finding.number,
              severity: finding.severity,
              title: finding.title,
              excerpt: inTitle ? null : inPath ? path : excerpt(finding.problem, terms),
            },
            rank: inTitle ? 0 : inPath ? 1 : 2,
          });
        }
      }

      const fileHits: { hit: FileHit; rank: number }[] = [];
      const lists = await mapLimited(reviews, PARALLEL_GIT, (review) => changedFiles(review));
      reviews.forEach((review, index) => {
        for (const file of lists[index] ?? []) {
          if (!has(file.path)) continue;
          const name = file.path.slice(file.path.lastIndexOf("/") + 1);
          fileHits.push({
            hit: { reviewId: review.id, reviewTitle: review.title, path: file.path },
            rank: has(name) ? 0 : 1,
          });
        }
      });

      return {
        reviews: best(reviewHits),
        findings: best(findingHits),
        files: best(fileHits),
      };
    },
  };

  async function changedFiles(review: Review): Promise<ChangedFile[]> {
    try {
      return (await changes.files(review.id)).files;
    } catch (error) {
      // One unreadable folder must not break search: its files are just not found.
      deps.log.error("search could not list changed files", { review: review.id, error });
      return [];
    }
  }
}

/** The best `SEARCH_LIMIT` hits; the sort is stable, so equal ranks keep their list order. */
function best<T>(hits: { hit: T; rank: number }[]): T[] {
  return hits
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SEARCH_LIMIT)
    .map((h) => h.hit);
}

/** One line of `text` around the first word that occurs, whitespace collapsed. */
export function excerpt(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const at = Math.min(
    ...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0),
    flat.length,
  );
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(flat.length, at + EXCERPT_RADIUS * 2);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
