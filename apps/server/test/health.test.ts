import { HealthResponseSchema } from "@reviewroom/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.ts";

describe("GET /api/health", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("returns a valid health payload", async () => {
    app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).status).toBe("ok");
  });

  it("rejects requests from a foreign browser origin", async () => {
    app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("accepts requests from the web UI origin", async () => {
    app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("origin guard", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("rejects a rebound host even without an Origin header (DNS rebinding)", async () => {
    app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "evil.example:4400" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden_host" } });
  });

  it("accepts the server's own host and the Vite proxy host", async () => {
    app = await createTestApp();
    for (const host of ["127.0.0.1:4400", "localhost:4400", "localhost:5173"]) {
      const response = await app.inject({ method: "GET", url: "/api/health", headers: { host } });
      expect(response.statusCode, host).toBe(200);
    }
  });

  it("rejects a WebSocket upgrade from a foreign origin", async () => {
    app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/ws",
      headers: {
        origin: "https://evil.example",
        connection: "upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
