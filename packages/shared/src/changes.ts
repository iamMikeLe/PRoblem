import { z } from "zod";

/**
 * The Changes view of a review (ADR 0013): what the pull request changes, compared with the merge
 * base (or the base, for unrelated histories).
 */

export const FileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const ChangedFileSchema = z.object({
  /** Path in the head version (for a deleted file, its old path). */
  path: z.string(),
  /** The path before a rename or copy; `null` otherwise. */
  oldPath: z.string().nullable(),
  status: FileStatusSchema,
  /** `null` for binary files. */
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ChangeSetSchema = z.object({
  /** The commit the changes are compared with (merge base, or base). */
  fromSha: z.string(),
  toSha: z.string(),
  files: z.array(ChangedFileSchema),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const DiffLineSchema = z.object({
  kind: z.enum(["context", "add", "del"]),
  /** Line number in the old version (`null` for an added line). */
  oldLine: z.number().int().positive().nullable(),
  /** Line number in the new version (`null` for a deleted line). */
  newLine: z.number().int().positive().nullable(),
  text: z.string(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DiffHunkSchema = z.object({
  /** The `@@ -a,b +c,d @@ section` line. */
  header: z.string(),
  lines: z.array(DiffLineSchema),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const FileDiffSchema = z.object({
  path: z.string(),
  binary: z.boolean(),
  /** The diff is too large to show; `hunks` is empty. */
  tooLarge: z.boolean(),
  hunks: z.array(DiffHunkSchema),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

export const UpdateCheckSchema = z.object({
  headSha: z.string(),
  /** The branch or pull request head now; equal to `headSha` when up to date. */
  latestSha: z.string(),
  /** Commits in `latestSha` that `headSha` does not have. */
  newCommits: z.number().int().nonnegative(),
  /** The newest of them (at most 20), newest first. */
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  /** The old head is not part of the new history (history was rewritten, e.g. a force-push). */
  rewritten: z.boolean(),
});
export type UpdateCheck = z.infer<typeof UpdateCheckSchema>;

/** Which files the Changes view hides, remembered per project. */
export const ChangeFiltersSchema = z.object({
  hideTests: z.boolean(),
  hideGenerated: z.boolean(),
  /** More glob patterns to hide, e.g. `docs/**`. */
  exclude: z.array(z.string().trim().min(1).max(200)).max(50),
});
export type ChangeFilters = z.infer<typeof ChangeFiltersSchema>;

/** Nothing hidden by default: a pull request could hide a real change in a `build/` folder. */
export const DEFAULT_CHANGE_FILTERS: ChangeFilters = {
  hideTests: false,
  hideGenerated: false,
  exclude: [],
};

export const TEST_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__snapshots__/**",
] as const;

export const GENERATED_PATTERNS = [
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/*.lock",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/build/**",
  "**/generated/**",
  "**/*.generated.*",
] as const;

type GlobToken =
  | { kind: "globstar-slash" }
  | { kind: "globstar" }
  | { kind: "star" }
  | { kind: "any" }
  | { kind: "char"; char: string };

function tokenize(glob: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      while (glob[i + 1] === "*") i++;
      if (glob[i + 1] === "/") {
        tokens.push({ kind: "globstar-slash" });
        i++;
      } else tokens.push({ kind: "globstar" });
    } else if (char === "*") {
      while (glob[i + 1] === "*") i++;
      tokens.push({ kind: "star" });
    } else if (char === "?") tokens.push({ kind: "any" });
    else tokens.push({ kind: "char", char });
  }
  return tokens;
}

/**
 * Whether `path` matches a glob: `**` matches across folders (including none), `*` within one
 * folder, `?` one character; everything else is literal. A pattern without `/` matches the file
 * name in any folder (like .gitignore). Memoized, so no pattern can make it take exponential time
 * (patterns come from the user and are matched on every render).
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const glob = pattern.includes("/") ? pattern.replace(/^\//, "") : `**/${pattern}`;
  const tokens = tokenize(glob);
  const n = path.length;
  // 0 = unknown, 1 = no, 2 = yes, for tokens[i..] against path[j..].
  const memo = new Uint8Array((tokens.length + 1) * (n + 1));
  const match = (i: number, j: number): boolean => {
    if (i === tokens.length) return j === n;
    const key = i * (n + 1) + j;
    const known = memo[key];
    if (known) return known === 2;
    const token = tokens[i];
    let result = false;
    switch (token?.kind) {
      case "char":
        result = path[j] === token.char && match(i + 1, j + 1);
        break;
      case "any":
        result = j < n && path[j] !== "/" && match(i + 1, j + 1);
        break;
      case "star":
        result = match(i + 1, j) || (j < n && path[j] !== "/" && match(i, j + 1));
        break;
      case "globstar":
        result = match(i + 1, j) || (j < n && match(i, j + 1));
        break;
      case "globstar-slash":
        // Nothing, or anything that ends with a "/".
        result = match(i + 1, j);
        for (let k = j; !result && k < n; k++) {
          if (path[k] === "/") result = match(i + 1, k + 1);
        }
        break;
    }
    memo[key] = result ? 2 : 1;
    return result;
  };
  return match(0, 0);
}

/** Why a file is hidden by the filters, or `undefined` when it is shown. */
export function hiddenBy(
  path: string,
  filters: ChangeFilters,
): "tests" | "generated" | "pattern" | undefined {
  const any = (patterns: readonly string[]) =>
    patterns.some((pattern) => matchesGlob(path, pattern));
  if (filters.hideTests && any(TEST_PATTERNS)) return "tests";
  if (filters.hideGenerated && any(GENERATED_PATTERNS)) return "generated";
  if (any(filters.exclude)) return "pattern";
  return undefined;
}
