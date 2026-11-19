import type { DatabaseSync } from "node:sqlite";
import {
  type Finding,
  GITHUB_BODY_MAX,
  neutralizeMentions,
  type PostItem,
  type PostPreview,
  type PostReviewRequest,
  type PostReviewResult,
  type PrConversation,
  type PullRequestLink,
  PullRequestLinkSchema,
  type Review,
} from "@problem/shared";
import { z } from "zod";
import type { ActivityService } from "../activity/service.ts";
import type { ChangesService } from "../changes/service.ts";
import { AppFailure, type Logger } from "../errors.ts";
import { listFindings, markPosted } from "../findings/repository.ts";
import type { GhClient } from "../git/gh.ts";
import { githubRepoOf } from "../git/github.ts";
import { listRemotes, primaryRemote } from "../git/refs.ts";
import { getProject } from "../projects/repository.ts";
import { markCommentsTold } from "../reviews/repository.ts";
import { parseConversation } from "./conversation.ts";
import { commentsDigest, commentsSince, latestCommentAt } from "./digest.ts";

/**
 * The review's pull request on GitHub (ADR 0014): reading its discussion, telling Claude about
 * it, and posting findings as a GitHub review after the user's click in the preview dialog.
 */
export interface GitHubService {
  conversation(reviewId: string): Promise<PrConversation>;
  /** The digest for a new review's first message, or `undefined` (no PR, gh failed, no comments). */
  firstDigest(review: Review): Promise<string | undefined>;
  /** Comments newer than what Claude was told (from the latest read), as a note for the next message. */
  commentsNote(reviewId: string): { note: string; until: string } | undefined;
  /** Reads the discussion again without waiting (after a turn), so the next note is current. */
  refreshInBackground(reviewId: string): void;
  preview(reviewId: string): Promise<PostPreview>;
  post(request: PostReviewRequest): Promise<PostReviewResult>;
}

export interface GitHubServiceDeps {
  db: DatabaseSync;
  gh: GhClient;
  review: (id: string) => Review;
  changes: Pick<ChangesService, "file">;
  log: Logger;
  /** The Activity feed: new PR comments, posted reviews (ADR 0015). */
  activity?: Pick<ActivityService, "record" | "last">;
}

const SEVERITY_LABEL = { blocker: "Blocker", major: "Major", minor: "Minor", nit: "Nit" } as const;

/** A finding as markdown for GitHub. Claude wrote it, so mentions never notify anyone. */
export function formatFinding(finding: Finding, withLocation: boolean): string {
  const where =
    withLocation && finding.file !== null
      ? ` (\`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\`)`
      : "";
  const parts = [
    `**${SEVERITY_LABEL[finding.severity]}: ${finding.title}**${where}`,
    finding.problem,
  ];
  if (finding.reproduction.trim() !== "") {
    parts.push(`**How to reproduce:**\n\n${finding.reproduction}`);
  }
  if (finding.suggestion.trim() !== "") parts.push(`**Suggestion:** ${finding.suggestion}`);
  return neutralizeMentions(parts.join("\n\n"));
}

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

/** How long creating a review waits for the PR discussion before starting without it. */
const FIRST_DIGEST_TIMEOUT_MS = 10_000;

