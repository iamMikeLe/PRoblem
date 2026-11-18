import type { ChangedFile, DiffLine } from "@problem/shared";
import { describe, expect, it } from "vitest";
import { buildTree, splitRows } from "../../../../src/renderer/src/features/changes/model.ts";

const file = (path: string): ChangedFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
});

describe("buildTree", () => {
  it("nests files in folders, folders first, and merges single-folder chains", () => {
    const tree = buildTree([
      file("src/main/claude/a.ts"),
      file("src/main/claude/b.ts"),
      file("README.md"),
      file("src/x.ts"),
    ]);
    const shape = (nodes: ReturnType<typeof buildTree>): unknown =>
      nodes.map((n) => (n.kind === "folder" ? { [n.name]: shape(n.children) } : n.name));
    expect(shape(tree)).toEqual([
      { src: [{ "main/claude": ["a.ts", "b.ts"] }, "x.ts"] },
      "README.md",
    ]);
  });
});

describe("splitRows", () => {
  const line = (kind: DiffLine["kind"], text: string): DiffLine => ({
    kind,
    oldLine: 1,
    newLine: 1,
    text,
  });
  it("pairs deleted runs with the added run that follows, and context on both sides", () => {
    const rows = splitRows([
      line("context", "a"),
      line("del", "b"),
      line("del", "c"),
      line("add", "B"),
      line("context", "d"),
      line("add", "e"),
    ]);
    expect(rows.map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", undefined],
      ["d", "d"],
      [undefined, "e"],
    ]);
  });
});
