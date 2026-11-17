import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { EventHub } from "./realtime/hub.ts";

const config = loadConfig();
mkdirSync(config.homeDir, { recursive: true, mode: 0o700 });

const db = openDatabase(join(config.homeDir, "reviewroom.db"));
const hub = new EventHub();
const app = await buildApp({ config, db, hub });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
