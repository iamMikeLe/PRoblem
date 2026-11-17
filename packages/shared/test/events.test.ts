import { describe, expect, it } from "vitest";
import { parseAppEvent } from "../src/index.ts";

describe("parseAppEvent", () => {
  it("accepts a valid review status event", () => {
    const event = parseAppEvent({ type: "review.status", reviewId: "r1", status: "running" });
    expect(event?.type).toBe("review.status");
  });

  it("rejects unknown event types and bad payloads", () => {
    expect(parseAppEvent({ type: "nope" })).toBeUndefined();
    expect(
      parseAppEvent({ type: "review.status", reviewId: "r1", status: "dancing" }),
    ).toBeUndefined();
    expect(parseAppEvent("not an object")).toBeUndefined();
  });
});
