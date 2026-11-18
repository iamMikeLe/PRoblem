import type { ChangedFile, DiffLine } from "@problem/shared";

/** A folder in the file tree; chains of single folders are merged (`src/main/claude`). */
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
export interface TreeFile {
  kind: "file";
  name: string;
  file: ChangedFile;
}
export type TreeNode = TreeFolder | TreeFile;

/** Builds the folder tree of changed files: folders first, then files, each sorted by name. */
export function buildTree(files: readonly ChangedFile[]): TreeNode[] {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.children.find(
        (child): child is TreeFolder => child.kind === "folder" && child.name === part,
      );
      if (!next) {
        next = { kind: "folder", name: part, path, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({ kind: "file", name: parts.at(-1) ?? file.path, file });
  }
  return compact(root).children;
}

function compact(folder: TreeFolder): TreeFolder {
  const children = folder.children
    .map((child) => (child.kind === "folder" ? compact(child) : child))
    .map((child) => {
      // `a` containing only folder `b` becomes `a/b`.
      if (child.kind === "folder" && child.children.length === 1) {
        const [only] = child.children;
        if (only?.kind === "folder") return { ...only, name: `${child.name}/${only.name}` };
      }
      return child;
    })
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
    );
  return { ...folder, children };
}

/** One row of the side-by-side view: the old line on the left, the new one on the right. */
export interface SplitRow {
  left: DiffLine | undefined;
  right: DiffLine | undefined;
}

/**
 * Pairs a hunk's lines for the side-by-side view: context lines on both sides, and each run of
 * deleted lines next to the run of added lines that follows it.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const deleted: DiffLine[] = [];
    const added: DiffLine[] = [];
    for (let next = lines[i]; next?.kind === "del"; next = lines[++i]) deleted.push(next);
    for (let next = lines[i]; next?.kind === "add"; next = lines[++i]) added.push(next);
    for (let j = 0; j < Math.max(deleted.length, added.length); j++) {
      rows.push({ left: deleted[j], right: added[j] });
    }
  }
  return rows;
}

export type DiffMode = "unified" | "split";
const MODE_KEY = "problem.diffMode";

/** The diff layout, remembered per viewer (falls back to unified when storage is unavailable). */
export function loadDiffMode(): DiffMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function saveDiffMode(mode: DiffMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not remembered.
  }
}
