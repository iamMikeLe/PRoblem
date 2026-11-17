import { describe, expect, it } from "vitest";
import { absolutePathOnly, extractPath } from "../../src/main/env.ts";

describe("extractPath", () => {
  it("finds PATH between the markers, ignoring shell banners", () => {
    const out = "Welcome!\n__REVIEWROOM_PATH__/opt/homebrew/bin:/usr/bin__REVIEWROOM_PATH__";
    expect(extractPath(out)).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("gives up on missing markers or an empty PATH", () => {
    expect(extractPath("no markers")).toBeUndefined();
    expect(extractPath("__REVIEWROOM_PATH____REVIEWROOM_PATH__")).toBeUndefined();
  });
});

describe("absolutePathOnly", () => {
  it("drops relative and empty entries a review folder could hijack", () => {
    expect(absolutePathOnly("./node_modules/.bin:/opt/homebrew/bin::bin:/usr/bin")).toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
    expect(absolutePathOnly(undefined)).toBeUndefined();
  });
});
