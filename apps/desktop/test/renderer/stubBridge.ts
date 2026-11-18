import {
  type AppErrorCode,
  type AppEvent,
  type ClaudeCatalog,
  DEFAULT_REVIEW_PROMPT,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  type IpcResult,
  ipcContract,
  ipcSchemas,
  type Project,
  type Review,
  type ReviewRoomBridge,
  type StoredEntry,
} from "@reviewroom/shared";

export interface StubCall {
  channel: IpcChannel;
  input: unknown;
}

/** A project as the main process would return it, for seeding the stub. */
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

const SHA = (c: string) => c.repeat(40);

/** A review as the main process would return it, for seeding the stub. */
export function makeReview(id: string, project: Project, overrides: Partial<Review> = {}): Review {
  return {
    id,
    projectId: project.id,
    title: `feature/${id}`,
    source: { kind: "branch", branch: `feature/${id}` },
    headBranch: `feature/${id}`,
    headSha: SHA("a"),
    baseBranch: "main",
    baseSha: SHA("b"),
    mergeBaseSha: SHA("c"),
    workdir: `/home/me/.reviewroom/worktrees/${project.id}/${id}`,
    isolated: true,
    prompt: project.reviewPrompt,
    status: "idle",
    sessionId: null,
    model: null,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

interface StubError {
  code: AppErrorCode;
  message: string;
}

interface StubState {
  projects: Project[];
  reviews: Review[];
  branches: string[];
  /** Note returned when a review is closed. */
  closeNote: string | null;
  createReviewError?: StubError | undefined;
  closeReviewError?: StubError | undefined;
  calls: StubCall[];
  /** Stored conversations by review id. */
  entries: Record<string, StoredEntry[]>;
  catalog: ClaudeCatalog;
  sendError?: StubError | undefined;
  /** What the native folder picker "chooses"; `null` = the user cancels. */
  pickedFolder: string | null;
  /** When set, the matching call fails with this error. */
  listError?: StubError | undefined;
  createError?: StubError | undefined;
  updateError?: StubError | undefined;
  deleteError?: StubError | undefined;
  /** Pushes an event to the renderer, as the main process would. */
  emit(event: AppEvent): void;
}

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data });
const fail = (error: StubError): IpcResult<never> => ({ ok: false, error });

/**
 * Installs `window.reviewroom` with an in-memory main process. Inputs are parsed with the
 * shared contract, so a test also fails when the UI sends something main would reject.
 * Remove it in `afterEach` with `removeBridge()`.
 */
export function stubBridge(initial: Project[] = [], reviews: Review[] = []): StubState {
  const listeners = new Set<(event: AppEvent) => void>();
  let nextId = 1;
  const state: StubState = {
    projects: [...initial],
    reviews: [...reviews],
    branches: ["feature/login", "main", "release/1.0"],
    closeNote: null,
    calls: [],
    entries: {},
    catalog: {
      models: [
        { value: "opus", displayName: "Opus", description: "Most capable" },
        { value: "haiku", displayName: "Haiku", description: "Fastest" },
      ],
      commands: [
        {
          name: "security-review",
          description: "Security review of the changes",
          argumentHint: "",
        },
        { name: "simplify", description: "Simplify the code", argumentHint: "" },
      ],
    },
    pickedFolder: null,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };

  async function handle(channel: IpcChannel, raw: unknown): Promise<IpcResult<unknown>> {
    state.calls.push({ channel, input: raw });
    const { projects } = state;
    switch (channel) {
      case "projects:list":
        return state.listError ? fail(state.listError) : ok([...projects]);
      case "projects:create": {
        if (state.createError) return fail(state.createError);
        const { path, name } = ipcContract[channel].input.parse(raw);
        const project = makeProject(`new-${nextId++}`, name ?? path.split("/").at(-1) ?? path, {
          path,
        });
        projects.push(project);
        return ok(project);
      }
      case "projects:update": {
        const { id, patch } = ipcContract[channel].input.parse(raw);
        const index = projects.findIndex((p) => p.id === id);
        const current = projects[index];
        if (!current) return fail({ code: "project_not_found", message: "Project not found" });
        if (state.updateError) return fail(state.updateError);
        const updated: Project = {
          ...current,
          name: patch.name ?? current.name,
          reviewPrompt: patch.reviewPrompt ?? current.reviewPrompt,
        };
        projects[index] = updated;
        return ok(updated);
      }
      case "projects:remove": {
        const { id } = ipcContract[channel].input.parse(raw);
        const index = projects.findIndex((p) => p.id === id);
        if (index < 0) return fail({ code: "project_not_found", message: "Project not found" });
        if (state.deleteError) return fail(state.deleteError);
        projects.splice(index, 1);
        return ok(null);
      }
      case "dialog:pickFolder":
        return ok(state.pickedFolder);
      case "projects:branches":
        return ok(state.branches);
      case "reviews:list":
        return ok([...state.reviews]);
      case "reviews:create": {
        if (state.createReviewError) return fail(state.createReviewError);
        const input = ipcContract[channel].input.parse(raw);
        const project = projects.find((p) => p.id === input.projectId);
        if (!project) return fail({ code: "project_not_found", message: "Project not found" });
        const review = makeReview(`r${nextId++}`, project, {
          title: input.source,
          headBranch: input.source,
          source: { kind: "branch", branch: input.source },
          baseBranch: input.base ?? "main",
          isolated: input.isolated,
          prompt: input.prompt,
          createdAt: new Date().toISOString(),
        });
        state.reviews.unshift(review);
        return ok(review);
      }
      case "reviews:close": {
        const { id } = ipcContract[channel].input.parse(raw);
        const index = state.reviews.findIndex((r) => r.id === id);
        if (index < 0) return fail({ code: "review_not_found", message: "Review not found" });
        if (state.closeReviewError) return fail(state.closeReviewError);
        state.reviews.splice(index, 1);
        return ok({ note: state.closeNote });
      }
      case "reviews:events": {
        const { id } = ipcContract[channel].input.parse(raw);
        return ok(state.entries[id] ?? []);
      }
      case "reviews:send": {
        const { id, model } = ipcContract[channel].input.parse(raw);
        if (state.sendError) return fail(state.sendError);
        state.reviews = state.reviews.map((r) => (r.id === id ? { ...r, model } : r));
        return ok(null);
      }
      case "reviews:stop":
        ipcContract[channel].input.parse(raw);
        return ok(null);
      case "claude:catalog":
        return ok(state.catalog);
    }
  }

  /** Checks the stub's own answers against the contract, like a typed main process would. */
  async function invoke<C extends IpcChannel>(
    channel: C,
    input: IpcInput<C>,
  ): Promise<IpcResult<IpcOutput<C>>> {
    const result = await handle(channel, input);
    return result.ok ? { ok: true, data: ipcSchemas[channel].output.parse(result.data) } : result;
  }

  const bridge: ReviewRoomBridge = {
    invoke,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    platform: "darwin",
  };
  Object.defineProperty(window, "reviewroom", { value: bridge, configurable: true });
  return state;
}

export function removeBridge(): void {
  Reflect.deleteProperty(window, "reviewroom");
}
