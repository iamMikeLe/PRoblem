import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "./errors.ts";

/**
 * Rejects requests that did not come from our own UI. The server listens on loopback only, but a
 * malicious web page in the same browser could still reach it:
 *
 * - Cross-site requests (CSRF) carry a foreign `Origin` header, which must match the allowlist.
 *   Non-browser clients (tests, curl) send no Origin and are allowed.
 * - DNS rebinding makes `evil.example:4400` resolve to 127.0.0.1. The browser then treats the
 *   page's GETs as same-origin and sends no `Origin` at all, so the `Host` header must also name
 *   one of our own origins.
 */
export function createOriginGuard(allowedOrigins: ReadonlySet<string>) {
  const allowedHosts = new Set([...allowedOrigins].flatMap(hostForms));

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { origin, host } = request.headers;
    if (host === undefined || !allowedHosts.has(host)) {
      await sendError(reply, 403, "forbidden_host", "Host not allowed");
      return;
    }
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      await sendError(reply, 403, "forbidden_origin", "Origin not allowed");
    }
  };
}

/** `Host` values a client may send for an origin: with and without an explicit default port. */
function hostForms(origin: string): string[] {
  const url = new URL(origin);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return [url.host, `${url.hostname}:${port}`];
}
