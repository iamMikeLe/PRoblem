import { execFile } from "node:child_process";
import { z } from "zod";
import { AppFailure } from "../errors.ts";

const GH_TIMEOUT_MS = 30_000;
/** PR discussions can be long; GraphQL answers stay well below this. */
const GH_MAX_BUFFER = 32 * 1024 * 1024;

const PullRequestInfoSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  headRefName: z.string().min(1),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  baseRefName: z.string().min(1),
});
export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

const PR_FIELDS = "number,title,url,headRefName,headRefOid,baseRefName";
const BRANCH_PR_FIELDS = `${PR_FIELDS},isCrossRepository`;

/** The GitHub CLI calls the app makes. Injected, so tests never reach GitHub. */
export interface GhClient {
  viewPullRequest(repo: string, number: number): Promise<PullRequestInfo>;
  /**
   * Open pull requests whose head branch is `branch` in the repository itself (newest first).
   * Pull requests from forks with a branch of the same name are left out.
   */
  pullRequestsForBranch(repo: string, branch: string): Promise<PullRequestInfo[]>;
  /** A GraphQL query; resolves with the parsed JSON answer. */
  graphql(query: string, variables: Record<string, string | number>): Promise<unknown>;
  /** `POST /repos/<repo>/pulls/<number>/reviews` with a JSON body; resolves with GitHub's answer. */
  postReview(repo: string, number: number, body: unknown): Promise<unknown>;
}

/** Runs `gh` with an argument array (never a shell); `stdin` is written to its input. */
function runGh(
  args: readonly string[],
  what: string,
  stdin?: string,
  write = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      [...args],
      { timeout: GH_TIMEOUT_MS, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: GH_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const code = "code" in error ? error.code : undefined;
        if (write && error.killed) {
          // Killed while writing: GitHub may have done it anyway.
          reject(
            new AppFailure(
              "post_uncertain",
              "gh timed out; GitHub may have received the review. Check the pull request before posting again.",
            ),
          );
          return;
        }
        reject(
          code === "ENOENT"
            ? new AppFailure(
                "gh_unavailable",
                "The GitHub CLI (gh) is not installed or not on PATH",
              )
            : new AppFailure(
                "gh_failed",
                `gh could not ${what}: ${ghMessage(stdout, stderr) || error.message}`,
              ),
        );
      },
    );
    // Always close stdin: gh must never wait for input that will not come.
    child.stdin?.end(stdin ?? "");
  });
}

/** GitHub's own error message from `gh api` output, when there is one. */
function ghMessage(stdout: string, stderr: string): string {
  try {
    const parsed = z
      .object({ message: z.string(), errors: z.array(z.unknown()).optional() })
      .safeParse(JSON.parse(stdout));
    if (parsed.success) {
      const details = (parsed.data.errors ?? []).map((e) =>
        typeof e === "string" ? e : JSON.stringify(e),
      );
      return [parsed.data.message, ...details].join(" ");
    }
  } catch {
    // Not JSON: fall back to stderr.
  }
  return stderr.trim();
}

function parseJson<T>(out: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(out));
  } catch {
    throw new AppFailure("gh_failed", "gh returned an unexpected answer");
  }
}

export function createGhClient(): GhClient {
  return {
    async viewPullRequest(repo, number) {
      const out = await runGh(
        ["pr", "view", String(number), "--repo", repo, "--json", PR_FIELDS],
        `read ${repo}#${number}`,
      );
      return parseJson(out, PullRequestInfoSchema);
    },

    async pullRequestsForBranch(repo, branch) {
      const out = await runGh(
        [
          "pr",
          "list",
          "--repo",
          repo,
          "--head",
          branch,
          "--state",
          "open",
          "--limit",
          "10",
          "--json",
          BRANCH_PR_FIELDS,
        ],
        `list pull requests of ${repo}`,
      );
      const list = parseJson(
        out,
        z.array(PullRequestInfoSchema.extend({ isCrossRepository: z.boolean() })),
      );
      return list
        .filter((pr) => !pr.isCrossRepository)
        .map(({ isCrossRepository: _fork, ...pr }) => pr);
    },

    async graphql(query, variables) {
      const args = ["api", "graphql", "-f", `query=${query}`];
      for (const [key, value] of Object.entries(variables)) {
        // -F parses numbers; strings go with -f so they are never interpreted.
        args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
      }
      const out = await runGh(args, "read the pull request discussion");
      return parseJson(out, z.unknown());
    },

    async postReview(repo, number, body) {
      const out = await runGh(
        ["api", "--method", "POST", `repos/${repo}/pulls/${number}/reviews`, "--input", "-"],
        `post the review to ${repo}#${number}`,
        JSON.stringify(body),
        true,
      );
      try {
        return JSON.parse(out);
      } catch {
        // GitHub accepted the request but the answer is unreadable: the review probably exists.
        throw new AppFailure(
          "post_uncertain",
          "GitHub did not confirm the review. Check the pull request before posting again.",
        );
      }
    },
  };
}
