import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type ChangeFilters,
  ChangeFiltersSchema,
  DEFAULT_CHANGE_FILTERS,
  type Project,
} from "@problem/shared";
import { z } from "zod";

/** A `projects` row as SQLite returns it, validated instead of cast. */
const ProjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  review_prompt: z.string(),
  change_filters: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

function toProject(row: unknown): Project {
  const parsed = ProjectRowSchema.parse(row);
  return {
    id: parsed.id,
    name: parsed.name,
    path: parsed.path,
    reviewPrompt: parsed.review_prompt,
    changeFilters: parseFilters(parsed.change_filters),
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

/** Stored filters, or the defaults when there are none or they no longer parse. */
function parseFilters(json: string | null): ChangeFilters {
  if (json === null) return DEFAULT_CHANGE_FILTERS;
  try {
    const parsed = ChangeFiltersSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : DEFAULT_CHANGE_FILTERS;
  } catch {
    return DEFAULT_CHANGE_FILTERS;
  }
}

const COLUMNS = "id, name, path, review_prompt, change_filters, created_at, updated_at";

export function listProjects(db: DatabaseSync): Project[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM projects ORDER BY name COLLATE NOCASE, created_at`)
    .all()
    .map(toProject);
}

export function getProject(db: DatabaseSync, id: string): Project | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`).get(id);
  return row === undefined ? undefined : toProject(row);
}

export function findProjectByPath(db: DatabaseSync, path: string): Project | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM projects WHERE path = ?`).get(path);
  return row === undefined ? undefined : toProject(row);
}

export interface NewProject {
  name: string;
  path: string;
  reviewPrompt: string;
}

/** Inserts a project. Throws the SQLite UNIQUE error if the path is already registered. */
export function insertProject(db: DatabaseSync, input: NewProject, now = new Date()): Project {
  const project: Project = {
    id: randomUUID(),
    ...input,
    changeFilters: DEFAULT_CHANGE_FILTERS,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.prepare(
    "INSERT INTO projects (id, name, path, review_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    project.id,
    project.name,
    project.path,
    project.reviewPrompt,
    project.createdAt,
    project.updatedAt,
  );
  return project;
}

export interface ProjectPatch {
  name?: string | undefined;
  reviewPrompt?: string | undefined;
  changeFilters?: ChangeFilters | undefined;
}

/** Applies a partial update; returns the updated project, or `undefined` if the id is unknown. */
export function updateProject(
  db: DatabaseSync,
  id: string,
  patch: ProjectPatch,
  now = new Date(),
): Project | undefined {
  const current = getProject(db, id);
  if (!current) return undefined;
  const next: Project = {
    ...current,
    name: patch.name ?? current.name,
    reviewPrompt: patch.reviewPrompt ?? current.reviewPrompt,
    changeFilters: patch.changeFilters ?? current.changeFilters,
    updatedAt: now.toISOString(),
  };
  db.prepare(
    "UPDATE projects SET name = ?, review_prompt = ?, change_filters = ?, updated_at = ? WHERE id = ?",
  ).run(next.name, next.reviewPrompt, JSON.stringify(next.changeFilters), next.updatedAt, id);
  return next;
}

/** Deletes a project; returns whether a row was removed. */
export function deleteProject(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes) > 0;
}

/** True for SQLite's UNIQUE constraint violation (extended code 2067). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "errcode" in error && error.errcode === 2067;
}
