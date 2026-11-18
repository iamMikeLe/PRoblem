import { describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_FILTERS, hiddenBy, matchesGlob } from "../src/changes.ts";

describe("matchesGlob", () => {
  it.each([
    ["src/a.ts", "src/*.ts", true],
    ["src/deep/a.ts", "src/*.ts", false],
    ["src/deep/a.ts", "src/**/*.ts", true],
    ["src/a.ts", "src/**/*.ts", true],
    ["a.min.js", "*.min.js", true],
    ["lib/vendor/a.min.js", "*.min.js", true],
    ["docs/guide.md", "docs/**", true],
    ["other/docs/guide.md", "docs/**", false],
    ["/abs/x", "x", true],
    ["a.ts", "a.t?", true],
    ["a.tsx", "a.t?", false],
    ["a+b(1).ts", "a+b(1).ts", true],
    ["axbx1yts", "a+b(1).ts", false],
  ])("%s ~ %s → %s", (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});

describe("matchesGlob performance", () => {
  it("stays fast on patterns that make backtracking regexes explode", () => {
    const pattern = `${"**a".repeat(8)}**b`;
    const path = "a".repeat(60);
    const started = Date.now();
    expect(matchesGlob(path, pattern)).toBe(false);
    expect(matchesGlob(`${path}b`, pattern)).toBe(true);
    expect(matchesGlob("x/".repeat(200), "**/**/**/**/**/y")).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("treats runs of stars like one", () => {
    expect(matchesGlob("src/a.ts", "src/***.ts")).toBe(true);
    expect(matchesGlob("a/b/c.ts", "a/****/c.ts")).toBe(true);
  });
});

describe("hiddenBy", () => {
  it("hides nothing by default, and tests or generated files on request", () => {
    expect(hiddenBy("pnpm-lock.yaml", DEFAULT_CHANGE_FILTERS)).toBeUndefined();
    expect(hiddenBy("src/app.test.ts", DEFAULT_CHANGE_FILTERS)).toBeUndefined();
    const generated = { ...DEFAULT_CHANGE_FILTERS, hideGenerated: true };
    expect(hiddenBy("pnpm-lock.yaml", generated)).toBe("generated");
    expect(hiddenBy("apps/web/dist/index.js", generated)).toBe("generated");
    const filters = { hideTests: true, hideGenerated: false, exclude: ["docs/**"] };
    expect(hiddenBy("src/app.test.ts", filters)).toBe("tests");
    expect(hiddenBy("pkg/__tests__/x.ts", filters)).toBe("tests");
    expect(hiddenBy("pnpm-lock.yaml", filters)).toBeUndefined();
    expect(hiddenBy("docs/a.md", filters)).toBe("pattern");
    expect(hiddenBy("src/app.ts", filters)).toBeUndefined();
  });
});
