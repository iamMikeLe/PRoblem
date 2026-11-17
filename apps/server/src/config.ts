import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  REVIEWROOM_PORT: z.coerce.number().int().min(1).max(65535).default(4400),
  REVIEWROOM_HOME: z.string().min(1).default(join(homedir(), ".reviewroom")),
  /** The only browser origin allowed to call the API (the Vite dev server by default). */
  REVIEWROOM_WEB_ORIGIN: z.url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  /** Always loopback: this is a single-user local tool and must never listen on the network. */
  host: "127.0.0.1";
  port: number;
  homeDir: string;
  allowedOrigins: ReadonlySet<string>;
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    host: "127.0.0.1",
    port: parsed.REVIEWROOM_PORT,
    homeDir: parsed.REVIEWROOM_HOME,
    allowedOrigins: new Set([
      parsed.REVIEWROOM_WEB_ORIGIN,
      `http://localhost:${parsed.REVIEWROOM_PORT}`,
      `http://127.0.0.1:${parsed.REVIEWROOM_PORT}`,
    ]),
    logLevel: parsed.LOG_LEVEL,
  };
}
