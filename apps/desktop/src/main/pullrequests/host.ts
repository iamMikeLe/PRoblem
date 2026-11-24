import type { HostKind, PrConversation, PullRequestLink, ReviewEvent } from "@problem/shared";

/** A pull request as the review service needs it, whatever the host. */
export interface PrInfo {
  number: number;
  title: string;
  url: string;
  headBranch: string;
  /** The head commit as the host reports it (Bitbucket gives a 12-character prefix). */
  headSha: string;
  baseBranch: string;
  /** `owner/repo` (lowercase) the head branch lives in, when the host says: a fork if not ours. */
  sourceRepo?: string | undefined;
}

/** Where to fetch a pull request's head from, and the refspec to fetch it with. */
export interface FetchSource {
  /** A remote name of the project, or a URL the app built itself (never one from an API). */
  from: string;
  refspec: string;
  /** A branch name the refspec contains, to check with git before fetching. */
  branch?: string;
}

/** A finding placed on its line in the pull request's diff. */
export interface InlinePost {
  number: number;
  path: string;
  line: number;
  text: string;
}

/** What to post, decided by the service from the preview and the user's dialog (ADR 0017). */
export interface HostPost {
  pullRequest: PullRequestLink;
  /** The review's head commit, which the preview checked is the pull request's head. */
  commitId: string;
  event: ReviewEvent;
  /** The user's summary followed by the findings listed in it. */
  body: string;
  inline: InlinePost[];
  /** The findings that are part of `body`. */
  summaryNumbers: number[];
}

/**
 * One git host (GitHub, Bitbucket Cloud): everything that differs between them, behind one
 * interface, so the pull request service and the UI stay host-neutral (ADR 0019).
 */
export interface GitHost {
  readonly kind: HostKind;
  /** The repository (`owner/repo`, lowercase) of a remote URL on this host, else `undefined`. */
  repoOfRemote(remoteUrl: string): string | undefined;
  /** An https link on this host's website that the app may open in the browser. */
  isWebUrl(url: string): boolean;
  /** A pull request link on this host, parsed (`repo` lowercase). */
  parsePrUrl(input: string): { repo: string; number: number } | undefined;
  /** The web page of pull request `number` (for `#12` typed in the New review dialog). */
  pullRequestUrl(repo: string, number: number): string;
  /**
   * How to fetch the pull request's head into `target`. `remote` is the project's remote of the
   * pull request's repository.
   */
  fetchSource(pr: PrInfo, target: string, remote: { name: string; url: string }): FetchSource;
  viewPullRequest(repo: string, number: number): Promise<PrInfo>;
  /** Open pull requests from `branch` of the repository itself (forks left out), newest first. */
  openPullRequestsForBranch(repo: string, branch: string): Promise<PrInfo[]>;
  /** True when the pull request's head, as the host reports it, is the review's commit. */
  isHead(prHead: string, reviewHead: string): boolean;
  conversation(pr: PullRequestLink): Promise<PrConversation>;
  /**
   * Posts the findings and summary. Calls `onPosted` for every finding as soon as it is on the
   * host, or may be (an uncertain write), so a failure part-way never offers it again. `at` is
   * the host's own time of that write when it said (`null` for an uncertain one).
   */
  post(
    post: HostPost,
    onPosted: (numbers: number[], url: string, at: string | null) => void,
  ): Promise<{ url: string; submittedAt: string | null }>;
}

export function hostByKind(hosts: readonly GitHost[], kind: HostKind): GitHost | undefined {
  return hosts.find((host) => host.kind === kind);
}

/** The host whose website `url` is on. */
export function hostOfUrl(hosts: readonly GitHost[], url: string): GitHost | undefined {
  return hosts.find((host) => host.isWebUrl(url));
}

/** An https link to exactly `hostname` (not a subdomain), with no credentials in it. */
export function isHttpsLinkTo(value: string, hostname: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === hostname &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}
