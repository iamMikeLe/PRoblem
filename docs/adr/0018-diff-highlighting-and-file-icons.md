# 0018. Diff highlighting with lowlight, Material file icons, a bundled coding font

- Status: accepted
- Date: 2026-11-19

## Context
The Changes tab (ADR 0013) showed plain monospace text and one generic icon per file. Reviewers
read code faster with syntax colors, the file icons they know from VS Code, a coding font, and
visible nesting. The constraints:
- **Sandboxed renderer, strict CSP.** Only `'self'` scripts, no `eval`/wasm allowance, fonts and
  images from `'self'` or `data:`. Nothing may be fetched from the network.
- **Hostile input.** The diff comes from a pull request and can contain anything, including text
  that looks like HTML. It must never become markup.
- **Size and speed.** The Changes tab is a lazily loaded chunk; diffs can be thousands of lines.

## Options
Highlighter:
1. **lowlight 3.3.0** (MIT) over **highlight.js 11.11.1** (BSD-3-Clause): returns a hast tree, so
   we build React elements; grammars are separate modules we load one by one. Regex-based, no
   wasm/eval. Con: highlight.js grammars are less precise than TextMate ones.
2. **highlight.js alone**: returns an HTML string; using it means `dangerouslySetInnerHTML` or
   parsing HTML back. Rejected.
3. **refractor (Prism)**: also hast and lazy grammars. Similar; Prism's TypeScript grammar is no
   better and its language aliases need more wiring.
4. **shiki**: VS Code-quality TextMate grammars, but the Oniguruma engine is wasm (CSP change), the
   JS regex engine still ships large grammars and themes. Rejected for size.

File icons:
1. **material-icon-theme 5.40.0** (MIT): the VS Code theme itself, maintained, ships the SVGs and
   its manifest (`material-icons.json`). Con: no lookup API for apps; the manifest is 450 kB.
2. **vscode-material-icons 0.1.1** (MIT): a wrapper with a lookup function, but last published in
   April 2024, with icons that old. Rejected.
3. **Fluent icons only** (as before): no per-type icons.

Font: **@fontsource-variable/jetbrains-mono 5.3.0** (OFL-1.1), self-hosted woff2 files split by
unicode range. Alternatives: a system monospace (no change, looks different per OS), Fira Code or
Cascadia (similar; JetBrains Mono reads well at 12px).

## Decision
- **Highlighting:** lowlight with a curated list of 26 highlight.js grammars, each a dynamic import
  (its own 0.4–13 kB chunk) loaded the first time a file in that language is shown. The language
  comes from the file name (`language.ts`). Each hunk's old side (context + deleted lines) and new
  side (context + added lines) are highlighted as one block in file order, so block comments and
  template strings spanning lines are colored right; hunks are separate because the lines between
  them are unknown. The hast tree is flattened into lines of `{ text, role }` tokens and rendered as
  text in `<span>`s: no HTML string is ever produced or injected. Results are memoized per file;
  blocks over 200 000 characters are shown plain.
- **Rainbow indentation:** the leading whitespace is cut into steps (each tab, or each 2/4/8 spaces,
  detected per file from the most common indentation change) and each step is a span with a
  translucent band. The spans hold the original whitespace, so copying gives the line unchanged.
- **The palette exception:** Fluent tokens have no syntax palette, so `features/changes/syntaxTheme.ts`
  is the one file with hard-coded colors: dark and light syntax palettes (contrast ≥ 4.5 on the
  plain, added and removed backgrounds of their theme) and the indent bands (low alpha, so the
  added/removed backgrounds show through). They are applied as CSS custom properties on the diff
  table, so the theme switch does not re-render the highlighted lines. High contrast uses the
  theme's foreground for every role and no bands.
- **Icons:** VS Code's lookup order: the exact file name, then the longest known extension
  (`spec.ts` before `ts`), then the generic `file` icon; folders by name, with open variants; the
  light theme's variants where the theme has them. Only the manifest tables needed are imported
  (Vite tree-shakes named JSON imports; `folderNamesExpanded` and `iconDefinitions` are left out).
  The SVGs are emitted as separate files (`?no-inline`) and shown with `<img alt="" aria-hidden>`,
  so a window only loads the icons it shows. A Fluent icon is the last fallback.
- **Font:** JetBrains Mono for the diff table only, ligatures off (`liga`, `calt`), falling back to
  `tokens.fontFamilyMonospace`.

## Consequences
- **CSP: unchanged.** Grammars are scripts from `'self'`; icons and fonts are files from `'self'`
  (`img-src` and `font-src` already allowed `'self'`). No `eval`, no wasm, no inline HTML.
- **Bundle:** the startup chunks are unchanged. The lazily loaded Changes tab chunk grew from 45 kB
  to 409 kB (about 85 kB gzipped), mostly the icon manifest tables (~230 kB, `folderNames` alone is
  130 kB because it lists `.x`, `_x`, `__x__` variants) and the icon URL map; lowlight and the
  highlight.js core are ~50 kB. Grammars add ~115 kB on disk, loaded per language. The renderer
  output grew from 1.3 MB to 7.1 MB on disk: 1 253 SVGs (5.1 MB, loaded only when shown) and five
  woff2 subsets (84 kB, loaded by unicode range).
- **Licenses:** highlight.js is BSD-3-Clause and the font OFL-1.1; both permit bundling, with their
  notices kept (README, License).
- **Watch:** highlight.js may mis-color code its grammar does not know (or a hunk starting inside a
  block comment); colors are a hint, the text is always exact. Updating material-icon-theme can
  rename icons; the icon tests pin a few lookups. A file type without a grammar is plain text: add
  it to `GRAMMARS` and `BY_EXTENSION` in `language.ts`.
