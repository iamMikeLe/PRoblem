import type { ProjectService } from "../projects/service.ts";
import type { IpcHandlers } from "./dispatcher.ts";

export interface HandlerDeps {
  projects: ProjectService;
  /** Shows the native folder picker; resolves with the chosen folder or `null`. */
  pickFolder: () => Promise<string | null>;
}

/** Binds every IPC channel to the use case that implements it. */
export function createHandlers({ projects, pickFolder }: HandlerDeps): IpcHandlers {
  return {
    "projects:list": () => projects.list(),
    "projects:create": (input) => projects.create(input),
    "projects:update": ({ id, patch }) => projects.update(id, patch),
    "projects:remove": ({ id }) => {
      projects.remove(id);
      return null;
    },
    "dialog:pickFolder": () => pickFolder(),
  };
}
