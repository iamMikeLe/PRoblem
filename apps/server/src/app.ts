import type { DatabaseSync } from "node:sqlite";
import websocket from "@fastify/websocket";
import type { HealthResponse } from "@reviewroom/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import { registerErrorHandlers } from "./http/errors.ts";
import { createOriginGuard } from "./http/originGuard.ts";
import { projectRoutes } from "./modules/projects/routes.ts";
import type { EventHub } from "./realtime/hub.ts";
import { VERSION } from "./version.ts";

export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  hub: EventHub;
  /** The user's home folder, used to expand `~` in project paths. Defaults to `os.homedir()`. */
  userHome?: string;
}

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp({ config, db, hub, userHome }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const startedAt = Date.now();

  app.addHook("onRequest", createOriginGuard(config.allowedOrigins));
  registerErrorHandlers(app);
  await app.register(websocket);
  await app.register(projectRoutes, userHome === undefined ? { db } : { db, userHome });

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
