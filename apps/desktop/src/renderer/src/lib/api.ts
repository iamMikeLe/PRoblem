import {
  type ClaudeCatalog,
  type CloseReviewResult,
  type CreateProjectRequest,
  type CreateReviewRequest,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  ipcSchemas,
  type Project,
  type Review,
  type ReviewRoomBridge,
  type SendMessageRequest,
  type StoredEntry,
  type UpdateProjectRequest,
} from "@reviewroom/shared";

/** A failed call to the main process, with the contract's error code. */
export class AppRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppRequestError";
    this.code = code;
  }
}

function bridge(): ReviewRoomBridge {
  const value = window.reviewroom;
  if (!value) throw new AppRequestError("no_bridge", "ReviewRoom must run inside its desktop app");
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
  },
  claude: {
    catalog: (): Promise<ClaudeCatalog> => call("claude:catalog", undefined),
  },
  dialog: {
    pickFolder: (): Promise<string | null> => call("dialog:pickFolder", undefined),
  },
};
