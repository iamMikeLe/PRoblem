import {
  type AppErrorCode,
  type AppEvent,
  type AppSettings,
  type ChangeSet,
  type ClaudeCatalog,
  DEFAULT_CHANGE_FILTERS,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_SETTINGS,
  type FileDiff,
  type Finding,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  type IpcResult,
  ipcContract,
  ipcSchemas,
  type PendingApproval,
  type PostPreview,
  type PostReviewRequest,
  type PrConversation,
  type ProblemBridge,
  type Project,
  type Review,
  type SearchResults,
  type StoredEntry,
  type UpdateCheck,
} from "@problem/shared";

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
    changeFilters: DEFAULT_CHANGE_FILTERS,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

const SHA = (c: string) => c.repeat(40);

/** A finding as the main process would return it, for seeding the stub. */
export function makeFinding(
  reviewId: string,
  number: number,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    reviewId,
    number,
    severity: "major",
    title: `Finding ${number}`,
    file: "src/app.ts",
    line: 10 * number,
    problem: `Problem of finding ${number}.`,
    suggestion: `Fix finding ${number}.`,
    reproduction: "",
    verdict: "open",
    changedSinceVerdict: false,
    withdrawnReason: null,
    postedUrl: null,
    createdAt: "2026-11-18T10:00:00.000Z",
    updatedAt: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

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
    workdir: `/home/me/.problem/worktrees/${project.id}/${id}`,
    isolated: true,
    prompt: project.reviewPrompt,
    status: "idle",
    sessionId: null,
    model: null,
    fixMode: false,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

interface StubError {
  code: AppErrorCode;
  message: string;
}

export interface StubState {
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
  approvals: PendingApproval[];
  /** Changed files by review id, and diffs by path. */
  changes: Record<string, ChangeSet>;
  diffs: Record<string, FileDiff>;
  /** What "check for new commits" answers; default: up to date. */
  updateCheck?: UpdateCheck | undefined;
  refreshError?: StubError | undefined;
  /** GitHub: the discussion and posting preview by review id; posted requests; opened links. */
  conversations: Record<string, PrConversation>;
  previews: Record<string, PostPreview>;
  posts: PostReviewRequest[];
  postError?: StubError | undefined;
  opened: string[];
  /** What `search:query` returns (whatever the text). */
  searchResults: SearchResults;
  /** Findings by review id. */
  findings: Record<string, Finding[]>;
  settings: AppSettings;
  editorError?: StubError | undefined;
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
 * Installs `window.problem` with an in-memory main process. Inputs are parsed with the
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
    findings: {},
    approvals: [],
    changes: {},
    diffs: {},
    conversations: {},
    previews: {},
    posts: [],
    opened: [],
    searchResults: { reviews: [], findings: [], files: [] },
    settings: DEFAULT_SETTINGS,
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
        const filtersOnly = patch.changeFilters;
        const index = projects.findIndex((p) => p.id === id);
        const current = projects[index];
        if (!current) return fail({ code: "project_not_found", message: "Project not found" });
        if (state.updateError) return fail(state.updateError);
        const updated: Project = {
          ...current,
          name: patch.name ?? current.name,
          reviewPrompt: patch.reviewPrompt ?? current.reviewPrompt,
          changeFilters: filtersOnly ?? current.changeFilters,
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
      case "reviews:checkUpdate": {
        const { id } = ipcContract[channel].input.parse(raw);
        const review = state.reviews.find((r) => r.id === id);
        if (!review) return fail({ code: "review_not_found", message: "Review not found" });
        return ok(
          state.updateCheck ?? {
            headSha: review.headSha,
            latestSha: review.headSha,
            newCommits: 0,
            commits: [],
            rewritten: false,
          },
        );
      }
      case "reviews:refresh": {
        const { id } = ipcContract[channel].input.parse(raw);
        if (state.refreshError) return fail(state.refreshError);
        const latest = state.updateCheck?.latestSha;
        state.reviews = state.reviews.map((r) =>
          r.id === id && latest ? { ...r, headSha: latest } : r,
        );
        state.updateCheck = undefined;
        const review = state.reviews.find((r) => r.id === id);
        return review
          ? ok(review)
          : fail({ code: "review_not_found", message: "Review not found" });
      }
      case "changes:files": {
        const { id } = ipcContract[channel].input.parse(raw);
        return ok(
          state.changes[id] ?? { fromSha: "c".repeat(40), toSha: "a".repeat(40), files: [] },
        );
      }
      case "changes:file": {
        const { path } = ipcContract[channel].input.parse(raw);
        const diff = state.diffs[path];
        return diff ? ok(diff) : fail({ code: "file_not_in_changes", message: "Not changed" });
      }
      case "github:conversation": {
        const { id } = ipcContract[channel].input.parse(raw);
        return ok(state.conversations[id] ?? { status: "none", reason: "No pull request." });
      }
      case "github:preview": {
        const { id } = ipcContract[channel].input.parse(raw);
        return ok(state.previews[id] ?? { status: "none", reason: "No pull request." });
      }
      case "github:post": {
        const request = ipcContract[channel].input.parse(raw);
        if (state.postError) return fail(state.postError);
        state.posts.push(request);
        return ok({ url: "https://github.com/acme/payments/pull/7#pullrequestreview-1" });
      }
      case "github:open": {
        const { url } = ipcContract[channel].input.parse(raw);
        state.opened.push(url);
        return ok(null);
      }
      case "reviews:setFixMode": {
        const { id, fixMode } = ipcContract[channel].input.parse(raw);
        const current = state.reviews.find((r) => r.id === id);
        if (!current) return fail({ code: "review_not_found", message: "Review not found" });
        const updated = { ...current, fixMode };
        state.reviews = state.reviews.map((r) => (r.id === id ? updated : r));
        return ok(updated);
      }
      case "approvals:list":
        return ok(state.approvals);
      case "approvals:decide": {
        const { id } = ipcContract[channel].input.parse(raw);
        if (!state.approvals.some((a) => a.id === id)) {
          return fail({
            code: "approval_not_found",
            message: "This request was already answered or has ended.",
          });
        }
        state.approvals = state.approvals.filter((a) => a.id !== id);
        return ok(null);
      }
      case "findings:list": {
        const { id } = ipcContract[channel].input.parse(raw);
        return ok(state.findings[id] ?? []);
      }
      case "search:query":
        return ok(state.searchResults);
      case "findings:counts": {
        const counts = Object.entries(state.findings).map(([id, list]) => {
          const open = list.filter((f) => f.verdict === "open" && f.withdrawnReason === null);
          return [
            id,
            { open: open.length, blockers: open.filter((f) => f.severity === "blocker").length },
          ];
        });
        return ok(Object.fromEntries(counts));
      }
      case "findings:setVerdict": {
        const { id, number, verdict } = ipcContract[channel].input.parse(raw);
        const list = state.findings[id] ?? [];
        const current = list.find((f) => f.number === number);
        if (!current) return fail({ code: "finding_not_found", message: "Finding not found" });
        const updated = { ...current, verdict, changedSinceVerdict: false };
        state.findings[id] = list.map((f) => (f.number === number ? updated : f));
        return ok(updated);
      }
      case "settings:get":
        return ok(state.settings);
      case "settings:update":
        state.settings = ipcContract[channel].input.parse(raw);
        return ok(state.settings);
      case "editor:open":
        ipcContract[channel].input.parse(raw);
        return state.editorError ? fail(state.editorError) : ok(null);
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

  const bridge: ProblemBridge = {
    invoke,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    platform: "darwin",
  };
  Object.defineProperty(window, "problem", { value: bridge, configurable: true });
  return state;
}

export function removeBridge(): void {
  Reflect.deleteProperty(window, "problem");
}
