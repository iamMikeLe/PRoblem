import { describe, expect, it } from "vitest";
import { parseServerEvent } from "../src/index.ts";

describe("parseServerEvent", () => {
  it("accepts a valid hello event", () => {
    const event = parseServerEvent(
      JSON.stringify({ type: "hello", serverTime: "2026-11-17T10:00:00.000Z", version: "0.1.0" }),
    );
    expect(event?.type).toBe("hello");
  });

  it("rejects malformed JSON and unknown event types", () => {
    expect(parseServerEvent("{not json")).toBeUndefined();
    expect(parseServerEvent(JSON.stringify({ type: "nope" }))).toBeUndefined();
  });
});
