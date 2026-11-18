import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type CreateProjectRequest,
  DEFAULT_REVIEW_PROMPT,
  type Project,
  type UpdateProjectRequest,
} from "@problem/shared";
import { AppFailure, type Logger } from "../errors.ts";
import { GitUnavailableError, NotAGitRepoError, resolveRepoRoot } from "../git/repo.ts";
import { countOpenReviews } from "../reviews/repository.ts";
import { checkFolder, isInside } from "./paths.ts";
import {
  deleteProject,
  findProjectByPath,
  insertProject,
  isUniqueViolation,
  listProjects,
  updateProject,
} from "./repository.ts";

export interface ProjectServiceDeps {
  db: DatabaseSync;
  /** Home folder used to expand `~`; injectable for tests. */
  home: string;
  log: Logger;
}

export interface ProjectService {
  list(): Project[];
  create(input: CreateProjectRequest): Promise<Project>;
  update(id: string, patch: UpdateProjectRequest): Project;
  remove(id: string): void;
}

/** Project use cases. Inputs are already validated against the shared schemas by the dispatcher. */
export function createProjectService({ db, home, log }: ProjectServiceDeps): ProjectService {
  async function repositoryRoot(folder: string): Promise<string> {
    try {
      return await resolveRepoRoot(folder);
    } catch (error) {
      if (error instanceof GitUnavailableError) {
        throw new AppFailure("git_unavailable", error.message, { cause: error });
      }
      if (!(error instanceof NotAGitRepoError)) throw error;
      log.info("not a git repository", { dir: folder, stderr: error.detail });
      const message = error.dubiousOwnership
        ? `${folder} belongs to another user, so git refuses to use it (see git's safe.directory)`
        : error.message;
      throw new AppFailure("not_a_git_repo", message, { cause: error });
    }
  }

  return {
    list: () => listProjects(db),

    async create(input) {
      const folder = await checkFolder(input.path, home);
      if (!folder.ok) throw new AppFailure(folder.code, folder.message);

      const root = await repositoryRoot(folder.path);

      // A repository's own config (core.worktree, a gitdir: file) can point git at another
      // folder. Only accept a root that contains the folder the user actually picked.
      if (!isInside(root, await realpath(folder.path))) {
        throw new AppFailure(
          "outside_repository",
          `The repository at ${folder.path} declares its work tree elsewhere (${root})`,
        );
      }

      const existing = findProjectByPath(db, root);
      if (existing) {
        throw new AppFailure("project_exists", `${root} is already added as "${existing.name}"`);
      }

      try {
        return insertProject(db, {
          name: input.name ?? (basename(root) || root),
          path: root,
          reviewPrompt: DEFAULT_REVIEW_PROMPT,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        throw new AppFailure("project_exists", `${root} is already added`, { cause: error });
      }
    },

    update(id, patch) {
      const project = updateProject(db, id, patch);
      if (!project) throw new AppFailure("project_not_found", "Project not found");
      return project;
    },

    remove(id) {
      const open = countOpenReviews(db, id);
      if (open > 0) {
        throw new AppFailure(
          "project_has_reviews",
          `Close the project's ${open === 1 ? "open review" : `${open} open reviews`} first`,
        );
      }
      if (!deleteProject(db, id)) throw new AppFailure("project_not_found", "Project not found");
    },
  };
}
