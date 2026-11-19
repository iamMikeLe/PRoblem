import type { FileDiff } from "@problem/shared";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CodeText } from "../../../../src/renderer/src/features/changes/CodeText.tsx";
import {
  detectIndentUnit,
  dropChars,
  highlightDiff,
  highlightLines,
  indentSteps,
  roleOf,
  type Token,
} from "../../../../src/renderer/src/features/changes/highlight.ts";
import {
  languageFor,
  loadGrammar,
} from "../../../../src/renderer/src/features/changes/language.ts";

const textOf = (tokens: readonly Token[]) => tokens.map((token) => token.text).join("");

describe("languageFor", () => {
  it("knows languages by extension, case-insensitively, and some files by name", () => {
    expect(languageFor("src/cart.ts")).toBe("typescript");
    expect(languageFor("src/App.TSX")).toBe("typescript");
    expect(languageFor("lib/index.mjs")).toBe("javascript");
    expect(languageFor("package.json")).toBe("json");
    expect(languageFor("docs/README.md")).toBe("markdown");
    expect(languageFor("styles/app.scss")).toBe("scss");
    expect(languageFor(".github/workflows/ci.yml")).toBe("yaml");
    expect(languageFor("web/index.html")).toBe("xml");
    expect(languageFor("Dockerfile")).toBe("dockerfile");
    expect(languageFor("docker/Dockerfile.dev")).toBe("dockerfile");
    expect(languageFor("Makefile")).toBe("makefile");
  });

  it("has no language for unknown types, dotfiles without one, or inherited object keys", () => {
    expect(languageFor("notes.txt")).toBeUndefined();
    expect(languageFor("LICENSE")).toBeUndefined();
    expect(languageFor(".env")).toBeUndefined();
    expect(languageFor("x.constructor")).toBeUndefined();
    expect(languageFor("toString")).toBeUndefined();
  });
});

describe("highlightLines", () => {
  beforeAll(async () => {
    await loadGrammar("typescript");
  });

  it("colors tokens by role and keeps every line's text", () => {
    const lines = highlightLines(["const total = 1; // sum", 'return "a";'], "typescript");
    expect(lines.map(textOf)).toEqual(["const total = 1; // sum", 'return "a";']);
    expect(lines[0]).toContainEqual({ text: "const", role: "keyword" });
    expect(lines[0]).toContainEqual({ text: "1", role: "number" });
    expect(lines[0]).toContainEqual({ text: "// sum", role: "comment" });
    expect(lines[1]).toContainEqual({ text: '"a"', role: "string" });
  });

  it("colors a block comment and a template string across lines", () => {
    const lines = highlightLines(["/* one", "two */ x;", "const s = `a", "b`;"], "typescript");
    expect(lines[0]).toEqual([{ text: "/* one", role: "comment" }]);
    expect(lines[1]?.[0]).toEqual({ text: "two */", role: "comment" });
    expect(lines[3]?.[0]).toEqual({ text: "b`", role: "string" });
  });

  it("is plain text without a grammar", () => {
    expect(highlightLines(["const x = 1;", ""], undefined)).toEqual([
      [{ text: "const x = 1;", role: undefined }],
      [],
    ]);
  });

  it("highlights each side of a hunk in order, old and new", () => {
    const diff: FileDiff = {
      path: "a.ts",
      binary: false,
      tooLarge: false,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { kind: "del", oldLine: 1, newLine: null, text: "/* old" },
            { kind: "add", oldLine: null, newLine: 1, text: "const a = 1;" },
            { kind: "context", oldLine: 2, newLine: 2, text: "  x */" },
          ],
        },
      ],
    };
    const [del, add, context] = diff.hunks[0]?.lines ?? [];
    const result = highlightDiff(diff, "typescript");
    // The old side opens a comment the context line closes; on the new side it is code.
    expect(context && result.old.get(context)?.[0]?.role).toBe("comment");
    expect(context && result.new.get(context)?.some((t) => t.role === "comment")).toBe(false);
    expect(del && result.new.has(del)).toBe(false);
    expect(add && result.new.get(add)?.[0]).toEqual({ text: "const", role: "keyword" });
  });
});

describe("roleOf", () => {
  it("maps highlight.js scopes, with sub-scopes", () => {
    expect(roleOf(["hljs-title", "function_"])).toBe("function");
    expect(roleOf(["hljs-title", "class_"])).toBe("type");
    expect(roleOf(["hljs-variable", "language_"])).toBe("keyword");
    expect(roleOf(["hljs-operator"])).toBeUndefined();
    expect(roleOf(["hljs-constructor"])).toBeUndefined();
    expect(roleOf(["other"])).toBeUndefined();
  });
});

describe("indentation", () => {
  it("detects 2 or 4 spaces from the changes in indentation", () => {
    expect(detectIndentUnit(["a {", "  b {", "    c;", "  }", "}"])).toBe(2);
    expect(detectIndentUnit(["a {", "    b {", "        c;", "    }", "    /**", "     * x"])).toBe(
      4,
    );
    expect(detectIndentUnit(["no indentation"])).toBe(4);
  });

  it("cuts leading whitespace into steps by level; tabs are one step each", () => {
    expect(indentSteps("    x", 2)).toEqual([
      { text: "  ", level: 0 },
      { text: "  ", level: 1 },
    ]);
    expect(indentSteps("\t\tx", 4)).toEqual([
      { text: "\t", level: 0 },
      { text: "\t", level: 1 },
    ]);
    // An alignment space left over is not a step.
    expect(indentSteps("     * doc", 4)).toEqual([{ text: "    ", level: 0 }]);
    expect(indentSteps("x  ", 2)).toEqual([]);
  });

  it("drops the indentation from a line's tokens", () => {
    const tokens: Token[] = [
      { text: "  ", role: undefined },
      { text: "  // c", role: "comment" },
    ];
    expect(dropChars(tokens, 4)).toEqual([{ text: "// c", role: "comment" }]);
  });
});

describe("CodeText", () => {
  afterEach(cleanup);

  it("renders code that looks like HTML as text", () => {
    const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <CodeText tokens={[{ text: html, role: "string" }]} indentUnit={2} />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toBe(html);
  });

  it("keeps the original whitespace, with one band per indentation step", () => {
    const line = "\t\tif (x) {";
    const { container } = render(
      <CodeText tokens={[{ text: line, role: undefined }]} indentUnit={4} />,
    );
    const code = container.querySelector("code");
    expect(code?.textContent).toBe(line);
    expect(code?.children[0]?.textContent).toBe("\t");
    expect(code?.children[1]?.textContent).toBe("\t");
    expect(code?.children[0]?.className).not.toBe(code?.children[1]?.className);
  });

  it("renders highlighted HTML source as text too", async () => {
    await loadGrammar("xml");
    const source = '<a href="javascript:alert(1)" onclick="x()">hi</a>';
    const [tokens = []] = highlightLines([source], "xml");
    const { container } = render(<CodeText tokens={tokens} indentUnit={2} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe(source);
    expect(tokens.some((token) => token.role === "tag")).toBe(true);
  });
});
