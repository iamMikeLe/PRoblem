import type { PullRequestRef } from "./github.ts";

/**
 * Parses `https://bitbucket.org/<workspace>/<repo>/pull-requests/<n>` (with an optional trailing
 * path such as `/diff`, query or hash). Bitbucket Cloud only (ADR 0019).
 */
export function parseBitbucketPullRequestUrl(input: string): PullRequestRef | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "bitbucket.org" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }
  const match = /^\/([\w.-]+)\/([\w.-]+)\/pull-requests\/(\d+)(?:\/.*)?$/.exec(url.pathname);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const number = Number(match[3]);
  return Number.isSafeInteger(number) && number > 0
    ? { owner: match[1], repo: match[2], number }
    : undefined;
}

/**
 * The `workspace/repo` of a Bitbucket Cloud remote URL in any of git's forms (https, ssh,
 * scp-like), or `undefined` for other hosts. Lowercase: Bitbucket's slugs are.
 */
export function bitbucketRepoOf(remoteUrl: string): string | undefined {
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?bitbucket\.org\/|ssh:\/\/git@bitbucket\.org\/|git@bitbucket\.org:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      remoteUrl.trim(),
    );
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
