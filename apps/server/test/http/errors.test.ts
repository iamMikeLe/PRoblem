import { ApiErrorSchema } from "@reviewroom/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandlers } from "../../src/http/errors.ts";

describe("registerErrorHandlers", () => {
  it("hides the message of an unexpected error behind a 500 internal", async () => {
    const app = Fastify({ logger: false });
    registerErrorHandlers(app);
    app.get("/boom", async () => {
      throw new Error("secret detail from /Users/someone");
    });
    app.get("/library", async () => {
      throw Object.assign(new Error("library internals"), { statusCode: 418 });
    });

    for (const url of ["/boom", "/library"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(500);
      expect(ApiErrorSchema.parse(response.json()).error).toEqual({
        code: "internal",
        message: "Something went wrong on the server",
      });
    }
    await app.close();
  });
});
