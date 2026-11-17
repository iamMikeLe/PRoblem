import type { ApiError, ApiErrorCode } from "@reviewroom/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

/** The fields Fastify sets on its own client errors (`FST_ERR_*`, body limits, bad JSON). */
const FastifyClientErrorShape = z.object({
  statusCode: z.number().int().min(400).max(499),
  code: z.string().startsWith("FST_"),
  message: z.string(),
});

/** Replies with the shared `ApiError` shape. */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}

/**
 * Makes every error the routes do not handle themselves use the shared `ApiError` shape:
 * Fastify's own client errors (malformed JSON, unsupported media type) become
 * `invalid_request`, unknown routes `not_found`, and anything else a 500 `internal` whose details
 * stay in the server log.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const client = FastifyClientErrorShape.safeParse(error);
    if (client.success) {
      request.log.info({ code: client.data.code }, "rejected request");
      return sendError(reply, client.data.statusCode, "invalid_request", client.data.message);
    }
    request.log.error({ err: error }, "request failed");
    return sendError(reply, 500, "internal", "Something went wrong on the server");
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, "not_found", `No route for ${request.method} ${request.url}`),
  );
}
