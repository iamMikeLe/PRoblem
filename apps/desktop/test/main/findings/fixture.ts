import type { DatabaseSync } from "node:sqlite";
import type { Review } from "@reviewroom/shared";
import { insertProject } from "../../../src/main/projects/repository.ts";
import { insertReview } from "../../../src/main/reviews/repository.ts";

const SHA = (c: string) => c.repeat(40);

/** Inserts a project and an open review whose folder is `workdir`. */
export function addReview(db: DatabaseSync, id: string, workdir: string): Review {
  const project = insertProject(db, {
    name: `p-${id}`,
    path: `/repos/${id}`,
    reviewPrompt: "Review it.",
  });
  const review: Review = {
    id,
    projectId: project.id,
    title: "Retry webhooks",
    source: { kind: "branch", branch: "feature" },
    headBranch: "feature",
    headSha: SHA("a"),
    baseBranch: "main",
    baseSha: SHA("b"),
    mergeBaseSha: SHA("c"),
    workdir,
    isolated: true,
    prompt: "Review it.",
    status: "idle",
    sessionId: null,
    model: null,
    fixMode: false,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
  };
  insertReview(db, review, null);
  return review;
}
