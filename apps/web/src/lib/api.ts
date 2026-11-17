import {
  ApiErrorSchema,
  type CreateProjectRequest,
  type HealthResponse,
  HealthResponseSchema,
  type Project,
  type ProjectListResponse,
  ProjectListResponseSchema,
  ProjectSchema,
  type UpdateProjectRequest,
} from "@reviewroom/shared";
import type { z } from "zod";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Sends a request and throws an `ApiRequestError` for a non-2xx response. The JSON content type
 * is only set when there is a body: Fastify rejects an empty body declared as JSON.
 */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(response.status, "unknown", response.statusText);
  }
  return response;
}

/** Fetches a JSON endpoint and validates the response against its shared schema. */
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiRequestError(
      response.status,
      "invalid_response",
      "Unexpected response from the server",
    );
  }
  return parsed.data;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  health: (): Promise<HealthResponse> => request("/api/health", HealthResponseSchema),
  projects: {
    list: (): Promise<ProjectListResponse> => request("/api/projects", ProjectListResponseSchema),
    create: (body: CreateProjectRequest): Promise<Project> =>
      request("/api/projects", ProjectSchema, json("POST", body)),
    update: (id: string, body: UpdateProjectRequest): Promise<Project> =>
      request(`/api/projects/${encodeURIComponent(id)}`, ProjectSchema, json("PATCH", body)),
    remove: async (id: string): Promise<void> => {
      await send(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },
};
