import {
  type AppSettings,
  type ChangeSet,
  type ClaudeCatalog,
  type CloseReviewResult,
  type CreateProjectRequest,
  type CreateReviewRequest,
  type DecideApprovalRequest,
  type FileDiff,
  type Finding,
  type FindingCounts,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  ipcSchemas,
  type OpenInEditorRequest,
  type PendingApproval,
  type ProblemBridge,
  type Project,
  type Review,
  type SendMessageRequest,
  type SetVerdictRequest,
  type StoredEntry,
  type UpdateCheck,
  type UpdateProjectRequest,
  type UpdateSettingsRequest,
} from "@problem/shared";

/** A failed call to the main process, with the contract's error code. */
export class AppRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppRequestError";
    this.code = code;
  }
}

function bridge(): ProblemBridge {
  const value = window.problem;
  if (!value) throw new AppRequestError("no_bridge", "PRoblem must run inside its desktop app");
  return value;
}

/**
 * Invokes a channel and validates the answer against the contract's output schema, so the UI
 * only ever sees data of the declared shape.
 */
async function call<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
  const result = await bridge().invoke(channel, input);
  if (!result.ok) throw new AppRequestError(result.error.code, result.error.message);
  const parsed = ipcSchemas[channel].output.safeParse(result.data);
  if (!parsed.success) {
    throw new AppRequestError("invalid_response", "Unexpected response from the app");
  }
  return parsed.data;
}

export const api = {
  projects: {
    list: (): Promise<Project[]> => call("projects:list", undefined),
    create: (body: CreateProjectRequest): Promise<Project> => call("projects:create", body),
    update: (id: string, patch: UpdateProjectRequest): Promise<Project> =>
      call("projects:update", { id, patch }),
    remove: async (id: string): Promise<void> => {
      await call("projects:remove", { id });
    },
    branches: (id: string): Promise<string[]> => call("projects:branches", { id }),
  },
  reviews: {
    list: (): Promise<Review[]> => call("reviews:list", undefined),
    create: (body: CreateReviewRequest): Promise<Review> => call("reviews:create", body),
    close: (id: string): Promise<CloseReviewResult> => call("reviews:close", { id }),
    events: (id: string): Promise<StoredEntry[]> => call("reviews:events", { id }),
    send: async (request: SendMessageRequest): Promise<void> => {
      await call("reviews:send", request);
    },
    stop: async (id: string): Promise<void> => {
      await call("reviews:stop", { id });
    },
    checkUpdate: (id: string): Promise<UpdateCheck> => call("reviews:checkUpdate", { id }),
    refresh: (id: string): Promise<Review> => call("reviews:refresh", { id }),
    setFixMode: (id: string, fixMode: boolean): Promise<Review> =>
      call("reviews:setFixMode", { id, fixMode }),
  },
  claude: {
    catalog: (): Promise<ClaudeCatalog> => call("claude:catalog", undefined),
  },
  changes: {
    files: (id: string): Promise<ChangeSet> => call("changes:files", { id }),
    file: (id: string, path: string): Promise<FileDiff> => call("changes:file", { id, path }),
  },
  approvals: {
    list: (): Promise<PendingApproval[]> => call("approvals:list", undefined),
    decide: async (request: DecideApprovalRequest): Promise<void> => {
      await call("approvals:decide", request);
    },
  },
  findings: {
    list: (id: string): Promise<Finding[]> => call("findings:list", { id }),
    counts: (): Promise<Record<string, FindingCounts>> => call("findings:counts", undefined),
    setVerdict: (request: SetVerdictRequest): Promise<Finding> =>
      call("findings:setVerdict", request),
  },
  settings: {
    get: (): Promise<AppSettings> => call("settings:get", undefined),
    update: (request: UpdateSettingsRequest): Promise<AppSettings> =>
      call("settings:update", request),
  },
  editor: {
    open: async (request: OpenInEditorRequest): Promise<void> => {
      await call("editor:open", request);
    },
  },
  dialog: {
    pickFolder: (): Promise<string | null> => call("dialog:pickFolder", undefined),
  },
};
