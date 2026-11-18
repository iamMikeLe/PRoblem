import { z } from "zod";
import type { IpcChannel } from "./channels.ts";
import { ClaudeCatalogSchema, StoredEntrySchema } from "./conversation.ts";
import { ProjectSchema, ReviewSchema } from "./domain.ts";
import type { AppEvent } from "./events.ts";

/**
 * The contract between the renderer and the Electron main process (ADR 0008).
 * Every channel declares a zod schema for its input and its output. Main validates every input,
 * the renderer validates every output, and both sides get their types from the same schemas.
 */

/** Error codes the main process returns. `AppErrorSchema.code` stays a plain string on purpose. */
export const AppErrorCodeSchema = z.enum([
  "invalid_request",
  "unknown_channel",
  "untrusted_sender",
  "internal",
  "invalid_path",
  "path_not_found",
  "path_not_accessible",
  "not_a_directory",
  "not_a_git_repo",
  "outside_repository",
  "git_unavailable",
  "project_exists",
  "project_not_found",
  "invalid_source",
  "pr_repo_mismatch",
  "gh_unavailable",
  "gh_failed",
  "branch_not_found",
  "base_not_found",
  "fetch_failed",
  "local_changes",
  "checkout_busy",
  "checkout_failed",
  "review_not_found",
  "project_has_reviews",
  "ignored_files_at_risk",
  "review_busy",
  "claude_unavailable",
]);
export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

export const AppErrorSchema = z.object({ code: z.string(), message: z.string() });
export type AppError = z.infer<typeof AppErrorSchema>;

/**
 * Electron passes only an error's message across IPC, so handlers never throw to the renderer:
 * every call resolves with this envelope instead.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

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

const ProjectIdSchema = z.string().min(1);
const ReviewIdSchema = z.string().min(1);

export const REVIEW_SOURCE_MAX = 2048;

export const CreateReviewRequestSchema = z.strictObject({
  projectId: ProjectIdSchema,
  /** A branch name, or a GitHub pull request URL. */
  source: z
    .string()
    .trim()
    .min(1, "Enter a branch name or a pull request URL.")
    .max(REVIEW_SOURCE_MAX),
  /** Base branch; omitted = the PR's base, or the remote's default branch. */
  base: z.string().trim().min(1).max(REVIEW_SOURCE_MAX).optional(),
  /** `true`: a separate worktree. `false`: check out in the project folder (in-place). */
  isolated: z.boolean(),
  prompt: ReviewPromptSchema,
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const CloseReviewResultSchema = z.object({
  /** What happened to the project checkout of an in-place review, for the user. */
  note: z.string().nullable(),
});
export type CloseReviewResult = z.infer<typeof CloseReviewResultSchema>;

export const MESSAGE_MAX = 20_000;

export const SendMessageRequestSchema = z.strictObject({
  id: ReviewIdSchema,
  text: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(MESSAGE_MAX, `A message is limited to ${MESSAGE_MAX} characters.`),
  /** Model for this and later turns; `null` = Claude Code's default. */
  model: z.string().trim().min(1).max(200).nullable(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const ipcContract = {
  "projects:list": { input: z.undefined(), output: z.array(ProjectSchema) },
  "projects:create": { input: CreateProjectRequestSchema, output: ProjectSchema },
  "projects:update": {
    input: z.strictObject({ id: ProjectIdSchema, patch: UpdateProjectRequestSchema }),
    output: ProjectSchema,
  },
  "projects:remove": { input: z.strictObject({ id: ProjectIdSchema }), output: z.null() },
  /** Local and remote branch names of a project, for autocomplete. */
  "projects:branches": {
    input: z.strictObject({ id: ProjectIdSchema }),
    output: z.array(z.string()),
  },
  /** Open reviews of all projects, newest first. */
  "reviews:list": { input: z.undefined(), output: z.array(ReviewSchema) },
  "reviews:create": { input: CreateReviewRequestSchema, output: ReviewSchema },
  "reviews:close": {
    input: z.strictObject({ id: ReviewIdSchema }),
    output: CloseReviewResultSchema,
  },
  /** The stored conversation of a review, oldest first. */
  "reviews:events": {
    input: z.strictObject({ id: ReviewIdSchema }),
    output: z.array(StoredEntrySchema),
  },
  /** Queues a turn; progress arrives as events. Fails with `review_busy` while a turn runs. */
  "reviews:send": { input: SendMessageRequestSchema, output: z.null() },
  /** Stops the running or queued turn of a review (no-op when idle). */
  "reviews:stop": { input: z.strictObject({ id: ReviewIdSchema }), output: z.null() },
  /** Models and slash commands for the composer (known after the first turn of any review). */
  "claude:catalog": { input: z.undefined(), output: ClaudeCatalogSchema },
  /** Opens the native folder picker; `null` when the user cancels. */
  "dialog:pickFolder": { input: z.undefined(), output: z.string().nullable() },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType }>;

// Fails to compile if the contract has a channel that `IPC_CHANNELS` (the preload allowlist) lacks.
type ContractChannel = keyof typeof ipcContract;
const _sameChannels: [ContractChannel] extends [IpcChannel] ? true : never = true;
void _sameChannels;

/** What the renderer passes (before parsing, e.g. untrimmed strings). */
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContract)[C]["input"]>;
/** What main's handler receives (after parsing). */
export type IpcParsedInput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]["input"]>;
export type IpcOutput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]["output"]>;

/**
 * The same contract, typed per channel. Indexing a mapped type with a generic channel keeps the
 * link between channel and schema, so generic code (`dispatch<C>`, `call<C>`) needs no casts.
 */
export type IpcSchemas = {
  [C in IpcChannel]: {
    input: z.ZodType<IpcParsedInput<C>, IpcInput<C>>;
    output: z.ZodType<IpcOutput<C>>;
  };
};
export const ipcSchemas: IpcSchemas = ipcContract;

/** The API the preload script exposes as `window.reviewroom`. */
export interface ReviewRoomBridge {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcResult<IpcOutput<C>>>;
  /** Subscribes to main-process events; returns the unsubscribe function. */
  onEvent(listener: (event: AppEvent) => void): () => void;
  /** `process.platform` of the main process, e.g. `darwin` (for the window chrome). */
  platform: string;
}
