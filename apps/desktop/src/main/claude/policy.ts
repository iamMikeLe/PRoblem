import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { REPORT_TOOL_NAME } from "./names.ts";

/**
 * The read-only review policy (ADR 0005, interim form until approvals arrive in Phase 5).
 * Every tool call goes through `decideToolUse`; anything not explicitly allowed is denied, and the
 * reason is shown to Claude so it can carry on with the tools it has. An allowed call may come
 * back with a rewritten input (`updatedInput`) that adds safety options.
 */
export type ToolDecision =
  | { allow: true; updatedInput?: Record<string, unknown> }
  | { allow: false; reason: string };

/** Built-in tools a review session gets at all (`tools` option); the policy narrows them further. */
export const REVIEW_TOOLS = ["Read", "Grep", "Glob", "Bash"] as const;

/**
 * What each allowed git subcommand may be given. This is an allowlist on purpose: git accepts
 * abbreviated long options (`--open=sh` means `--open-files-in-pager=sh`) and switches modes on
 * its own (`git diff /dev/null /etc/passwd` reads files outside the repository), so refusing
 * known-bad options can never be complete.
 */
interface GitSpec {
  /** Options without a value: `--stat`, or single letters that may be bundled (`-pw`). */
  flags: readonly string[];
  /** Options with a value: `--unified=3` / `--unified 3`, `-U3` / `-U 3`. */
  values: readonly string[];
  /** Added to every call, so the user's own converters never run on PR files. */
  forced: readonly string[];
  /** Accept `-20` (log count). */
  count?: boolean;
}

const NO_CONVERTERS = ["--no-ext-diff", "--no-textconv"] as const;

const DIFF_FLAGS = [
  "--stat",
  "--numstat",
  "--shortstat",
  "--name-only",
  "--name-status",
  "--summary",
  "--patch",
  "-p",
  "--no-patch",
  "-s",
  "--raw",
  "--word-diff",
  "--color-words",
  "--no-color",
  "--minimal",
  "--patience",
  "--histogram",
  "--ignore-all-space",
  "-w",
  "--ignore-space-change",
  "-b",
  "--ignore-blank-lines",
  "--function-context",
  "-W",
  "--find-renames",
  "-M",
  "--find-copies",
  "--no-renames",
  "--full-index",
  "--check",
  "--dirstat",
  "--merge-base",
  "--cached",
  "--staged",
  "-R",
  "--text",
  "-a",
  "--abbrev",
] as const;
const DIFF_VALUES = ["--unified", "-U", "--diff-filter", "--inter-hunk-context"] as const;

const LOG_FLAGS = [
  ...DIFF_FLAGS,
  "--oneline",
  "--graph",
  "--decorate",
  "--no-decorate",
  "--no-merges",
  "--merges",
  "--first-parent",
  "--reverse",
  "--follow",
  "--all",
  "--date-order",
  "--topo-order",
  "--left-right",
  "--cherry-pick",
  "--boundary",
  "--parents",
  "--full-diff",
  "-i",
  "--regexp-ignore-case",
  "--all-match",
] as const;
const LOG_VALUES = [
  ...DIFF_VALUES,
  "-n",
  "--max-count",
  "--skip",
  "--author",
  "--committer",
  "--since",
  "--after",
  "--until",
  "--before",
  "--grep",
  "--pretty",
  "--format",
  "--date",
  "-S",
  "-G",
] as const;

