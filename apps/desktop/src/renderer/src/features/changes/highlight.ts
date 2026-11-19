import type { DiffLine, FileDiff } from "@problem/shared";
import { type LanguageId, lowlight } from "./language.ts";
import type { SyntaxRole } from "./syntaxTheme.ts";

/** A run of text in one color; `role` is undefined for plain text. */
export interface Token {
  text: string;
  role: SyntaxRole | undefined;
}
export type TokenLine = readonly Token[];

type HastRoot = ReturnType<typeof lowlight.highlight>;
type HastNode = HastRoot["children"][number];

/** Past this size a block is shown without colors, so a huge diff stays responsive. */
export const MAX_HIGHLIGHT_CHARS = 200_000;

const SCOPES: Readonly<Record<string, SyntaxRole>> = {
  comment: "comment",
  quote: "comment",
  doctag: "keyword",
  keyword: "keyword",
  "selector-tag": "keyword",
  literal: "number",
  number: "number",
  symbol: "number",
  string: "string",
  subst: "property",
  regexp: "regexp",
  char: "regexp",
  "template-tag": "keyword",
  "template-variable": "property",
  built_in: "type",
  type: "type",
  class: "type",
  title: "type",
  attr: "property",
  attribute: "property",
  property: "property",
  variable: "property",
  params: "property",
  "selector-id": "property",
  "selector-class": "property",
  "selector-attr": "property",
  "selector-pseudo": "keyword",
  tag: "tag",
  name: "tag",
  meta: "meta",
  section: "heading",
  bullet: "keyword",
  link: "property",
  code: "string",
};

/** The role of a highlight.js scope's classes (`hljs-title function_`), if it has a color. */
export function roleOf(classes: readonly string[]): SyntaxRole | undefined {
  const scope = classes.find((name) => name.startsWith("hljs-"))?.slice("hljs-".length);
  if (scope === undefined) return undefined;
  if (scope === "title" && classes.includes("function_")) return "function";
  if (scope === "variable" && classes.includes("language_")) return "keyword";
  return Object.hasOwn(SCOPES, scope) ? SCOPES[scope] : undefined;
}

function classesOf(node: HastNode): string[] {
  if (node.type !== "element") return [];
  const value = node.properties.className;
  return Array.isArray(value) ? value.filter((name) => typeof name === "string") : [];
}

/**
 * Splits a highlighted tree into lines of tokens. Text is copied as text: nothing from the code
 * becomes markup, whatever it contains.
 */
export function treeToLines(root: HastRoot): Token[][] {
  const lines: Token[][] = [[]];
  const push = (text: string, role: SyntaxRole | undefined) => {
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const line = lines[lines.length - 1];
      if (part === "" || !line) return;
      const last = line[line.length - 1];
      if (last && last.role === role) last.text += part;
      else line.push({ text: part, role });
    });
  };
  const walk = (nodes: readonly HastNode[], role: SyntaxRole | undefined) => {
    for (const node of nodes) {
      if (node.type === "text") push(node.value, role);
      else if (node.type === "element") walk(node.children, roleOf(classesOf(node)) ?? role);
    }
  };
  walk(root.children, undefined);
  return lines;
}

const plain = (texts: readonly string[]): Token[][] =>
  texts.map((text) => (text === "" ? [] : [{ text, role: undefined }]));

/**
 * Highlights consecutive lines of one side of a diff together, so constructs that span lines
 * (block comments, template strings) are colored right. Plain when there is no grammar, the block
 * is too large, or the grammar fails.
 */
export function highlightLines(
  texts: readonly string[],
  language: LanguageId | undefined,
): Token[][] {
  if (language === undefined || !lowlight.registered(language)) return plain(texts);
  const code = texts.join("\n");
  if (code.length > MAX_HIGHLIGHT_CHARS) return plain(texts);
  try {
    const lines = treeToLines(lowlight.highlight(language, code));
    return lines.length === texts.length ? lines : plain(texts);
  } catch {
    return plain(texts);
  }
}

/** The leading whitespace of a line. */
function leading(text: string): string {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0] : "";
}

/**
 * The file's indentation step in spaces (2, 4 or 8): the most common change of indentation between
 * consecutive lines. Tabs are always one step each.
 */
export function detectIndentUnit(texts: readonly string[]): number {
  const counts = new Map<number, number>([
    [2, 0],
    [4, 0],
    [8, 0],
  ]);
  let previous = 0;
  for (const text of texts) {
    if (text.trim() === "") continue;
    const spaces = leading(text).replaceAll("\t", "").length;
    const delta = Math.abs(spaces - previous);
    const count = counts.get(delta);
    if (count !== undefined) counts.set(delta, count + 1);
    previous = spaces;
  }
  let best = 4;
  let bestCount = 0;
  for (const [unit, count] of counts) {
    if (count > bestCount) {
      best = unit;
      bestCount = count;
    }
  }
  return best;
}

/** One step of a line's indentation: its original whitespace and its nesting level (from 0). */
export interface IndentStep {
  text: string;
  level: number;
}

/**
 * Cuts a line's leading whitespace into steps: each tab, and each `unit` spaces. Spaces left over
 * (an odd alignment) are not a step.
 */
export function indentSteps(text: string, unit: number): IndentStep[] {
  const steps: IndentStep[] = [];
  const whitespace = leading(text);
  let i = 0;
  while (i < whitespace.length) {
    if (whitespace[i] === "\t") {
      steps.push({ text: "\t", level: steps.length });
      i += 1;
      continue;
    }
    const run = whitespace.slice(i, i + unit);
    if (run.length < unit || run.includes("\t")) break;
    steps.push({ text: run, level: steps.length });
    i += unit;
  }
  return steps;
}

/** A line's tokens without its first `count` characters (the indentation drawn separately). */
export function dropChars(tokens: TokenLine, count: number): Token[] {
  const rest: Token[] = [];
  let skip = count;
  for (const token of tokens) {
    if (skip >= token.text.length) {
      skip -= token.text.length;
      continue;
    }
    rest.push(skip > 0 ? { text: token.text.slice(skip), role: token.role } : token);
    skip = 0;
  }
  return rest;
}

/** A file's diff, highlighted: each line's tokens on the old and the new side. */
export interface HighlightedDiff {
  old: ReadonlyMap<DiffLine, TokenLine>;
  new: ReadonlyMap<DiffLine, TokenLine>;
  /** The indentation step in spaces. */
  indentUnit: number;
}

/**
 * Highlights each hunk's old side (context and deleted lines) and new side (context and added
 * lines) as code blocks, in file order. Hunks are separate: the lines between them are unknown.
 */
export function highlightDiff(diff: FileDiff, language: LanguageId | undefined): HighlightedDiff {
  const old = new Map<DiffLine, TokenLine>();
  const next = new Map<DiffLine, TokenLine>();
  const texts: string[] = [];
  for (const hunk of diff.hunks) {
    for (const [side, skipped] of [
      [old, "add"],
      [next, "del"],
    ] as const) {
      const lines = hunk.lines.filter((line) => line.kind !== skipped);
      const tokens = highlightLines(
        lines.map((line) => line.text),
        language,
      );
      lines.forEach((line, i) => {
        side.set(line, tokens[i] ?? []);
      });
    }
    for (const line of hunk.lines) texts.push(line.text);
  }
  return { old, new: next, indentUnit: detectIndentUnit(texts) };
}
