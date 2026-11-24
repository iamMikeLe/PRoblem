import type {
  PrComment,
  PrConversation,
  PrReview,
  PrThread,
  PullRequestLink,
} from "@problem/shared";
import { z } from "zod";
import { AppFailure } from "../errors.ts";
import { bitbucketRepoOf, parseBitbucketPullRequestUrl } from "../git/bitbucket.ts";
import { type BitbucketApi, segment } from "./bitbucketApi.ts";
import { type FetchSource, type GitHost, isHttpsLinkTo, type PrInfo } from "./host.ts";

const Name = z.object({ display_name: z.string() }).nullish();

const PullRequest = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  source: z.object({
    branch: z.object({ name: z.string().min(1) }),
    commit: z.object({ hash: z.string().regex(/^[0-9a-f]{7,64}$/) }).nullish(),
    repository: z.object({ full_name: z.string() }).nullish(),
  }),
  destination: z.object({ branch: z.object({ name: z.string().min(1) }) }),
  participants: z
    .array(
      z.object({
        user: Name,
        state: z.string().nullish(),
        participated_on: z.string().nullish(),
      }),
    )
    .optional(),
});
type PullRequest = z.infer<typeof PullRequest>;

const Comment = z.object({
  id: z.number().int(),
  content: z.object({ raw: z.string() }),
  user: Name,
  created_on: z.string(),
  deleted: z.boolean().optional(),
  inline: z
    .object({
      path: z.string(),
      to: z.number().int().nullish(),
      /** The old line, for a comment on a removed line (`to` is then null). */
      from: z.number().int().nullish(),
      outdated: z.boolean().optional(),
    })
    .nullish(),
  parent: z.object({ id: z.number().int() }).nullish(),
  resolution: z.unknown().optional(),
});
type Comment = z.infer<typeof Comment>;

/** What Bitbucket answers for a new comment: only its id is used. */
const PostedComment = z.object({ id: z.number().int(), created_on: z.string().optional() });

/** The pull request's page; built here, never taken from the API's answer. */
export const bitbucketPrUrl = (repo: string, number: number): string =>
  `https://bitbucket.org/${repo}/pull-requests/${number}`;

const repoPath = (repo: string): string => {
  const [workspace = "", slug = ""] = repo.split("/");
  // `fetch` would resolve dot segments in the path: never let a name move it.
  if ([workspace, slug].some((part) => part === "" || part === "." || part === "..")) {
    throw new AppFailure("bitbucket_failed", `Not a Bitbucket repository name: ${repo}`);
  }
  return `/repositories/${segment(workspace)}/${segment(slug)}`;
};

const author = (user: Comment["user"]): string => user?.display_name ?? "Former user";

/** The value of a BBQL string literal: backslashes and quotes escaped. */
const bbqlString = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

function info(repo: string, pr: PullRequest): PrInfo {
  return {
    number: pr.id,
    title: pr.title,
    url: bitbucketPrUrl(repo, pr.id),
    headBranch: pr.source.branch.name,
    headSha: pr.source.commit?.hash ?? "",
    baseBranch: pr.destination.branch.name,
    sourceRepo: pr.source.repository?.full_name.toLowerCase(),
  };
}

/** A repository name safe to put into a clone URL. */
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

/**
 * Bitbucket has no `refs/pull/*`: the head is the source branch, in this repository or in a
 * fork. A fork is fetched from a URL built here from its checked name, in the scheme of the
 * project's remote (so the user's own git credentials apply), never from the API's clone links.
 */
