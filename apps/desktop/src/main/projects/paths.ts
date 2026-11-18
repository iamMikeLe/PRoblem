import { stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { AppErrorCode } from "@problem/shared";

/** Expands a leading `~` or `~/` to `home`. `~user` is left as is (and then fails as relative). */
export function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return `${home}${input.slice(1)}`;
  return input;
}

export type FolderCheck =
  | { ok: true; path: string }
  | { ok: false; code: AppErrorCode; message: string };

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Checks that the user's input names an existing folder by absolute path. */
export async function checkFolder(input: string, home: string): Promise<FolderCheck> {
  const expanded = expandHome(input, home);
  if (!isAbsolute(expanded)) {
    return {
      ok: false,
      code: "invalid_path",
      message: `Use an absolute path (or one starting with ~/): ${input}`,
    };
  }
  const path = resolve(expanded);
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        code: "not_a_directory",
        message: `${path} is not a folder`,
      };
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, code: "path_not_found", message: `${path} does not exist` };
    }
    if (code === "EACCES" || code === "EPERM" || code === "ELOOP") {
      return {
        ok: false,
        code: "path_not_accessible",
        message: `${path} cannot be read (${code})`,
      };
    }
    throw error;
  }
  return { ok: true, path };
}

/** True if `path` is `root` itself or lies inside it. Both must be canonical real paths. */
export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}
