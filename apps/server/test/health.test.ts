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
