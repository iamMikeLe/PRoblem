import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CreateProjectRequestSchema,
  DEFAULT_REVIEW_PROMPT,
  type Project,
  type ProjectListResponse,
  UpdateProjectRequestSchema,
} from "@reviewroom/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sendError } from "../../http/errors.ts";
import { GitUnavailableError, NotAGitRepoError, resolveRepoRoot } from "../git/repo.ts";
import { checkFolder, isInside } from "./paths.ts";
import {
  deleteProject,
  findProjectByPath,
  insertProject,
  isUniqueViolation,
  listProjects,
  updateProject,
} from "./repository.ts";

export interface ProjectRoutesOptions {
  db: DatabaseSync;
  /** Home folder used to expand `~`; injectable for tests. */
  userHome?: string;
}

const IdParamsSchema = z.object({ id: z.string().min(1) });

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
    .join("; ");
}

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, options) => {
  const { db } = options;
  const home = options.userHome ?? homedir();

  app.get(
    "/api/projects",
    async (): Promise<ProjectListResponse> => ({
      projects: listProjects(db),
    }),
  );

  app.post("/api/projects", async (request, reply) => {
    const body = CreateProjectRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_request", describeIssues(body.error));
    }

    const folder = await checkFolder(body.data.path, home);
    if (!folder.ok) return sendError(reply, folder.status, folder.code, folder.message);

    let root: string;
    try {
      root = await resolveRepoRoot(folder.path);
    } catch (error) {
      if (error instanceof GitUnavailableError) {
        return sendError(reply, 503, "git_unavailable", error.message);
      }
      if (!(error instanceof NotAGitRepoError)) throw error;
      request.log.info({ dir: folder.path, stderr: error.detail }, "not a git repository");
      const message = error.dubiousOwnership
        ? `${folder.path} belongs to another user, so git refuses to use it (see git's safe.directory)`
        : error.message;
      return sendError(reply, 422, "not_a_git_repo", message);
    }

    // A repository's own config (core.worktree, a gitdir: file) can point git at another
    // folder. Only accept a root that contains the folder the user actually picked.
    if (!isInside(root, await realpath(folder.path))) {
      return sendError(
        reply,
        422,
        "outside_repository",
        `The repository at ${folder.path} declares its work tree elsewhere (${root})`,
      );
    }

    const existing = findProjectByPath(db, root);
    if (existing) {
      return sendError(
        reply,
        409,
        "project_exists",
        `${root} is already added as "${existing.name}"`,
      );
    }

    let project: Project;
    try {
      project = insertProject(db, {
        name: body.data.name ?? (basename(root) || root),
        path: root,
        reviewPrompt: DEFAULT_REVIEW_PROMPT,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return sendError(reply, 409, "project_exists", `${root} is already added`);
    }
    return reply.code(201).send(project);
  });

  app.patch("/api/projects/:id", async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    const body = UpdateProjectRequestSchema.safeParse(request.body);
    if (!params.success) return sendError(reply, 400, "invalid_request", "Missing project id");
    if (!body.success) {
      return sendError(reply, 400, "invalid_request", describeIssues(body.error));
    }
    const project = updateProject(db, params.data.id, body.data);
    if (!project) return sendError(reply, 404, "project_not_found", "Project not found");
    return project;
  });

  app.delete("/api/projects/:id", async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "invalid_request", "Missing project id");
    if (!deleteProject(db, params.data.id)) {
      return sendError(reply, 404, "project_not_found", "Project not found");
    }
    return reply.code(204).send();
  });
};
