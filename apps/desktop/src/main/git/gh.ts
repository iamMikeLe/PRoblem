import { execFile } from "node:child_process";
import { z } from "zod";
import { AppFailure } from "../errors.ts";

const GH_TIMEOUT_MS = 30_000;

const PullRequestInfoSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  headRefName: z.string().min(1),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  baseRefName: z.string().min(1),
});
export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

/** The GitHub CLI calls the app makes. Injected, so tests never reach GitHub. */
export interface GhClient {
  viewPullRequest(repo: string, number: number): Promise<PullRequestInfo>;
}

/** `gh` as a child process with an argument array; output is validated, never trusted. */
export function createGhClient(): GhClient {
  return {
    viewPullRequest: (repo, number) =>
      new Promise((resolve, reject) => {
        execFile(
          "gh",
          [
            "pr",
            "view",
            String(number),
            "--repo",
            repo,
            "--json",
            "number,title,url,headRefName,headRefOid,baseRefName",
          ],
          { timeout: GH_TIMEOUT_MS, killSignal: "SIGKILL", encoding: "utf8" },
          (error, stdout, stderr) => {
            if (error) {
              const code = "code" in error ? error.code : undefined;
              reject(
                code === "ENOENT"
                  ? new AppFailure(
                      "gh_unavailable",
                      "The GitHub CLI (gh) is not installed or not on PATH",
                    )
                  : new AppFailure(
                      "gh_failed",
                      `gh could not read ${repo}#${number}: ${stderr.trim() || error.message}`,
                    ),
              );
              return;
            }
            try {
              resolve(PullRequestInfoSchema.parse(JSON.parse(stdout)));
            } catch {
              reject(new AppFailure("gh_failed", "gh returned an unexpected answer"));
            }
          },
        );
      }),
  };
}
