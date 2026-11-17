import { execFile } from "node:child_process";

const MARKER = "__REVIEWROOM_PATH__";

/**
 * A macOS app started from Finder or the Dock gets a minimal PATH (`/usr/bin:/bin:...`), so tools
 * installed with Homebrew or a version manager (`gh`, newer `git`, `claude`) are not found.
 * Read PATH from the user's login shell once at startup, like a terminal would have it.
 * Resolves with the PATH to use; falls back to the current one on any problem.
 */
export function loginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const shell = env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: 5000, killSignal: "SIGKILL", encoding: "utf8", env },
      (error, stdout) => {
        const path = error ? undefined : extractPath(stdout);
        resolve(path ?? env.PATH);
      },
    );
  });
}

/**
 * Drops empty and relative PATH entries. They resolve against the working directory of each
 * child process, and git runs inside folders holding code under review: with `./node_modules/.bin`
 * on PATH, a pull request could ship its own `git`. Applied to the PATH the app runs with.
 */
export function absolutePathOnly(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path
    .split(":")
    .filter((entry) => entry.startsWith("/"))
    .join(":");
}

/** Pulls PATH out of shell output that may also contain banners from rc files. */
export function extractPath(output: string): string | undefined {
  const start = output.indexOf(MARKER);
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (start < 0 || end < 0) return undefined;
  const path = output.slice(start + MARKER.length, end).trim();
  return path === "" ? undefined : path;
}
