import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Finds the user's `claude` executable on PATH (absolute entries only). ReviewRoom drives the
 * Claude Code the user has installed and logged in to, instead of shipping its own copy.
 */
export function findExecutable(name: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  for (const dir of path.split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
