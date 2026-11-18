import { type ExecFileException, execFile } from "node:child_process";
import { realpath } from "node:fs/promises";

const GIT_TIMEOUT_MS = 5000;

/** The folder exists but is not inside a git work tree. */
export class NotAGitRepoError extends Error {
  /** Git's stderr, for the server log only: it can name other paths and config hints. */
  readonly detail: string;
  /** Git refused because the repository belongs to another user (`safe.directory`). */
  readonly dubiousOwnership: boolean;

  constructor(dir: string, detail: string) {
    super(`${dir} is not inside a git work tree`);
    this.name = "NotAGitRepoError";
    this.detail = detail;
    this.dubiousOwnership = detail.includes("dubious ownership");
  }
}

/** Git could not be run at all (not installed, or it timed out). */
export class GitUnavailableError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "GitUnavailableError";
  }
}

/** Failure of a git child process, with what we need to classify it. */
export class GitCommandError extends Error {
  readonly stderr: string;
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
  /** The output was larger than `maxBuffer`. */
  readonly tooMuchOutput: boolean;

  constructor(error: ExecFileException, stderr: string) {
    super(error.message, { cause: error });
    this.name = "GitCommandError";
    this.stderr = stderr.trim();
    this.spawnFailed = error.code === "ENOENT";
    this.tooMuchOutput = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    this.timedOut = error.killed === true && !this.tooMuchOutput;
  }
}

/**
 * Environment for git child processes: the parent's environment without any `GIT_*` variable,
 * so a server started from a git hook (with `GIT_DIR`, `GIT_WORK_TREE`, ...) cannot redirect git
 * to another repository.
 */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}

export interface RunGitOptions {
  /** Kill git after this long (default 5 s). Network operations pass a longer timeout. */
  timeoutMs?: number;
  /**
   * Disable every git hook for this command. Required for anything that checks out code under
   * review: with `core.hooksPath` set to a folder inside the repository (husky and friends), the
   * hooks would come from the pull request itself and run on checkout. Also disables submodule
   * recursion and Git LFS downloads (ADR 0009).
   */
  noHooks?: boolean;
  /** Largest output accepted, in bytes (default 1 MB); more fails with `tooMuchOutput`. */
  maxBuffer?: number;
}

/**
 * Settings for commands that touch code under review: no hooks (`core.hooksPath` pointing
 * nowhere), no recursion into submodules the PR may declare, and no file system monitor program.
 */
const NO_HOOKS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "submodule.recurse=false",
  "-c",
  "core.fsmonitor=false",
] as const;

/**
 * Runs git with an argument array (never a shell) and resolves with its stdout minus the final
 * newline. Only the newline is removed: paths may legitimately end in spaces.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  { timeoutMs = GIT_TIMEOUT_MS, noHooks = false, maxBuffer = 1024 * 1024 }: RunGitOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      noHooks ? [...NO_HOOKS, ...args] : [...args],
      {
        cwd,
        // Git LFS would download objects from a URL the PR can set in `.lfsconfig`; keep pointers.
        env: noHooks ? { ...gitEnv(), GIT_LFS_SKIP_SMUDGE: "1" } : gitEnv(),
        timeout: timeoutMs,
        maxBuffer,
        killSignal: "SIGKILL",
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitCommandError(error, stderr));
          return;
        }
        resolve(stdout.replace(/\r?\n$/, ""));
      },
    );
  });
}

/**
 * Resolves the root of the git work tree containing `dir`, as a canonical real path, so a
 * subfolder, a trailing slash or a symlink all map to the same root (ADR 0007). Bare repositories
 * and the `.git` folder itself have no work tree and are rejected.
 */
export async function resolveRepoRoot(dir: string): Promise<string> {
  let toplevel: string;
  try {
    toplevel = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof GitCommandError && error.spawnFailed) {
      throw new GitUnavailableError("git is not installed or not on PATH", { cause: error });
    }
    if (error instanceof GitCommandError && error.timedOut) {
      throw new GitUnavailableError("git did not answer in time", { cause: error });
    }
    throw new NotAGitRepoError(dir, error instanceof GitCommandError ? error.stderr : "");
  }
  if (toplevel === "") throw new NotAGitRepoError(dir, "git reported no work tree");
  return realpath(toplevel);
}
