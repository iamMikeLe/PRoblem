import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Grant } from "./grants.ts";
import { REPORT_TOOL_NAME } from "./names.ts";

/**
 * The permission gate of a review (ADR 0005, ADR 0012). Every tool call goes through
 * `decideToolUse`, which allows it, refuses it, or asks the user through an approval card.
 * Only reading inside the review's folder, plain read-only git commands and the app's own
 * `report_findings` run without asking (plus edits in fix mode, and what the user allowed for the
 * review). An allowed git command may come back rewritten (`updatedInput`) with safety options.
 */
export type ToolDecision =
  | { allow: true; updatedInput?: Record<string, unknown> }
  | { allow: false; reason: string };

export type GateDecision =
  | { kind: "allow"; updatedInput?: Record<string, unknown> }
  | { kind: "deny"; reason: string }
  /** `grant`: what "Allow for this review" would store; `null` = only "Allow once" is offered. */
  | { kind: "ask"; reason: string; grant: Grant | null };

export interface GateContext {
  workdir: string;
  /** Fix mode: edits inside `workdir` run without asking. */
  fixMode: boolean;
  /** Whether the user allowed exactly this for the review ("Allow for this review"). */
  granted: (grant: Grant) => boolean;
}

/** Built-in tools a review session gets at all (`tools` option); the gate decides each call. */
export const REVIEW_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "Edit",
  "Write",
  "WebFetch",
  "WebSearch",
] as const;

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

/**
 * Resolves symlinks of the deepest part of `path` that exists, then appends the rest. A file that
 * does not exist yet (Write) under a symlinked folder is thereby placed where it would really go.
 */
function realpathDeep(path: string): string | undefined {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...rest);
    } catch {
      // It exists but cannot be resolved: a symlink to nowhere (or a loop). A write through it
      // would create its target, wherever that is, so it never counts as inside.
      if (lstatOrUndefined(existing)) return undefined;
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
}

function lstatOrUndefined(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Whether `path` (absolute, or relative to `workdir`) stays inside `workdir` once resolved, and
 * outside any `.git` folder (an in-place review's `.git/config` may hold credentials in remote
 * URLs, and a file in `.git/hooks` would run on the next git command).
 */
export function isInside(workdir: string, path: string): boolean {
  if (path.startsWith("~")) return false;
  const root = realpathDeep(workdir);
  const target = realpathDeep(resolve(workdir, path));
  if (root === undefined || target === undefined) return false;
  const rel = relative(root, target);
  if (rel === "") return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return !rel.split(/[\\/]/).some((part) => part.toLowerCase() === ".git");
}

/** A glob pattern must be relative and must not climb out of its folder. */
function escapingPattern(pattern: string): boolean {
  return isAbsolute(pattern) || pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..");
}

function stringArgument(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

const allow = (updatedInput?: Record<string, unknown>): GateDecision =>
  updatedInput ? { kind: "allow", updatedInput } : { kind: "allow" };
const refuse = (reason: string): GateDecision => ({ kind: "deny", reason });
const ask = (reason: string, grant: Grant | null = null): GateDecision => ({
  kind: "ask",
  reason,
  grant,
});

/** Quotes a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** `git sub …` → `git -C '<workdir>' sub …`. */
function pinToFolder(command: string, workdir: string): string {
  return `git -C ${shellQuote(workdir)} ${command.replace(/^git\s+/, "")}`;
}

/** Asks, unless the user already allowed exactly this for the review. */
function askUnlessGranted(context: GateContext, reason: string, grant: Grant): GateDecision {
  return context.granted(grant) ? allow() : ask(reason, grant);
}

export function decideToolUse(
  toolName: string,
  input: unknown,
  context: GateContext,
): GateDecision {
  const { workdir } = context;
  const args =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input))
      : {};
  const outsidePath = (key: string): string | undefined => {
    const value = stringArgument(args, key);
    return value !== undefined && !isInside(workdir, value) ? value : undefined;
  };
  const escapingPatternOf = (key: string): string | undefined => {
    const value = stringArgument(args, key);
    return value !== undefined && escapingPattern(value) ? value : undefined;
  };
  const OUTSIDE = "It reads outside the review's folder.";

  switch (toolName) {
    case "Read": {
      const outside = outsidePath("file_path");
      return outside === undefined
        ? allow()
        : askUnlessGranted(context, OUTSIDE, { tool: "Read", scope: outside });
    }
    case "Grep":
      return outsidePath("path") === undefined && escapingPatternOf("glob") === undefined
        ? allow()
        : ask(OUTSIDE);
    case "Glob":
      return outsidePath("path") === undefined && escapingPatternOf("pattern") === undefined
        ? allow()
        : ask(OUTSIDE);
    case "Bash": {
      const command = args.command;
      if (typeof command !== "string" || command.trim() === "") return refuse("Missing command.");
      const decision = decideBashCommand(command);
      if (decision.allow) {
        // Pinned to the review's folder: an earlier approved `cd` must not move these unasked
        // git commands into another repository.
        const checked = decision.updatedInput?.command;
        const git = typeof checked === "string" ? checked : command.trim();
        return allow({ ...args, command: pinToFolder(git, workdir) });
      }
      return askUnlessGranted(context, "It runs a command that is not a read-only git command.", {
        tool: "Bash",
        scope: command,
      });
    }
    case "Edit":
    case "Write": {
      const path = stringArgument(args, "file_path");
      if (path === undefined) return refuse("Missing file_path.");
      if (!isInside(workdir, path)) {
        return refuse(
          "Edits are only possible inside the review's folder, and never in .git. The call was refused.",
        );
      }
      if (context.fixMode) return allow();
      return askUnlessGranted(context, "It changes a file, and fix mode is off.", {
        tool: toolName,
        scope: path,
      });
    }
    case "WebFetch":
      // Always asks: a prompt-injected URL could carry data out of the checkout.
      return ask("It fetches a web page; the URL can carry data out.");
    case "WebSearch":
      return ask("It searches the web; the query can carry data out.");
    case REPORT_TOOL_NAME:
      // The app's own tool: it only saves findings, and checks its input itself (ADR 0004).
      return allow();
    default:
      return refuse(`${toolName} is not available in a review.`);
  }
}
