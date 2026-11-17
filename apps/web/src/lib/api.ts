import { ApiErrorSchema, type HealthResponse, HealthResponseSchema } from "@reviewroom/shared";
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

/** Fetches a JSON endpoint and validates the response against its shared schema. */
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(response.status, "unknown", response.statusText);
  }
  return schema.parse(body);
}

export const api = {
  health: (): Promise<HealthResponse> => request("/api/health", HealthResponseSchema),
};
