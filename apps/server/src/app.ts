import type { DatabaseSync } from "node:sqlite";
import websocket from "@fastify/websocket";
import type { HealthResponse } from "@reviewroom/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import { createOriginGuard } from "./http/originGuard.ts";
import type { EventHub } from "./realtime/hub.ts";
import { VERSION } from "./version.ts";

export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  hub: EventHub;
}

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp({ config, hub }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const startedAt = Date.now();

  app.addHook("onRequest", createOriginGuard(config.allowedOrigins));
  await app.register(websocket);

  app.get(
    "/api/health",
    async (): Promise<HealthResponse> => ({
      status: "ok",
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.get("/ws", { websocket: true }, (socket) => {
    hub.add(socket);
    hub.send(socket, { type: "hello", serverTime: new Date().toISOString(), version: VERSION });
  });

  return app;
}
