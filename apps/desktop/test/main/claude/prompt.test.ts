import { describe, expect, it } from "vitest";
import { reviewSystemAppend } from "../../../src/main/claude/prompt.ts";

describe("review system prompt", () => {
  it("asks for steps to reproduce every finding that can be shown", () => {
    const prompt = reviewSystemAppend(false);
    expect(prompt).toContain('Give numbered steps to reproduce every finding in "reproduction"');
    expect(prompt).toMatch(/expected and the\s+actual result/);
    // Honest: a pure style nit may have none, and steps must not be made up.
    expect(prompt).toMatch(/pure naming or style nit/);
    expect(prompt).toMatch(/do not invent steps/);
    // "Ask Claude for steps" in the Findings tab relies on this.
    expect(prompt).toMatch(/asks for steps for a finding, add them with an update/);
  });

  it("keeps the findings guidance with fix mode on", () => {
    const prompt = reviewSystemAppend(true);
    expect(prompt).toContain("Fix mode is on");
    expect(prompt).toContain("report_findings");
    expect(prompt).toContain("reproduce every finding");
  });
});