export function bitbucketFetchSource(
  pr: PrInfo,
  target: string,
  remote: { name: string; url: string },
): FetchSource {
  const refspec = `+refs/heads/${pr.headBranch}:${target}`;
  const repo = bitbucketRepoOf(remote.url);
  const fork = pr.sourceRepo;
  if (fork === undefined) {
    // E.g. a deleted fork: fetching the branch name from our own repository could be other code.
    throw new AppFailure(
      "fetch_failed",
      "Bitbucket does not say which repository this pull request's branch is in (was the fork deleted?)",
    );
  }
  if (fork === repo) return { from: remote.name, refspec, branch: pr.headBranch };
  if (!REPO_NAME.test(fork) || fork.split("/").some((part) => part === "." || part === "..")) {
    throw new AppFailure(
      "fetch_failed",
      "The pull request comes from a fork with an unexpected name",
    );
  }
  const https = /^https:\/\/(?:([\w.%+-]+)@)?bitbucket\.org\//i.exec(remote.url.trim());
  // Keep the remote's user name, so the same git credentials apply to the fork.
  const from = https
    ? `https://${https[1] ? `${https[1]}@` : ""}bitbucket.org/${fork}.git`
    : `git@bitbucket.org:${fork}.git`;
  return { from, refspec, branch: pr.headBranch };
}

