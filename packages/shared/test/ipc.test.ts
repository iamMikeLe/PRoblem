import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, ipcContract, isIpcChannel } from "../src/index.ts";

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
