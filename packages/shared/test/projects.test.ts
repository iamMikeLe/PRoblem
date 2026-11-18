import { describe, expect, it } from "vitest";
import {
  CreateProjectRequestSchema,
  DEFAULT_CHANGE_FILTERS,
  DEFAULT_REVIEW_PROMPT,
  ipcContract,
  ReviewPromptSchema,
  UpdateProjectRequestSchema,
} from "../src/index.ts";

const project = {
  id: "p1",
  name: "payments-api",
  path: "/repos/payments-api",
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  changeFilters: DEFAULT_CHANGE_FILTERS,
  createdAt: "2026-11-17T10:00:00.000Z",
  updatedAt: "2026-11-17T10:00:00.000Z",
};

describe("project contracts", () => {
  it("accepts a create request with and without a name, trimming input", () => {
    expect(CreateProjectRequestSchema.parse({ path: " /repos/a/ " })).toEqual({
      path: "/repos/a/",
    });
    expect(CreateProjectRequestSchema.parse({ path: "/repos/a", name: "A" }).name).toBe("A");
  });

  it("rejects a create request without a path, with an empty name or unknown keys", () => {
    expect(CreateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateProjectRequestSchema.safeParse({ path: "   " }).success).toBe(false);
    expect(CreateProjectRequestSchema.safeParse({ path: "/a", name: " " }).success).toBe(false);
    expect(CreateProjectRequestSchema.safeParse({ path: "/a", id: "x" }).success).toBe(false);
  });

  it("accepts an update of the name or the prompt", () => {
    expect(UpdateProjectRequestSchema.parse({ name: "B" })).toEqual({ name: "B" });
    expect(UpdateProjectRequestSchema.parse({ reviewPrompt: "Check it" }).reviewPrompt).toBe(
      "Check it",
    );
  });

  it("rejects an empty update, a path change, an empty or oversized prompt", () => {
    expect(UpdateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ path: "/b" }).success).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ reviewPrompt: "  " }).success).toBe(false);
    expect(ReviewPromptSchema.safeParse("x".repeat(20_001)).success).toBe(false);
  });

  it("parses a project list and requires updatedAt", () => {
    const listOutput = ipcContract["projects:list"].output;
    expect(listOutput.parse([project])).toHaveLength(1);
    const { updatedAt: _omitted, ...withoutUpdatedAt } = project;
    expect(listOutput.safeParse([withoutUpdatedAt]).success).toBe(false);
  });

  it("ships a default prompt that passes its own validation", () => {
    expect(ReviewPromptSchema.safeParse(DEFAULT_REVIEW_PROMPT).success).toBe(true);
  });
});
