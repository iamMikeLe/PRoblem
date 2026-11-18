import type { IpcResult, ProblemBridge } from "@problem/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError, api } from "../../../src/renderer/src/lib/api.ts";
import { removeBridge } from "../stubBridge.ts";

const project = {
  id: "p1",
  name: "a",
  path: "/a",
  reviewPrompt: "x",
  changeFilters: { hideTests: false, hideGenerated: true, exclude: [] },
  createdAt: "2026-11-17T10:00:00.000Z",
  updatedAt: "2026-11-17T10:00:00.000Z",
};

/** Installs a bridge whose `invoke` always answers `result`, and returns the spy. */
function bridgeAnswering(result: IpcResult<unknown>) {
  const invoke = vi.fn(async (_channel: string, _input: unknown) => result);
  // Deliberately untyped: these tests simulate a main process that breaks the contract.
  const bridge = {
    invoke,
    onEvent: () => () => {},
    platform: "darwin",
  } as unknown as ProblemBridge;
  Object.defineProperty(window, "problem", { value: bridge, configurable: true });
  return invoke;
}

describe("api client", () => {
  afterEach(() => {
    removeBridge();
  });

  it("invokes the contract channel with the input", async () => {
    const invoke = bridgeAnswering({ ok: true, data: project });
    await api.projects.update("p1", { name: "b" });
    expect(invoke).toHaveBeenCalledWith("projects:update", { id: "p1", patch: { name: "b" } });
  });

  it("resolves remove with undefined", async () => {
    bridgeAnswering({ ok: true, data: null });
    await expect(api.projects.remove("p1")).resolves.toBeUndefined();
  });

  it("turns an error result into an AppRequestError with its code", async () => {
    bridgeAnswering({
      ok: false,
      error: { code: "project_exists", message: "/a is already added" },
    });
    const error = await api.projects.create({ path: "/a" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppRequestError);
    expect(error).toMatchObject({ code: "project_exists", message: "/a is already added" });
  });

  it("rejects data that breaks the contract without dumping zod issues", async () => {
    bridgeAnswering({ ok: true, data: [{ id: 1 }] });
    await expect(api.projects.list()).rejects.toMatchObject({
      code: "invalid_response",
      message: "Unexpected response from the app",
    });
  });

  it("fails clearly when not running inside the desktop app", async () => {
    await expect(api.projects.list()).rejects.toMatchObject({ code: "no_bridge" });
  });
});
