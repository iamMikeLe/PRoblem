import { GITHUB_BODY_MAX } from "@problem/shared";
import { z } from "zod";
import { AppFailure } from "../errors.ts";
import type { GhClient, PullRequestInfo } from "../git/gh.ts";
import { githubRepoOf } from "../git/github.ts";
import { parseConversation } from "./githubConversation.ts";
import { type GitHost, isHttpsLinkTo, type PrInfo } from "./host.ts";

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title url headRefOid
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { id path line isResolved isOutdated
          comments(first: 50) { pageInfo { hasNextPage } nodes { id author { login } body createdAt url } } }
      }
      comments(first: 100) { pageInfo { hasNextPage } nodes { id author { login } body createdAt url } }
      reviews(first: 50) { pageInfo { hasNextPage } nodes { id author { login } state body submittedAt url } }
    }
  }
}`;

const info = (pr: PullRequestInfo): PrInfo => ({
  number: pr.number,
  title: pr.title,
  url: pr.url,
  headBranch: pr.headRefName,
  headSha: pr.headRefOid,
  baseBranch: pr.baseRefName,
});

/** GitHub through the `gh` CLI (ADR 0014): its login, GraphQL, and one atomic review per post. */
export function createGitHubHost(gh: GhClient): GitHost {
  return {
    kind: "github",
    repoOfRemote: githubRepoOf,
    isWebUrl: (url) => isHttpsLinkTo(url, "github.com"),
    viewPullRequest: async (repo, number) => info(await gh.viewPullRequest(repo, number)),
    openPullRequestsForBranch: async (repo, branch) =>
      (await gh.pullRequestsForBranch(repo, branch)).map(info),
    isHead: (prHead, reviewHead) => prHead === reviewHead,

    async conversation(pr) {
      const [owner = "", name = ""] = pr.repo.split("/");
      return parseConversation(pr, await gh.graphql(QUERY, { owner, name, number: pr.number }));
    },

    async post(post, onPosted) {
      if (post.body.length > GITHUB_BODY_MAX) {
        throw new AppFailure(
          "invalid_request",
          "The review's summary is too long for GitHub. Shorten it or post fewer findings in the summary.",
        );
      }
      const numbers = [...post.inline.map((item) => item.number), ...post.summaryNumbers];
      const { repo, number, url: prUrl } = post.pullRequest;
      let answer: unknown;
      try {
        answer = await gh.postReview(repo, number, {
          commit_id: post.commitId,
          event: post.event,
          body: post.body,
          comments: post.inline.map((item) => ({
            path: item.path,
            line: item.line,
            side: "RIGHT",
            body: item.text,
          })),
        });
      } catch (error) {
        // GitHub may have posted it: never offer these findings again as if they were not.
        if (error instanceof AppFailure && error.code === "post_uncertain")
          onPosted(numbers, prUrl);
        throw error;
      }
      const parsed = z
        .object({ html_url: z.string(), submitted_at: z.string().nullish() })
        .safeParse(answer);
      const url = parsed.success ? parsed.data.html_url : prUrl;
      onPosted(numbers, url);
      return { url, submittedAt: (parsed.success ? parsed.data.submitted_at : null) ?? null };
    },
  };
}