export function createGitHubService(deps: GitHubServiceDeps): GitHubService {
  const { db, gh } = deps;
  const posting = new Set<string>();

  /** The review's pull request: its source, or (for a branch) the open PR whose head it is. */
  async function pullRequestOf(review: Review): Promise<PullRequestLink | string> {
    if (review.source.kind === "pull-request") {
      const { repo, number, url } = review.source;
      return { repo, number, url };
    }
    const stored = z
      .object({ linked_pr: z.string().nullable() })
      .optional()
      .parse(db.prepare("SELECT linked_pr FROM reviews WHERE id = ?").get(review.id));
    if (stored?.linked_pr) {
      const parsed = PullRequestLinkSchema.safeParse(JSON.parse(stored.linked_pr));
      if (parsed.success) return parsed.data;
    }
    const project = getProject(db, review.projectId);
    const remote = project ? primaryRemote(await listRemotes(project.path)) : undefined;
    const repo = remote ? githubRepoOf(remote.url) : undefined;
    if (!repo) return "This project has no GitHub remote.";
    const candidates = await gh.pullRequestsForBranch(repo, review.headBranch);
    const open = candidates.find((pr) => pr.headRefOid === review.headSha) ?? candidates[0];
    if (!open) return `No open pull request has ${review.headBranch} as its branch.`;
    const link: PullRequestLink = { repo, number: open.number, url: open.url };
    db.prepare("UPDATE reviews SET linked_pr = ? WHERE id = ?").run(
      JSON.stringify(link),
      review.id,
    );
    return link;
  }

  async function fetchConversation(review: Review): Promise<PrConversation> {
    const pr = await pullRequestOf(review);
    if (typeof pr === "string") return { status: "none", reason: pr };
    const [owner = "", name = ""] = pr.repo.split("/");
    const answer = await gh.graphql(QUERY, { owner, name, number: pr.number });
    return parseConversation(pr, answer);
  }

  /** The latest discussion read per review: new comments are told from it at send time. */
  const latest = new Map<string, Extract<PrConversation, { status: "ok" }>>();

  async function read(review: Review): Promise<PrConversation> {
    const conversation = await fetchConversation(review);
    if (conversation.status === "ok") {
      noteNewComments(review.id, conversation);
      latest.set(review.id, conversation);
    }
    return conversation;
  }

  /**
   * Lists comments in the Activity feed that arrived since the newest one already known: listed
   * before, told to Claude, read earlier in this run, or posted by the user from here. A review
   * whose discussion was never seen lists nothing (that is the first digest, not news).
   */
  function noteNewComments(
    reviewId: string,
    conversation: Extract<PrConversation, { status: "ok" }>,
  ): void {
    const activity = deps.activity;
    if (!activity) return;
    const previous = latest.get(reviewId);
    const known = [
      activity.last(reviewId, "comments")?.detail.until,
      activity.last(reviewId, "posted")?.at,
      toldAt(reviewId),
      previous ? latestCommentAt(previous) : null,
    ].filter((time): time is string => typeof time === "string");
    if (known.length === 0) return;
    const since = known.reduce((max, t) => (t > max ? t : max));
    const { count, until } = commentsSince(conversation, since);
    if (count > 0 && until !== null) activity.record(reviewId, { kind: "comments", count, until });
  }

  function toldAt(reviewId: string): string | null {
    const row = z
      .object({ comments_told_at: z.string().nullable() })
      .optional()
      .parse(db.prepare("SELECT comments_told_at FROM reviews WHERE id = ?").get(reviewId));
    return row?.comments_told_at ?? null;
  }

  async function preview(reviewId: string): Promise<PostPreview> {
    const review = deps.review(reviewId);
    const pr = await pullRequestOf(review);
    if (typeof pr === "string") return { status: "none", reason: pr };
    const info = await gh.viewPullRequest(pr.repo, pr.number);
    // Lines are checked against our diff; it is GitHub's diff only when both compare with the
    // same base branch. Otherwise an unknown line would make GitHub reject the whole review.
    const sameBase = info.baseRefName === review.baseBranch;
    const findings = listFindings(db, reviewId).filter(
      (f) => f.withdrawnReason === null && f.verdict !== "dismissed",
    );
    const linesOf = new Map<string, Set<number> | undefined>();
    const diffLines = async (file: string) => {
      if (!linesOf.has(file)) {
        try {
          const diff = await deps.changes.file(reviewId, file);
          const lines = new Set<number>();
          for (const hunk of diff.hunks) {
            for (const line of hunk.lines) if (line.newLine !== null) lines.add(line.newLine);
          }
          linesOf.set(file, lines);
        } catch {
          linesOf.set(file, undefined);
        }
      }
      return linesOf.get(file);
    };
    const items: PostItem[] = [];
    for (const finding of findings) {
      let reason: string | null = null;
      if (!sameBase) {
        reason = `the pull request targets ${info.baseRefName}, this review compares with ${review.baseBranch}`;
      } else if (finding.file === null || finding.line === null) {
        reason = finding.file === null ? "it is about the change as a whole" : "it has no line";
      } else {
        const lines = await diffLines(finding.file);
        if (!lines) reason = `${finding.file} is not changed in the pull request`;
        else if (!lines.has(finding.line)) reason = `line ${finding.line} is not part of the diff`;
      }
      items.push({
        number: finding.number,
        placement: reason === null ? "inline" : "summary",
        reason,
        text: formatFinding(finding, reason !== null),
        selected: finding.verdict === "accepted" && finding.postedUrl === null,
        postedUrl: finding.postedUrl,
      });
    }
    return { status: "ok", pullRequest: pr, upToDate: info.headRefOid === review.headSha, items };
  }

  return {
    async conversation(reviewId) {
      return read(deps.review(reviewId));
    },

    commentsNote(reviewId) {
      const conversation = latest.get(reviewId);
      if (!conversation) return undefined;
      const note = commentsDigest(conversation, toldAt(reviewId));
      const until = latestCommentAt(conversation);
      return note === undefined || until === null ? undefined : { note, until };
    },

    refreshInBackground(reviewId) {
      let review: Review;
      try {
        review = deps.review(reviewId);
      } catch {
        return;
      }
      read(review).catch((error: unknown) =>
        deps.log.error("could not read the pull request discussion", { review: reviewId, error }),
      );
    },

    async firstDigest(review) {
      try {
        // A new review should not wait long for GitHub: without the digest it still starts.
        const conversation = await Promise.race([
          read(review),
          new Promise<undefined>((resolve) => {
            setTimeout(() => resolve(undefined), FIRST_DIGEST_TIMEOUT_MS).unref?.();
          }),
        ]);
        if (conversation?.status !== "ok") return undefined;
        const until = latestCommentAt(conversation);
        if (until !== null) markCommentsTold(db, review.id, until);
        return commentsDigest(conversation, null);
      } catch (error) {
        deps.log.error("could not read the pull request discussion", { review: review.id, error });
        return undefined;
      }
    },

    preview,

    async post(request) {
      // One post per review at a time: a second click must not post twice.
      if (posting.has(request.id)) {
        throw new AppFailure("review_busy", "This review is being posted already.");
      }
      posting.add(request.id);
      try {
        return await postOnce(request);
      } finally {
        posting.delete(request.id);
      }
    },
  };

  async function postOnce(request: PostReviewRequest): Promise<PostReviewResult> {
    const review = deps.review(request.id);
    const plan = await preview(request.id);
    if (plan.status !== "ok") throw new AppFailure("no_pull_request", plan.reason);
    if (!plan.upToDate) {
      throw new AppFailure(
        "pr_moved",
        "The pull request has new commits. Refresh the review in the Changes tab, then post.",
      );
    }
    const chosen = request.findings.map((number) => {
      const item = plan.items.find((i) => i.number === number);
      if (!item) throw new AppFailure("finding_not_found", `Finding #${number} cannot be posted`);
      if (item.postedUrl !== null) {
        throw new AppFailure(
          "already_posted",
          `Finding #${number} was already posted (${item.postedUrl}).`,
        );
      }
      return item;
    });
    const findings = new Map(listFindings(db, request.id).map((f) => [f.number, f]));
    const inline = chosen.filter((i) => i.placement === "inline");
    const summary = chosen.filter((i) => i.placement === "summary");
    const body = [request.body.trim(), summary.map((i) => i.text).join("\n\n---\n\n")]
      .filter((part) => part !== "")
      .join("\n\n---\n\n");
    if (body.length > GITHUB_BODY_MAX) {
      throw new AppFailure(
        "invalid_request",
        "The review's summary is too long for GitHub. Shorten it or post fewer findings in the summary.",
      );
    }
    let answer: unknown;
    try {
      answer = await gh.postReview(plan.pullRequest.repo, plan.pullRequest.number, {
        commit_id: review.headSha,
        event: request.event,
        body,
        comments: inline.map((item) => {
          const finding = findings.get(item.number);
          return { path: finding?.file, line: finding?.line, side: "RIGHT", body: item.text };
        }),
      });
    } catch (error) {
      // GitHub may have posted it: never offer these findings again as if they were not.
      if (error instanceof AppFailure && error.code === "post_uncertain") {
        markPosted(db, request.id, request.findings, plan.pullRequest.url);
      }
      throw error;
    }
    const parsed = z.object({ html_url: z.string() }).safeParse(answer);
    const url = parsed.success ? parsed.data.html_url : plan.pullRequest.url;
    markPosted(db, request.id, request.findings, url);
    deps.activity?.record(request.id, { kind: "posted", findings: request.findings.length, url });
    deps.log.info("review posted to GitHub", {
      review: request.id,
      findings: request.findings.length,
    });
    return { url };
  }
}
