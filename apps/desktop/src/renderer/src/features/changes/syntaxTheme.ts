/**
 * The diff's syntax and indentation colors: the one place in the UI with hard-coded colors (ADR
 * 0018). Fluent's tokens have no syntax palette. Every color here is checked for contrast on the
 * diff's three backgrounds (plain, added, removed) of its theme; keep it that way when changing one.
 *
 * Colors reach the code through CSS custom properties set on the diff table, so the highlighted
 * lines stay the same elements when the theme changes. High contrast uses the theme's foreground
 * for every role (no syntax colors) and no indentation bands.
 */
import { makeStyles, tokens } from "@fluentui/react-components";

export const SYNTAX_ROLES = [
  "comment",
  "keyword",
  "string",
  "number",
  "type",
  "function",
  "property",
  "tag",
  "meta",
  "regexp",
  "heading",
] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

type Palette = Readonly<Record<SyntaxRole, string>>;

/** Readable on #292929 (plain), #052505 (added) and #3f1011 (removed): contrast ≥ 4.5. */
const DARK: Palette = {
  comment: "#8b949e",
  keyword: "#c792ea",
  string: "#e9a27c",
  number: "#b5cea8",
  type: "#4ec9b0",
  function: "#dcdcaa",
  property: "#9cdcfe",
  tag: "#6cb6ff",
  meta: "#c0c0c0",
  regexp: "#d7ba7d",
  heading: "#6cb6ff",
};

/** Readable on #ffffff (plain), #f1faf1 (added) and #fdf6f6 (removed): contrast ≥ 4.5. */
const LIGHT: Palette = {
  comment: "#59636e",
  keyword: "#8250df",
  string: "#0a3069",
  number: "#9a4a00",
  type: "#0e6e7e",
  function: "#795e26",
  property: "#0550ae",
  tag: "#116329",
  meta: "#57606a",
  regexp: "#953800",
  heading: "#0550ae",
};

/**
 * Indentation bands, one per nesting level (repeating), after VS Code's indent-rainbow: translucent
 * so the added and removed backgrounds show through.
 */
const INDENT_DARK = [
  "rgba(255, 255, 64, 0.07)",
  "rgba(127, 255, 127, 0.07)",
  "rgba(255, 127, 255, 0.07)",
  "rgba(79, 236, 236, 0.07)",
] as const;
const INDENT_LIGHT = [
  "rgba(214, 170, 0, 0.12)",
  "rgba(40, 167, 69, 0.10)",
  "rgba(190, 60, 190, 0.09)",
  "rgba(0, 150, 170, 0.10)",
] as const;

const variable = (role: SyntaxRole) => `--problem-syntax-${role}`;
const indentVariable = (level: number) => `--problem-indent-${level}`;

function variables(palette: Palette, indent: readonly string[]): Record<string, string> {
  return Object.fromEntries([
    ...SYNTAX_ROLES.map((role) => [variable(role), palette[role]]),
    ...indent.map((color, level) => [indentVariable(level), color]),
  ]);
}

const FOREGROUND = tokens.colorNeutralForeground1;
const HIGH_CONTRAST: Palette = {
  comment: FOREGROUND,
  keyword: FOREGROUND,
  string: FOREGROUND,
  number: FOREGROUND,
  type: FOREGROUND,
  function: FOREGROUND,
  property: FOREGROUND,
  tag: FOREGROUND,
  meta: FOREGROUND,
  regexp: FOREGROUND,
  heading: FOREGROUND,
};

/** The palettes, as custom properties for the diff table. */
export const useSyntaxThemes = makeStyles({
  dark: variables(DARK, INDENT_DARK),
  light: variables(LIGHT, INDENT_LIGHT),
  highContrast: variables(
    HIGH_CONTRAST,
    INDENT_DARK.map(() => "transparent"),
  ),
});

const color = (role: SyntaxRole) => ({ color: `var(${variable(role)})` });
const band = (level: number) => ({ backgroundColor: `var(${indentVariable(level)})` });

/** One class per role. */
export const useSyntaxClasses = makeStyles({
  comment: color("comment"),
  keyword: color("keyword"),
  string: color("string"),
  number: color("number"),
  type: color("type"),
  function: color("function"),
  property: color("property"),
  tag: color("tag"),
  meta: color("meta"),
  regexp: color("regexp"),
  heading: { ...color("heading"), fontWeight: tokens.fontWeightSemibold },
});

/** One class per indentation level (the level modulo the palette's length). */
export const useIndentClasses = makeStyles({
  level0: band(0),
  level1: band(1),
  level2: band(2),
  level3: band(3),
});
export const INDENT_LEVEL_CLASSES = ["level0", "level1", "level2", "level3"] as const;
