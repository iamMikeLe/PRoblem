import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/database.ts";
import { EventHub } from "../src/realtime/hub.ts";

/** A fully wired app on an in-memory database. Close it in `afterEach`. */
export async function createTestApp(): Promise<FastifyInstance> {
  const config = { ...loadConfig({}), logLevel: "silent" as const };
  const db = openDatabase(":memory:");
  const app = await buildApp({ config, db, hub: new EventHub() });
  app.addHook("onClose", () => db.close());
  return app;
}
