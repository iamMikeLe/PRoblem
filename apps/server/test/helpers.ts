import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/database.ts";
import { EventHub } from "../src/realtime/hub.ts";

/** `app.inject()` sends `Host: localhost:80` unless a test sets another one. */
export const INJECT_ORIGIN = "http://localhost:80";

/** A fully wired app on an in-memory database. Close it in `afterEach`. */
export async function createTestApp(options: { userHome?: string } = {}): Promise<FastifyInstance> {
  const base = loadConfig({});
  const config = {
    ...base,
    logLevel: "silent" as const,
    allowedOrigins: new Set([...base.allowedOrigins, INJECT_ORIGIN]),
  };
  const db = openDatabase(":memory:");
  const app = await buildApp({
    config,
    db,
    hub: new EventHub(),
    ...(options.userHome === undefined ? {} : { userHome: options.userHome }),
  });
  app.addHook("onClose", () => db.close());
  return app;
}
