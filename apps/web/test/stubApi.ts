import {
  type ApiErrorCode,
  CreateProjectRequestSchema,
  DEFAULT_REVIEW_PROMPT,
  type Project,
  UpdateProjectRequestSchema,
} from "@reviewroom/shared";
import { vi } from "vitest";

export interface StubRequest {
  method: string;
  url: string;
  body: unknown;
}

/** A project as the server would return it, for seeding the stub. */
export function makeProject(id: string, name: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name,
    path: `/repos/${name}`,
    reviewPrompt: DEFAULT_REVIEW_PROMPT,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

interface StubError {
  status: number;
  code: ApiErrorCode;
  message: string;
}

interface StubState {
  projects: Project[];
  requests: StubRequest[];
  /** When set, the matching request fails with this error. */
  listError?: StubError | undefined;
  createError?: StubError | undefined;
  updateError?: StubError | undefined;
  deleteError?: StubError | undefined;
}

const error = (status: number, code: ApiErrorCode, message: string) =>
  Response.json({ error: { code, message } }, { status });
const fail = ({ status, code, message }: StubError) => error(status, code, message);

/**
 * Stubs `fetch` with an in-memory version of the projects API. Set `listError`, `createError`,
 * `updateError` or `deleteError` to make those requests fail. Returns the live state.
 */
export function stubApi(initial: Project[] = []): StubState {
  const projects = [...initial];
  const requests: StubRequest[] = [];
  let nextId = 1;
  const state: StubState = { projects, requests };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, url: input, body });

      if (input === "/api/health") {
        return Response.json({ status: "ok", version: "0.1.0", uptimeSeconds: 1 });
      }
      if (input === "/api/projects" && method === "GET") {
        return state.listError ? fail(state.listError) : Response.json({ projects });
      }
      if (input === "/api/projects" && method === "POST") {
        if (state.createError) return fail(state.createError);
        // Parsing with the shared schema also checks that the UI sends a valid body.
        const { path, name } = CreateProjectRequestSchema.parse(body);
        const project = makeProject(`new-${nextId++}`, name ?? path.split("/").at(-1) ?? path, {
          path,
        });
        projects.push(project);
        return Response.json(project, { status: 201 });
      }
      const match = /^\/api\/projects\/([^/]+)$/.exec(input);
      const index = projects.findIndex((p) => p.id === decodeURIComponent(match?.[1] ?? ""));
      const current = projects[index];
      if (match && !current) return error(404, "project_not_found", "Project not found");
      if (current && method === "PATCH") {
        if (state.updateError) return fail(state.updateError);
        const patch = UpdateProjectRequestSchema.parse(body);
        const updated: Project = {
          ...current,
          name: patch.name ?? current.name,
          reviewPrompt: patch.reviewPrompt ?? current.reviewPrompt,
        };
        projects[index] = updated;
        return Response.json(updated);
      }
      if (current && method === "DELETE") {
        if (state.deleteError) return fail(state.deleteError);
        projects.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      return error(404, "not_found", `No stub for ${method} ${input}`);
    }),
  );
  return state;
}
