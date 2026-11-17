import { z } from "zod";
import { ProjectSchema } from "./domain.ts";

/** Request and response contracts of the HTTP API (`/api/*`). */

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Error codes the API itself returns. `ApiErrorSchema.code` stays a plain string so the client
 * still parses codes it does not know yet; the server may only send these.
 */
export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "not_found",
  "internal",
  "forbidden_origin",
  "forbidden_host",
  "invalid_path",
  "path_not_found",
  "path_not_accessible",
  "not_a_directory",
  "not_a_git_repo",
  "outside_repository",
  "git_unavailable",
  "project_exists",
  "project_not_found",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PROJECT_NAME_MAX = 120;
export const REVIEW_PROMPT_MAX = 20_000;
export const PROJECT_PATH_MAX = 4096;

export const ProjectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX);
export const ReviewPromptSchema = z
  .string()
  .trim()
  .min(1, "The prompt cannot be empty.")
  .max(REVIEW_PROMPT_MAX, `The prompt is limited to ${REVIEW_PROMPT_MAX} characters.`);

export const CreateProjectRequestSchema = z.strictObject({
  /** Absolute path (a leading `~` is expanded) to a folder inside a git work tree. */
  path: z.string().trim().min(1).max(PROJECT_PATH_MAX),
  name: ProjectNameSchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectRequestSchema = z
  .strictObject({
    name: ProjectNameSchema.optional(),
    reviewPrompt: ReviewPromptSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.reviewPrompt !== undefined, {
    message: "Nothing to update",
  });
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const ProjectListResponseSchema = z.object({ projects: z.array(ProjectSchema) });
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
