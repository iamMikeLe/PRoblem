import { describe, expect, it } from "vitest";
import { COMMENT_TEXT_MAX, IPC_CHANNELS, ipcContract, isIpcChannel } from "../src/index.ts";

describe("ipc contract", () => {
  it("declares exactly the channels the preload allowlist exposes", () => {
    expect(Object.keys(ipcContract).sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it("recognizes only known channel names", () => {
    expect(isIpcChannel("projects:list")).toBe(true);
    expect(isIpcChannel("projects:drop")).toBe(false);
    expect(isIpcChannel(42)).toBe(false);
  });

  it("validates update input as an id plus a non-empty patch", () => {
    const schema = ipcContract["projects:update"].input;
    expect(schema.safeParse({ id: "p1", patch: { name: "x" } }).success).toBe(true);
    expect(schema.safeParse({ id: "p1", patch: {} }).success).toBe(false);
    expect(schema.safeParse({ id: "", patch: { name: "x" } }).success).toBe(false);
  });
});

describe("github:post input", () => {
  const schema = ipcContract["github:post"].input;
  const request = (findings: unknown) => ({ id: "r1", event: "COMMENT", body: "", findings });

  it("carries each finding's final text, exactly as written", () => {
    const parsed = schema.parse(request([{ number: 1, text: "  **Edited** @alice\n" }]));
    expect(parsed.findings).toEqual([{ number: 1, text: "  **Edited** @alice\n" }]);
    const longest = request([{ number: 1, text: "x".repeat(COMMENT_TEXT_MAX) }]);
    expect(schema.safeParse(longest).success).toBe(true);
  });

  it("refuses empty, oversize, duplicate or malformed findings", () => {
    const invalid: unknown[] = [
      [1],
      [{ number: 1 }],
      [{ number: 1, text: " \n " }],
      [{ number: 1, text: "x".repeat(COMMENT_TEXT_MAX + 1) }],
      [{ number: 0, text: "x" }],
      [{ number: 1, text: "x", extra: true }],
      [
        { number: 1, text: "x" },
        { number: 1, text: "y" },
      ],
      // Too much text in total.
      Array.from({ length: 20 }, (_, i) => ({ number: i + 1, text: "x".repeat(60_000) })),
    ];
    for (const findings of invalid) {
      const label = JSON.stringify(findings).slice(0, 80);
      expect(schema.safeParse(request(findings)).success, label).toBe(false);
    }
  });
});
