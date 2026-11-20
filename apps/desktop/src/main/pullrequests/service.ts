import type { DatabaseSync } from "node:sqlite";
import {
  type Finding,
  HOST_LABELS,
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
import { listRemotes, primaryRemote } from "../git/refs.ts";
import { getProject } from "../projects/repository.ts";
import { markCommentsTold } from "../reviews/repository.ts";
import { commentsDigest, commentsSince, latestCommentAt } from "./digest.ts";
import { type GitHost, hostByKind, hostOfUrl, type InlinePost } from "./host.ts";

/**
 * The review's pull request on its git host (ADR 0014, 0019): reading its discussion, telling
 * Claude about it, and posting findings after the user's click in the preview dialog. What
 * differs between GitHub and Bitbucket lives in each `GitHost`.
 */
export interface PullRequestService {
  conversation(reviewId: string): Promise<PrConversation>;
  /** The digest for a new review's first message, or `undefined` (no PR, host failed, no comments). */
  firstDigest(review: Review): Promise<string | undefined>;
  /** Comments newer than what Claude was told (from the latest read), as a note for the next message. */
  commentsNote(reviewId: string): { note: string; until: string } | undefined;
  /** Reads the discussion again without waiting (after a turn), so the next note is current. */
  refreshInBackground(reviewId: string): void;
  preview(reviewId: string): Promise<PostPreview>;
  post(request: PostReviewRequest): Promise<PostReviewResult>;
}

export interface PullRequestServiceDeps {
  db: DatabaseSync;
  hosts: readonly GitHost[];
  review: (id: string) => Review;
  changes: Pick<ChangesService, "file">;
  log: Logger;
  /** The Activity feed: new PR comments, posted reviews (ADR 0015). */
  activity?: Pick<ActivityService, "record" | "last">;
}

const SEVERITY_LABEL = { blocker: "Blocker", major: "Major", minor: "Minor", nit: "Nit" } as const;

/** A finding as markdown for the host. Claude wrote it, so mentions never notify anyone. */
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

/** How long creating a review waits for the PR discussion before starting without it. */
const FIRST_DIGEST_TIMEOUT_MS = 10_000;

interface Linked {
  host: GitHost;
  link: PullRequestLink;
}

export function createPullRequestService(deps: PullRequestServiceDeps): PullRequestService {
  const { db, hosts } = deps;
  const posting = new Set<string>();

  function linked(link: PullRequestLink): Linked | string {
    const host = hostByKind(hosts, link.host);
    return host ? { host, link } : `${HOST_LABELS[link.host]} is not supported.`;
  }

  /** The review's pull request: its source, or (for a branch) the open PR whose head it is. */
  async function pullRequestOf(review: Review): Promise<Linked | string> {
    if (review.source.kind === "pull-request") {
      const { repo, number, url } = review.source;
      const host = hostOfUrl(hosts, url);
      if (!host) return "This pull request is not on a supported host.";
      return { host, link: { host: host.kind, repo, number, url } };
    }
    const stored = z
      .object({ linked_pr: z.string().nullable() })
      .optional()
      .parse(db.prepare("SELECT linked_pr FROM reviews WHERE id = ?").get(review.id));
    if (stored?.linked_pr) {
      const parsed = PullRequestLinkSchema.safeParse(JSON.parse(stored.linked_pr));
      if (parsed.success) return linked(parsed.data);
    }
    const project = getProject(db, review.projectId);
    const remote = project ? primaryRemote(await listRemotes(project.path)) : undefined;
    const found = remote
      ? hosts
          .map((host) => ({ host, repo: host.repoOfRemote(remote.url) }))
          .find((entry) => entry.repo !== undefined)
      : undefined;
    if (!found?.repo) return "This project has no GitHub or Bitbucket remote.";
    const { host, repo } = found;
    const candidates = await host.openPullRequestsForBranch(repo, review.headBranch);
    const open = candidates.find((pr) => host.isHead(pr.headSha, review.headSha)) ?? candidates[0];
    if (!open) return `No open pull request has ${review.headBranch} as its branch.`;
    const link: PullRequestLink = { host: host.kind, repo, number: open.number, url: open.url };
    db.prepare("UPDATE reviews SET linked_pr = ? WHERE id = ?").run(
      JSON.stringify(link),
      review.id,
    );
    return { host, link };
  }

  async function fetchConversation(review: Review): Promise<PrConversation> {
    const pr = await pullRequestOf(review);
    if (typeof pr === "string") return { status: "none", reason: pr };
    return pr.host.conversation(pr.link);
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
    const posted = activity.last(reviewId, "posted");
    const known = [
      activity.last(reviewId, "comments")?.detail.until,
      // The host's own time of the user's post when known: the local clock may run behind.
      posted ? (posted.detail.submittedAt ?? posted.at) : undefined,
      toldAt(reviewId),
      previous ? latestCommentAt(previous) : null,
    ].filter((time): time is string => typeof time === "string");
    // Never read (in this run, or told to Claude before): this is the first look, not news.
    // Read before with no comments at all: everything now is new.
    if (known.length === 0 && previous === undefined) return;
    // Our times and the host's differ in format (".000Z"), so compare instants, not strings.
    const since =
      known.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...known.map((t) => Date.parse(t)));
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
    const info = await pr.host.viewPullRequest(pr.link.repo, pr.link.number);
    // Lines are checked against our diff; it is the host's diff only when both compare with the
    // same base branch. Otherwise an unknown line would make the host reject the comment.
    const sameBase = info.baseBranch === review.baseBranch;
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
        reason = `the pull request targets ${info.baseBranch}, this review compares with ${review.baseBranch}`;
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
    return {
      status: "ok",
      pullRequest: pr.link,
      upToDate: pr.host.isHead(info.headSha, review.headSha),
      items,
    };
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
        // A new review should not wait long for the host: without the digest it still starts.
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
    // Only findings the preview offers (not dismissed, withdrawn or posted), at the place the
    // preview decides. The text is the user's final text from the dialog, posted as is: unedited,
    // it is the preview's text, mentions neutralized; edited, it is the user's words (ADR 0017).
    const chosen = request.findings.map(({ number, text }) => {
      const item = plan.items.find((i) => i.number === number);
      if (!item) throw new AppFailure("finding_not_found", `Finding #${number} cannot be posted`);
      if (item.postedUrl !== null) {
        throw new AppFailure(
          "already_posted",
          `Finding #${number} was already posted (${item.postedUrl}).`,
        );
      }
      return { ...item, text, edited: text !== item.text };
    });
    const findings = new Map(listFindings(db, request.id).map((f) => [f.number, f]));
    const inline = chosen
      .filter((item) => item.placement === "inline")
      .map((item): InlinePost => {
        const finding = findings.get(item.number);
        if (finding?.file == null || finding.line === null) {
          throw new AppFailure(
            "finding_not_found",
            `Finding #${item.number} has no line to post on`,
          );
        }
        return { number: item.number, path: finding.file, line: finding.line, text: item.text };
      });
    const summary = chosen.filter((item) => item.placement === "summary");
    const body = [request.body.trim(), summary.map((i) => i.text).join("\n\n---\n\n")]
      .filter((part) => part !== "")
      .join("\n\n---\n\n");
    const host = hostByKind(hosts, plan.pullRequest.host);
    if (!host)
      throw new AppFailure("no_pull_request", "This pull request's host is not supported.");
    const { url, submittedAt } = await host.post(
      {
        pullRequest: plan.pullRequest,
        commitId: review.headSha,
        event: request.event,
        body,
        inline,
        summaryNumbers: summary.map((item) => item.number),
      },
      (numbers, postedUrl) => markPosted(db, request.id, numbers, postedUrl),
    );
    deps.activity?.record(request.id, {
      kind: "posted",
      findings: chosen.length,
      url,
      submittedAt,
    });
    deps.log.info(`review posted to ${HOST_LABELS[host.kind]}`, {
      review: request.id,
      findings: chosen.length,
      edited: chosen.filter((item) => item.edited).length,
    });
    return { url };
  }
}
