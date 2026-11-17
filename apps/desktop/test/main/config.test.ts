import { describe, expect, it } from "vitest";
import { dataDir } from "../../src/main/config.ts";

describe("dataDir", () => {
  it("defaults to ~/.reviewroom", () => {
    expect(dataDir({}, "/Users/me")).toBe("/Users/me/.reviewroom");
    expect(dataDir({ REVIEWROOM_HOME: "  " }, "/Users/me")).toBe("/Users/me/.reviewroom");
  });

  it("honors REVIEWROOM_HOME", () => {
    expect(dataDir({ REVIEWROOM_HOME: "/tmp/rr" }, "/Users/me")).toBe("/tmp/rr");
  });
});
