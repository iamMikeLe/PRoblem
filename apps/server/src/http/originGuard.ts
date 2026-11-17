import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Rejects browser requests from any origin other than our own UI. The server listens on loopback
 * only, but a malicious web page in the same browser could still call it (CSRF / DNS rebinding),
 * so every request that carries an Origin header must match the allowlist. Non-browser clients
 * (tests, curl) send no Origin and are allowed.
 */
export function createOriginGuard(allowed: ReadonlySet<string>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const origin = request.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      await reply
        .code(403)
        .send({ error: { code: "forbidden_origin", message: "Origin not allowed" } });
    }
  };
}