/** Comments as the PR comments tab shows them: inline ones as threads, the rest in order. */
export function toConversation(
  pr: PullRequestLink,
  data: PullRequest,
  comments: Comment[],
  truncated: boolean,
): PrConversation {
  const live = comments.filter((c) => c.deleted !== true);
  const byId = new Map(live.map((c) => [c.id, c]));
  /** The first comment of a reply chain that is still there. */
  const rootOf = (comment: Comment): Comment => {
    let current = comment;
    const seen = new Set<number>();
    while (current.parent && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parent.id);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const url = (comment: Comment) => `${pr.url}#comment-${comment.id}`;
  const toComment = (comment: Comment): PrComment => ({
    id: String(comment.id),
    author: author(comment.user),
    body: comment.content.raw,
    createdAt: comment.created_on,
    url: url(comment),
  });

  const threads = new Map<number, PrThread>();
  const general: PrComment[] = [];
  for (const comment of live) {
    const root = rootOf(comment);
    if (!root.inline) {
      general.push(toComment(comment));
      continue;
    }
    let thread = threads.get(root.id);
    if (!thread) {
      const line = root.inline.to ?? null;
      thread = {
        id: String(root.id),
        path: root.inline.path,
        line: line !== null && line > 0 ? line : null,
        isResolved: root.resolution !== undefined && root.resolution !== null,
        // A comment on a removed line has only `from`: it is current, just not on a new line.
        isOutdated:
          root.inline.outdated === true || (line === null && (root.inline.from ?? null) === null),
        comments: [],
      };
      threads.set(root.id, thread);
    }
    thread.comments.push(toComment(comment));
  }

  const reviews: PrReview[] = (data.participants ?? []).flatMap((participant, index) => {
    const state =
      participant.state === "approved"
        ? "APPROVED"
        : participant.state === "changes_requested"
          ? "CHANGES_REQUESTED"
          : undefined;
    if (!state) return [];
    const at = participant.participated_on;
    return [
      {
        // Names repeat ("Former user"): the position keeps ids unique.
        id: `${state}-${index}`,
        author: author(participant.user),
        state,
        body: "",
        submittedAt: at && !Number.isNaN(Date.parse(at)) ? at : null,
        url: pr.url,
      },
    ];
  });

  return {
    status: "ok",
    pullRequest: { ...pr, title: data.title, headSha: data.source.commit?.hash ?? "" },
    threads: [...threads.values()],
    comments: general,
    reviews,
    truncated,
  };
}

/** Bitbucket Cloud over its REST API with the saved API token (ADR 0019). */
export function createBitbucketHost(api: BitbucketApi): GitHost {
  async function pullRequest(repo: string, number: number): Promise<PullRequest> {
    return api.get(`${repoPath(repo)}/pullrequests/${number}`, PullRequest);
  }

  return {
    kind: "bitbucket",
    repoOfRemote: bitbucketRepoOf,
    isWebUrl: (url) => isHttpsLinkTo(url, "bitbucket.org"),
    parsePrUrl(input) {
      const ref = parseBitbucketPullRequestUrl(input);
      return ref
        ? { repo: `${ref.owner}/${ref.repo}`.toLowerCase(), number: ref.number }
        : undefined;
    },
    pullRequestUrl: bitbucketPrUrl,
    fetchSource: bitbucketFetchSource,
    viewPullRequest: async (repo, number) => info(repo, await pullRequest(repo, number)),

    async openPullRequestsForBranch(repo, branch) {
      const query = encodeURIComponent(`source.branch.name = ${bbqlString(branch)}`);
      const { values } = await api.list(
        `${repoPath(repo)}/pullrequests?state=OPEN&sort=-updated_on&pagelen=50&q=${query}`,
        PullRequest,
      );
      return (
        values
          // Pull requests from forks with a branch of the same name are left out.
          .filter((pr) => pr.source.repository?.full_name.toLowerCase() === repo)
          .map((pr) => info(repo, pr))
      );
    },

    // Bitbucket reports a 12-character prefix of the head commit.
    isHead: (prHead, reviewHead) => prHead.length >= 7 && reviewHead.startsWith(prHead),

    async conversation(pr) {
      const data = await pullRequest(pr.repo, pr.number);
      const { values, truncated } = await api.list(
        `${repoPath(pr.repo)}/pullrequests/${pr.number}/comments?pagelen=100`,
        Comment,
      );
      return toConversation(pr, data, values, truncated);
    },

    /**
     * Bitbucket has no review to post at once: each finding on a line is its own comment, then one
     * general comment holds the summary and the other findings, then the approval or change
     * request. Each finding is marked as soon as its comment exists, so a failure part-way leaves
     * the rest selectable; the approval is only sent when everything before it was posted.
     */
    async post(post, onPosted) {
      const { repo, number, url: prUrl } = post.pullRequest;
      const base = `${repoPath(repo)}/pullrequests/${number}`;
      type Sent = { url: string; at: string | null } | undefined;
      const steps: { numbers: number[]; send: () => Promise<Sent> }[] = [];
      const comment = async (content: Record<string, unknown>): Promise<Sent> => {
        const created = await api.post(`${base}/comments`, content, PostedComment);
        const at = created.created_on;
        return {
          url: `${prUrl}#comment-${created.id}`,
          at: at !== undefined && !Number.isNaN(Date.parse(at)) ? at : null,
        };
      };
      for (const item of post.inline) {
        steps.push({
          numbers: [item.number],
          send: () =>
            comment({ content: { raw: item.text }, inline: { path: item.path, to: item.line } }),
        });
      }
      if (post.body.trim() !== "") {
        steps.push({
          numbers: post.summaryNumbers,
          send: () => comment({ content: { raw: post.body } }),
        });
      }
      const verdict =
        post.event === "APPROVE"
          ? "approve"
          : post.event === "REQUEST_CHANGES"
            ? "request-changes"
            : null;
      if (verdict !== null) {
        steps.push({
          numbers: [],
          send: async () => {
            await api.post(`${base}/${verdict}`, undefined, z.unknown());
            return undefined;
          },
        });
      }

      let url = prUrl;
      let submittedAt: string | null = null;
      let done = 0;
      for (const step of steps) {
        try {
          const posted = await step.send();
          if (posted !== undefined) {
            url = posted.url;
            submittedAt = posted.at ?? submittedAt;
          }
          if (step.numbers.length > 0) onPosted(step.numbers, url, posted?.at ?? null);
          done++;
        } catch (error) {
          // It may exist: never offer it again as if it did not.
          if (
            error instanceof AppFailure &&
            error.code === "post_uncertain" &&
            step.numbers.length > 0
          ) {
            onPosted(step.numbers, prUrl, null);
          }
          if (done === 0 || !(error instanceof AppFailure) || error.code === "post_uncertain")
            throw error;
          throw new AppFailure(
            "post_partial",
            `Posted ${done} of ${steps.length} parts to Bitbucket, then: ${error.message} The findings not posted are still selectable.`,
            { cause: error },
          );
        }
      }
      // Bitbucket's own time of the last comment: the local clock may differ from it.
      return { url, submittedAt };
    },
  };
}
