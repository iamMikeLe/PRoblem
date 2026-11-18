import { describe, expect, it } from "vitest";
import { dataDir } from "../../src/main/config.ts";

describe("dataDir", () => {
  it("defaults to ~/.problem", () => {
    expect(dataDir({}, "/Users/me")).toBe("/Users/me/.problem");
    expect(dataDir({ PROBLEM_HOME: "  " }, "/Users/me")).toBe("/Users/me/.problem");
  });

  it("honors PROBLEM_HOME", () => {
    expect(dataDir({ PROBLEM_HOME: "/tmp/rr" }, "/Users/me")).toBe("/tmp/rr");
  });
});
