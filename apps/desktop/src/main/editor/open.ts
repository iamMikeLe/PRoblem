import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { OpenInEditorRequest } from "@problem/shared";
import { findExecutable, isExecutableFile } from "../claude/executable.ts";
import { AppFailure } from "../errors.ts";

/**
 * Opens a file of a review in the user's editor (ADR 0011). The command comes from a template in
 * the settings; it is split into words *before* the placeholders are filled in and run without a
 * shell, so a file name (which a pull request controls) can never add an argument or a command.
 */

export interface EditorCommand {
  program: string;
  args: string[];
}

export interface EditorTarget {
  /** Absolute path of the file. */
  file: string;
  line: number;
  /** The review's folder. */
  dir: string;
}

const PLACEHOLDER = /\{(file|line|dir)\}/g;

export function buildEditorCommand(template: string, target: EditorTarget): EditorCommand {
  const [program, ...words] = template.trim().split(/\s+/);
  if (!program || program.includes("{")) {
    throw new AppFailure("editor_failed", "The editor command must start with a program.");
  }
  const values = { file: target.file, line: String(target.line), dir: target.dir };
  // One pass per word, so text a placeholder inserts is never scanned for placeholders again.
  const args = words.map((word) =>
    word.replace(PLACEHOLDER, (_, key: keyof typeof values) => values[key]),
  );
  return { program, args };
}

/**
 * The file as an absolute real path, if it is a file inside the review's folder (not its `.git`).
 * The path starts with `/`, so an editor can never read it as an option.
 */
export function resolveReviewFile(workdir: string, file: string): string {
  const outside = () =>
    new AppFailure("outside_repository", `${file} is outside the review's folder.`);
  if (isAbsolute(file) || file.startsWith("~") || file.split(/[\\/]/).includes("..")) {
    throw outside();
  }
  let root: string;
  let target: string;
  try {
    root = realpathSync(workdir);
    target = realpathSync(resolve(workdir, file));
  } catch {
    throw new AppFailure("file_not_found", `${file} does not exist in the review's folder.`);
  }
  const rel = relative(root, target);
  const inGit = rel.split(/[\\/]/).some((part) => part.toLowerCase() === ".git");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || inGit) {
    throw outside();
  }
  if (!statSync(target).isFile()) {
    throw new AppFailure("file_not_found", `${file} is not a file.`);
  }
  return target;
}

/** The program as an absolute path: a bare name is looked up on PATH; relative paths are refused. */
export function resolveProgram(program: string, path: string | undefined): string {
  if (isAbsolute(program)) {
    if (isExecutableFile(program)) return program;
  } else if (!/[\\/]/.test(program)) {
    const found = findExecutable(program, path);
    if (found) return found;
  }
  throw new AppFailure(
    "editor_not_found",
    `${program} was not found on your PATH. Install the editor's command-line launcher (for VS Code: "Shell Command: Install 'code' command in PATH"), or choose another editor in Settings.`,
  );
}

export interface Launcher {
  /** Starts the program detached; resolves once it has started, rejects if it could not start. */
  (program: string, args: readonly string[], cwd: string): Promise<void>;
}

export interface OpenInEditorDeps {
  template: string;
  workdir: string;
  file: string;
  line: number | null;
  path: string | undefined;
  /** Where the editor starts (the user's home folder). */
  cwd: string;
  launch: Launcher;
}

export async function openInEditor(deps: OpenInEditorDeps): Promise<void> {
  const target = resolveReviewFile(deps.workdir, deps.file);
  const command = buildEditorCommand(deps.template, {
    file: target,
    line: deps.line ?? 1,
    dir: realpathSync(deps.workdir),
  });
  const program = resolveProgram(command.program, deps.path);
  try {
    // Started outside the checkout: a launcher script never runs in a folder the PR controls.
    await deps.launch(program, command.args, deps.cwd);
  } catch (error) {
    throw new AppFailure(
      "editor_failed",
      `Could not start ${command.program}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Starts the editor detached from PRoblem, without a shell. */
export const spawnDetached: Launcher = (program, args, cwd) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(program, [...args], { cwd, detached: true, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });

export interface EditorOpenerDeps {
  /** The command template in effect (from the settings). */
  template: () => string;
  /** The folder of an open review (throws `review_not_found`). */
  workdirOf: (reviewId: string) => string;
  path: () => string | undefined;
  home: string;
  launch: Launcher;
}

export function createEditorOpener(deps: EditorOpenerDeps) {
  return {
    open: ({ id, file, line }: OpenInEditorRequest) =>
      openInEditor({
        template: deps.template(),
        workdir: deps.workdirOf(id),
        file,
        line,
        path: deps.path(),
        cwd: deps.home,
        launch: deps.launch,
      }),
  };
}
export type EditorOpener = ReturnType<typeof createEditorOpener>;