const GIT: Readonly<Record<string, GitSpec>> = {
  diff: { flags: DIFF_FLAGS, values: DIFF_VALUES, forced: NO_CONVERTERS },
  log: { flags: LOG_FLAGS, values: LOG_VALUES, forced: NO_CONVERTERS, count: true },
  show: { flags: LOG_FLAGS, values: LOG_VALUES, forced: NO_CONVERTERS },
  blame: {
    flags: [
      "-w",
      "-M",
      "-C",
      "-e",
      "-s",
      "-l",
      "-t",
      "-f",
      "-n",
      "--porcelain",
      "--line-porcelain",
      "--show-email",
      "--root",
    ],
    values: ["-L"],
    forced: ["--no-textconv"],
  },
  status: {
    flags: ["--short", "-s", "--porcelain", "--branch", "-b", "--long"],
    values: ["--untracked-files", "-u"],
    forced: [],
  },
  "ls-files": {
    flags: [
      "--cached",
      "-c",
      "--modified",
      "-m",
      "--others",
      "-o",
      "--deleted",
      "-d",
      "--stage",
      "-s",
      "--unmerged",
      "--exclude-standard",
      "--full-name",
      "--directory",
    ],
    values: [],
    forced: [],
  },
  "ls-tree": {
    flags: [
      "-r",
      "-t",
      "-d",
      "-l",
      "--long",
      "--name-only",
      "--name-status",
      "--full-name",
      "--full-tree",
      "--abbrev",
    ],
    values: [],
    forced: [],
  },
  "rev-parse": {
    flags: [
      "--short",
      "--verify",
      "--abbrev-ref",
      "--show-toplevel",
      "--show-prefix",
      "--is-inside-work-tree",
      "--symbolic-full-name",
      "-q",
      "--quiet",
    ],
    values: ["--short"],
    forced: [],
  },
  "merge-base": {
    flags: ["--all", "--is-ancestor", "--octopus", "--independent", "--fork-point"],
    values: [],
    forced: [],
  },
  grep: {
    flags: [
      "-n",
      "--line-number",
      "-i",
      "--ignore-case",
      "-w",
      "--word-regexp",
      "-l",
      "--files-with-matches",
      "-L",
      "--files-without-match",
      "-c",
      "--count",
      "-E",
      "--extended-regexp",
      "-F",
      "--fixed-strings",
      "-G",
      "--basic-regexp",
      "-P",
      "--perl-regexp",
      "-I",
      "-h",
      "-H",
      "--cached",
      "--full-name",
      "-v",
      "--invert-match",
      "--break",
      "--heading",
      "-p",
      "--show-function",
      "-W",
      "--function-context",
      "-o",
      "--only-matching",
      "-q",
      "--column",
      "--all-match",
      "--and",
      "--or",
      "--not",
    ],
    values: [
      "-e",
      "-A",
      "-B",
      "-C",
      "--context",
      "--after-context",
      "--before-context",
      "--max-depth",
      "-m",
      "--max-count",
    ],
    forced: ["--no-textconv"],
  },
  "cat-file": { flags: ["-t", "-s", "-p", "-e"], values: [], forced: [] },
  shortlog: {
    flags: ["-s", "--summary", "-n", "--numbered", "-e", "--email", "-c", "--committer"],
    values: [],
    forced: [],
  },
};

/**
 * Characters allowed in a command: no shell syntax (no `;`, `|`, `&`, `$`, backticks, redirection,
 * quotes, globbing, newlines). `~` and `^` are left out too: with zsh's `extendedglob` they are
 * glob operators, so the shell could turn a checked word into file names from the PR.
 */
const SAFE_COMMAND = /^[A-Za-z0-9 ._/:=@+,%-]+$/;

const READ_ONLY_HINT =
  "Reviews are read-only: use Read, Grep and Glob, or a plain read-only git command (git diff, log, show, blame, status, ls-files, grep) with common options.";

const deny = (reason: string): ToolDecision => ({ allow: false, reason });

/** A path or revision argument must stay inside the checkout: no absolute paths, no `..` parts. */
function outsideArgument(value: string): boolean {
  return value.startsWith("/") || value.split(/[/=]/).includes("..");
}

