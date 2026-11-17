/** A GitHub pull request URL, parsed. */
export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parses `https://github.com/<owner>/<repo>/pull/<n>` (with optional trailing path, query, hash). */
export function parsePullRequestUrl(input: string): PullRequestRef | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return undefined;
  const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/.*)?$/.exec(url.pathname);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const number = Number(match[3]);
  return number > 0 ? { owner: match[1], repo: match[2], number } : undefined;
}

/**
 * The `owner/repo` of a GitHub remote URL in any of git's forms (https, ssh, scp-like), or
 * `undefined` for other hosts. Compared case-insensitively, like GitHub does.
 */
export function githubRepoOf(remoteUrl: string): string | undefined {
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      remoteUrl.trim(),
    );
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
