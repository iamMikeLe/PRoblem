import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "../../src/lib/api.ts";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends DELETE without a JSON content type and accepts 204", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.projects.remove("p 1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/p%201");
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
  });

  it("sends JSON bodies with a content type", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(
        {
          id: "p1",
          name: "a",
          path: "/a",
          reviewPrompt: "x",
          createdAt: "2026-11-17T10:00:00.000Z",
          updatedAt: "2026-11-17T10:00:00.000Z",
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.projects.create({ path: "/a" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ path: "/a" }));
  });

  it("sends PATCH updates as JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        id: "p1",
        name: "b",
        path: "/a",
        reviewPrompt: "x",
        createdAt: "2026-11-17T10:00:00.000Z",
        updatedAt: "2026-11-17T10:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await api.projects.update("p1", { name: "b" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/p1");
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("reports a non-ApiError failure as code unknown with the status text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(api.projects.list()).rejects.toMatchObject({
      status: 502,
      code: "unknown",
      message: "Bad Gateway",
    });
  });

  it("reports a success body that breaks the contract without dumping zod issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ projects: [{ id: 1 }] })),
    );
    await expect(api.projects.list()).rejects.toMatchObject({
      code: "invalid_response",
      message: "Unexpected response from the server",
    });
  });

  it("turns an ApiError response into an ApiRequestError with its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "project_exists", message: "/a is already added" } },
          { status: 409 },
        ),
      ),
    );
    const error = await api.projects.create({ path: "/a" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: "project_exists",
      message: "/a is already added",
    });
  });
});
