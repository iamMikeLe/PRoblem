import { DEFAULT_CHANGE_FILTERS, DEFAULT_SETTINGS, type Project } from "@problem/shared";
import { describe, expect, it, vi } from "vitest";
import { AppFailure, type Logger, silentLogger } from "../../../src/main/errors.ts";
import { createDispatcher, type IpcHandlers } from "../../../src/main/ipc/dispatcher.ts";

const project: Project = {
  id: "p1",
  name: "payments-api",
  path: "/repos/payments-api",
  reviewPrompt: "Review it.",
  changeFilters: DEFAULT_CHANGE_FILTERS,
  createdAt: "2026-11-17T10:00:00.000Z",
  updatedAt: "2026-11-17T10:00:00.000Z",
};

function handlers(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
  return {
    "projects:list": () => [project],
    "projects:create": () => project,
    "projects:update": () => project,
    "projects:remove": () => null,
    "projects:branches": () => [],
    "reviews:list": () => [],
    "reviews:create": () => {
      throw new Error("not used");
    },
    "reviews:close": () => ({ note: null }),
    "reviews:events": () => [],
    "reviews:send": () => null,
    "reviews:stop": () => null,
    "reviews:checkUpdate": () => {
      throw new Error("not used");
    },
    "reviews:refresh": () => {
      throw new Error("not used");
    },
    "pr:conversation": () => ({ status: "none", reason: "x" }),
    "pr:preview": () => ({ status: "none", reason: "x" }),
    "pr:post": () => ({ url: "https://github.com/a/b/pull/1" }),
    "pr:open": () => null,
    "app:reportError": () => null,
    "search:query": () => ({ reviews: [], findings: [], files: [] }),
    "changes:files": () => ({ fromSha: "a", toSha: "b", files: [] }),
    "changes:file": () => ({ path: "a", binary: false, tooLarge: false, hunks: [] }),
    "reviews:setFixMode": () => {
      throw new Error("not used");
    },
    "approvals:list": () => [],
    "approvals:decide": () => null,
    "claude:catalog": () => ({ models: [], commands: [] }),
    "findings:list": () => [],
    "findings:counts": () => ({}),
    "findings:setVerdict": () => {
      throw new Error("not used");
    },
    "settings:get": () => DEFAULT_SETTINGS,
    "settings:update": () => DEFAULT_SETTINGS,
    "editor:open": () => null,
    "dialog:pickFolder": async () => null,
    "activity:list": () => [],
    "activity:markRead": () => null,
    ...overrides,
  };
}

describe("IPC dispatcher", () => {
  it("passes validated, normalized input to the handler and wraps the result", async () => {
    const create = vi.fn<IpcHandlers["projects:create"]>(() => project);
    const dispatch = createDispatcher(handlers({ "projects:create": create }), silentLogger);

    const result = await dispatch("projects:create", { path: "  /repos/payments-api  " });
    expect(result).toEqual({ ok: true, data: project });
    expect(create).toHaveBeenCalledWith({ path: "/repos/payments-api" });
  });

  it("rejects unknown channels", async () => {
    const result = await createDispatcher(handlers(), silentLogger)("projects:drop", {});
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_channel" } });
  });

  it("rejects invalid input without calling the handler", async () => {
    const update = vi.fn<IpcHandlers["projects:update"]>(() => project);
    const dispatch = createDispatcher(handlers({ "projects:update": update }), silentLogger);

    for (const input of [undefined, { id: "p1", patch: {} }, { id: "p1", patch: { path: "/x" } }]) {
      const result = await dispatch("projects:update", input);
      expect(result, JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("hands pr:post the user's texts untouched, and refuses texts GitHub would not take", async () => {
    const post = vi.fn<IpcHandlers["pr:post"]>(() => ({
      url: "https://github.com/a/b/pull/1",
    }));
    const dispatch = createDispatcher(handlers({ "pr:post": post }), silentLogger);
    const findings = [{ number: 2, text: "  cc @alice\n" }];

    const result = await dispatch("pr:post", {
      id: "r1",
      event: "COMMENT",
      body: "",
      findings,
    });
    expect(result).toMatchObject({ ok: true });
    expect(post).toHaveBeenCalledWith({ id: "r1", event: "COMMENT", body: "", findings });

    for (const bad of [[2], [{ number: 2, text: "" }], [{ number: 2, text: "x".repeat(65_537) }]]) {
      const refused = await dispatch("pr:post", {
        id: "r1",
        event: "COMMENT",
        body: "",
        findings: bad,
      });
      expect(refused).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    }
    expect(post).toHaveBeenCalledOnce();
  });

  it("keeps the code of an expected failure", async () => {
    const dispatch = createDispatcher(
      handlers({
        "projects:remove": () => {
          throw new AppFailure("project_not_found", "Project not found");
        },
      }),
      silentLogger,
    );
    expect(await dispatch("projects:remove", { id: "nope" })).toEqual({
      ok: false,
      error: { code: "project_not_found", message: "Project not found" },
    });
  });

  it("logs unexpected errors and hides their details from the renderer", async () => {
    const log: Logger = { info: vi.fn(), error: vi.fn() };
    const dispatch = createDispatcher(
      handlers({
        "projects:list": () => {
          throw new Error("SQLITE_CORRUPT at /Users/me/.problem/problem.db");
        },
      }),
      log,
    );
    const result = await dispatch("projects:list", undefined);
    expect(result).toEqual({
      ok: false,
      error: { code: "internal", message: "Something went wrong in the app" },
    });
    expect(log.error).toHaveBeenCalledOnce();
  });
});
