import type { ChangedFile, DiffHunk, DiffLine, FileDiff, FileStatus } from "@problem/shared";
import { GitCommandError, runGit } from "./repo.ts";

/**
 * The Changes view's git calls (ADR 0013). They compare two commits, never the working tree, and
 * keep the user's diff drivers and text converters out (`--no-ext-diff --no-textconv`), so nothing
 * from the pull request's `.gitattributes` makes git run a program.
 */
const SAFE_DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "-M"] as const;

/** Diffs above this size are not parsed or shown. */
export const MAX_DIFF_BYTES = 2_000_000;
const DIFF_TIMEOUT_MS = 30_000;
/** File lists of very large pull requests (tens of thousands of files) still fit. */
const LIST_MAX_BYTES = 32 * 1024 * 1024;

const STATUS: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/** Parses `git diff --name-status -z` into status and paths per file. */
export function parseNameStatus(
  out: string,
): { status: FileStatus; path: string; oldPath: string | null }[] {
  const fields = out.split("\0");
  const files: { status: FileStatus; path: string; oldPath: string | null }[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i++] ?? "";
    if (code === "") continue;
    const status = STATUS[code[0] ?? ""] ?? "modified";
    if (status === "renamed" || status === "copied") {
      const oldPath = fields[i++] ?? "";
      const path = fields[i++] ?? "";
      files.push({ status, path, oldPath });
    } else {
      files.push({ status, path: fields[i++] ?? "", oldPath: null });
    }
  }
  return files;
}

/**
 * Parses `git diff --numstat -z`: `added\tdeleted\tpath\0`, or for a rename
 * `added\tdeleted\t\0old\0new\0`. Binary files show `-` counts.
 */
export function parseNumstat(
  out: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const fields = out.split("\0");
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < fields.length; ) {
    const record = fields[i++] ?? "";
    if (record === "") continue;
    // Only the first two tabs separate fields: a file name may contain tabs too.
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    const added = record.slice(0, first);
    const deleted = record.slice(first + 1, second);
    let path = record.slice(second + 1);
    const inline = path;
    if (inline === "") {
      i++; // the old path of a rename
      path = fields[i++] ?? "";
    }
    const number = (value: string) => (value === "-" ? null : Number(value));
    counts.set(path, { additions: number(added), deletions: number(deleted) });
  }
  return counts;
}

export async function changedFiles(dir: string, from: string, to: string): Promise<ChangedFile[]> {
  const range = ["--end-of-options", from, to];
  const [names, numbers] = await Promise.all([
    runGit(dir, ["diff", ...SAFE_DIFF, "--name-status", "-z", ...range], {
      timeoutMs: DIFF_TIMEOUT_MS,
      maxBuffer: LIST_MAX_BYTES,
    }),
    runGit(dir, ["diff", ...SAFE_DIFF, "--numstat", "-z", ...range], {
      timeoutMs: DIFF_TIMEOUT_MS,
      maxBuffer: LIST_MAX_BYTES,
    }),
  ]);
  const counts = parseNumstat(numbers);
  return parseNameStatus(names).map((file) => {
    const count = counts.get(file.path) ?? { additions: null, deletions: null };
    return { ...file, ...count };
  });
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses the unified diff of one file into hunks with line numbers on both sides. Each hunk is
 * read by the line counts in its header, so a blank context line (`diff.suppressBlankEmpty`) or
 * text that looks like a header never shifts the numbers, and a second file is never mixed in.
 */
export function parseUnifiedDiff(path: string, out: string): FileDiff {
  const hunks: DiffHunk[] = [];
  let binary = false;
  let current: DiffLine[] | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let files = 0;
  for (const raw of out.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const marker = line === "" ? " " : line[0];
      const text = line.slice(1);
      if (marker === "+" && newLeft > 0) {
        current.push({ kind: "add", oldLine: null, newLine: newLine++, text });
        newLeft--;
      } else if (marker === "-" && oldLeft > 0) {
        current.push({ kind: "del", oldLine: oldLine++, newLine: null, text });
        oldLeft--;
      } else if (marker === " " && oldLeft > 0 && newLeft > 0) {
        current.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
        oldLeft--;
        newLeft--;
      }
      // "\ No newline at end of file" carries no content.
      continue;
    }
    if (line.startsWith("diff --git ")) {
      // Only one file is expected; anything after a second header is ignored.
      if (hunks.length > 0 || ++files > 1) break;
      current = undefined;
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLine = Number(header[3]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      current = [];
      hunks.push({ header: line, lines: current });
      continue;
    }
    if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
  }
  return { path, binary, tooLarge: false, hunks };
}

export async function fileDiff(
  dir: string,
  from: string,
  to: string,
  file: ChangedFile,
): Promise<FileDiff> {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
  let out: string;
  try {
    out = await runGit(
      dir,
      // Paths are file names, never patterns: a PR can add a file called `*` or `:(top)x`.
      [
        "--literal-pathspecs",
        "diff",
        ...SAFE_DIFF,
        "-U3",
        "--end-of-options",
        from,
        to,
        "--",
        ...paths,
      ],
      { timeoutMs: DIFF_TIMEOUT_MS, maxBuffer: MAX_DIFF_BYTES },
    );
  } catch (error) {
    if (error instanceof GitCommandError && error.tooMuchOutput) {
      return { path: file.path, binary: false, tooLarge: true, hunks: [] };
    }
    throw error;
  }
  return parseUnifiedDiff(file.path, out);
}
