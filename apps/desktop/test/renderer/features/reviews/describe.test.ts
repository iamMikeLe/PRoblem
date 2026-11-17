import { describe, expect, it } from "vitest";
import { formatAge } from "../../../../src/renderer/src/features/reviews/describe.ts";

describe("formatAge", () => {
  const now = new Date("2026-11-17T12:00:00.000Z");
  it("uses compact units like a chat list", () => {
    expect(formatAge("2026-11-17T11:59:30.000Z", now)).toBe("now");
    expect(formatAge("2026-11-17T11:55:00.000Z", now)).toBe("5m");
    expect(formatAge("2026-11-17T09:00:00.000Z", now)).toBe("3h");
    expect(formatAge("2026-11-15T12:00:00.000Z", now)).toBe("2d");
  });

  it("treats future timestamps (clock skew) as now", () => {
    expect(formatAge("2026-11-17T12:05:00.000Z", now)).toBe("now");
  });
});