/** Checks one git invocation; returns the command to run (with forced options) or a refusal. */
export function decideBashCommand(command: string): ToolDecision {
  const trimmed = command.trim();
  if (!SAFE_COMMAND.test(trimmed)) {
    return deny(
      `Command refused: only plain commands without quotes, pipes, redirection, variables, ~ or ^ are allowed (use full commit ids). ${READ_ONLY_HINT}`,
    );
  }
  const [program, subcommand, ...args] = trimmed.split(/\s+/);
  const spec = subcommand === undefined ? undefined : GIT[subcommand];
  if (program !== "git" || subcommand === undefined || spec === undefined) {
    return deny(`Command refused. ${READ_ONLY_HINT}`);
  }

  const checkValue = (option: string, value: string | undefined): ToolDecision | undefined => {
    if (value === undefined) return deny(`git option ${option} needs a value.`);
    if (outsideArgument(value)) return deny(`${value} points outside the review's folder.`);
    return undefined;
  };

  let pathsOnly = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? "";
    if (word.startsWith("=")) return deny(`Argument ${word} is not allowed.`);
    if (pathsOnly || !word.startsWith("-")) {
      if (outsideArgument(word)) return deny(`${word} points outside the review's folder.`);
      continue;
    }
    if (word === "--") {
      pathsOnly = true;
      continue;
    }
    if (word.startsWith("--")) {
      const eq = word.indexOf("=");
      const name = eq < 0 ? word : word.slice(0, eq);
      if (eq < 0 && spec.flags.includes(name)) continue;
      if (!spec.values.includes(name))
        return deny(`git ${subcommand} option ${name} is not allowed in a review.`);
      const refused = checkValue(name, eq < 0 ? args[++i] : word.slice(eq + 1));
      if (refused) return refused;
      continue;
    }
    if (spec.count && /^-\d+$/.test(word)) continue;
    // Short options: bundled flags (`-pw`), the last one may take a value (`-U3`, `-n 5`).
    const letters = word.slice(1);
    for (let j = 0; j < letters.length; j++) {
      const option = `-${letters[j]}`;
      if (spec.flags.includes(option)) continue;
      if (!spec.values.includes(option)) {
        return deny(`git ${subcommand} option ${option} is not allowed in a review.`);
      }
      const attached = letters.slice(j + 1);
      const refused = checkValue(option, attached === "" ? args[++i] : attached);
      if (refused) return refused;
      break;
    }
  }
  if (spec.forced.length === 0) return { allow: true };
  return {
    allow: true,
    updatedInput: { command: ["git", subcommand, ...spec.forced, ...args].join(" ") },
  };
}

/** Resolves symlinks, so a link inside the checkout cannot point Read at a file outside it. */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether `path` (absolute, or relative to `workdir`) stays inside `workdir` once resolved, and
 * outside its `.git` (an in-place review's `.git/config` may hold credentials in remote URLs).
 */
export function isInside(workdir: string, path: string): boolean {
  if (path.startsWith("~")) return false;
  const root = realpathOrSelf(workdir);
  const target = realpathOrSelf(resolve(workdir, path));
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return rel.split(/[\\/]/)[0] !== ".git";
}

/** A glob pattern must be relative and must not climb out of its folder. */
function escapingPattern(pattern: string): boolean {
  return isAbsolute(pattern) || pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..");
}

function stringArgument(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function decideToolUse(toolName: string, input: unknown, workdir: string): ToolDecision {
  const args =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input))
      : {};
  const path = (key: string): ToolDecision | undefined => {
    const value = stringArgument(args, key);
    return value !== undefined && !isInside(workdir, value)
      ? deny(`${value} is outside the review's folder.`)
      : undefined;
  };
  const pattern = (key: string): ToolDecision | undefined => {
    const value = stringArgument(args, key);
    return value !== undefined && escapingPattern(value)
      ? deny(`The pattern ${value} reaches outside the review's folder; use a relative pattern.`)
      : undefined;
  };

  switch (toolName) {
    case "Read":
      return path("file_path") ?? { allow: true };
    case "Grep":
      return path("path") ?? pattern("glob") ?? { allow: true };
    case "Glob":
      return path("path") ?? pattern("pattern") ?? { allow: true };
    case "Bash": {
      const command = args.command;
      if (typeof command !== "string") return deny("Missing command.");
      const decision = decideBashCommand(command);
      return decision.allow && decision.updatedInput
        ? { allow: true, updatedInput: { ...args, ...decision.updatedInput } }
        : decision;
    }
    case REPORT_TOOL_NAME:
      // The app's own tool: it only saves findings, and checks its input itself (ADR 0004).
      return { allow: true };
    default:
      return deny(`${toolName} is not available in a review. ${READ_ONLY_HINT}`);
  }
}
