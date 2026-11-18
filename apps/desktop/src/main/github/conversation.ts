import type { PrComment, PrConversation, PullRequestLink } from "@problem/shared";
import { z } from "zod";
import { AppFailure } from "../errors.ts";

/** GitHub's GraphQL answer, validated field by field (a deleted user is `author: null`). */
const Page = z.object({ hasNextPage: z.boolean() });
const Comment = z.object({
  id: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
});
const Answer = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            title: z.string(),
            url: z.string(),
            headRefOid: z.string(),
            reviewThreads: z.object({
              pageInfo: Page,
              nodes: z.array(
                z.object({
                  id: z.string(),
                  path: z.string(),
                  line: z.number().nullable(),
                  isResolved: z.boolean(),
                  isOutdated: z.boolean(),
                  comments: z.object({ pageInfo: Page, nodes: z.array(Comment) }),
                }),
              ),
            }),
            comments: z.object({ pageInfo: Page, nodes: z.array(Comment) }),
            reviews: z.object({
              pageInfo: Page,
              nodes: z.array(
                z.object({
                  id: z.string(),
                  author: z.object({ login: z.string() }).nullable(),
                  state: z.enum([
                    "APPROVED",
                    "CHANGES_REQUESTED",
                    "COMMENTED",
                    "DISMISSED",
                    "PENDING",
                  ]),
                  body: z.string(),
                  submittedAt: z.string().nullable(),
                  url: z.string(),
                }),
              ),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

const comment = (node: z.infer<typeof Comment>): PrComment => ({
  id: node.id,
  author: node.author?.login ?? "ghost",
  body: node.body,
  createdAt: node.createdAt,
  url: node.url,
});

export function parseConversation(pr: PullRequestLink, answer: unknown): PrConversation {
  const parsed = Answer.safeParse(answer);
  if (!parsed.success) throw new AppFailure("gh_failed", "GitHub returned an unexpected answer");
  const data = parsed.data.data.repository?.pullRequest;
  if (!data)
    return { status: "none", reason: `Pull request #${pr.number} was not found on GitHub.` };
  const threads = data.reviewThreads.nodes.map((thread) => ({
    id: thread.id,
    path: thread.path,
    line: thread.line !== null && thread.line > 0 ? thread.line : null,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    comments: thread.comments.nodes.map(comment),
  }));
  const truncated =
    data.reviewThreads.pageInfo.hasNextPage ||
    data.comments.pageInfo.hasNextPage ||
    data.reviews.pageInfo.hasNextPage ||
    data.reviewThreads.nodes.some((t) => t.comments.pageInfo.hasNextPage);
  return {
    status: "ok",
    pullRequest: { ...pr, title: data.title, headSha: data.headRefOid },
    threads,
    comments: data.comments.nodes.map(comment),
    reviews: data.reviews.nodes
      // A review without a summary is just the container of its inline comments.
      .filter((review) => review.body.trim() !== "" || review.state !== "COMMENTED")
      .map((review) => ({
        id: review.id,
        author: review.author?.login ?? "ghost",
        state: review.state,
        body: review.body,
        submittedAt: review.submittedAt,
        url: review.url,
      })),
    truncated,
  };
}
