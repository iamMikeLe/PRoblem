import type { ChangedFile, ChangeSet, FileDiff, Review } from "@problem/shared";
import { AppFailure } from "../errors.ts";
import { changedFiles, fileDiff } from "../git/diff.ts";

export interface ChangesService {
  files(reviewId: string): Promise<ChangeSet>;
  file(reviewId: string, path: string): Promise<FileDiff>;
}

/**
 * What a review changes, from the merge base (or the base, for unrelated histories) to its head
 * (ADR 0013). Only commits are compared: uncommitted edits in the review's folder are not part of
 * the pull request.
 */
export function createChangesService(deps: { review: (id: string) => Review }): ChangesService {
  const range = (review: Review) => ({
    from: review.mergeBaseSha ?? review.baseSha,
    to: review.headSha,
  });

  // Two commits always have the same changes: keep the latest lists (rename detection is slow
  // on large pull requests, and every file click needs the list).
  const cache = new Map<string, Promise<ChangedFile[]>>();
  function list(workdir: string, from: string, to: string): Promise<ChangedFile[]> {
    const key = `${from}..${to}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = changedFiles(workdir, from, to);
      pending.catch(() => cache.delete(key));
      cache.set(key, pending);
      if (cache.size > 20) cache.delete(cache.keys().next().value ?? key);
    }
    return pending;
  }

  async function files(reviewId: string): Promise<ChangeSet> {
    const review = deps.review(reviewId);
    const { from, to } = range(review);
    return { fromSha: from, toSha: to, files: await list(review.workdir, from, to) };
  }

  return {
    files,
    async file(reviewId, path) {
      const review = deps.review(reviewId);
      const { from, to } = range(review);
      // Only paths git itself listed reach the next git call.
      const file = (await list(review.workdir, from, to)).find((f) => f.path === path);
      if (!file)
        throw new AppFailure("file_not_in_changes", `${path} is not changed in this review`);
      return fileDiff(review.workdir, from, to, file);
    },
  };
}
