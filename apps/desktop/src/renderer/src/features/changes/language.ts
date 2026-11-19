import type { LanguageFn } from "highlight.js";
import { createLowlight } from "lowlight";
import { useEffect, useState } from "react";

/**
 * The highlight.js grammars the diff knows, each loaded (as its own chunk) the first time a file
 * in that language is shown.
 */
const GRAMMARS = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  go: () => import("highlight.js/lib/languages/go"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  less: () => import("highlight.js/lib/languages/less"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  scss: () => import("highlight.js/lib/languages/scss"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
} satisfies Record<string, () => Promise<{ default: LanguageFn }>>;

export type LanguageId = keyof typeof GRAMMARS;

const BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  ini: "ini",
  toml: "ini",
  cfg: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  mk: "makefile",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  php: "php",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  yml: "yaml",
  yaml: "yaml",
};

const BY_NAME: Readonly<Record<string, LanguageId>> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".editorconfig": "ini",
  ".gitconfig": "ini",
  ".npmrc": "ini",
};

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** The language of a file, from its name; undefined for plain text and unknown types. */
export function languageFor(path: string): LanguageId | undefined {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  const byName = own(BY_NAME, name);
  if (byName) return byName;
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? own(BY_EXTENSION, name.slice(dot + 1)) : undefined;
}

/** The app's one highlighter; grammars are registered as they load. */
export const lowlight = createLowlight();
const loading = new Map<LanguageId, Promise<void>>();

/** Loads and registers a grammar once; resolves when it can be used. */
export function loadGrammar(language: LanguageId): Promise<void> {
  let pending = loading.get(language);
  if (!pending) {
    pending = GRAMMARS[language]().then((grammar) => {
      lowlight.register(language, grammar.default);
    });
    // A failed load (should not happen: the chunk is on disk) can be retried next time.
    pending.catch(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/**
 * Whether the language's grammar is ready; loads it on first use. The diff shows plain text until
 * then, and when there is no grammar.
 */
export function useGrammar(language: LanguageId | undefined): boolean {
  const [loaded, setLoaded] = useState<LanguageId>();
  useEffect(() => {
    if (language === undefined || lowlight.registered(language)) return;
    let current = true;
    loadGrammar(language).then(
      () => {
        if (current) setLoaded(language);
      },
      () => {
        // Plain text.
      },
    );
    return () => {
      current = false;
    };
  }, [language]);
  return language !== undefined && (loaded === language || lowlight.registered(language));
}
