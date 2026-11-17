import type { ProjectService } from "../projects/service.ts";
import type { ReviewService } from "../reviews/service.ts";
import type { IpcHandlers } from "./dispatcher.ts";

export interface HandlerDeps {
  projects: ProjectService;
  reviews: ReviewService;
  /** Shows the native folder picker; resolves with the chosen folder or `null`. */
  pickFolder: () => Promise<string | null>;
}

/** Binds every IPC channel to the use case that implements it. */
export function createHandlers({ projects, reviews, pickFolder }: HandlerDeps): IpcHandlers {
  return {
    "projects:list": () => projects.list(),
    "projects:create": (input) => projects.create(input),
    "projects:update": ({ id, patch }) => projects.update(id, patch),
    "projects:remove": ({ id }) => {
      projects.remove(id);
      return null;
    },
    "projects:branches": ({ id }) => reviews.branches(id),
    "reviews:list": () => reviews.list(),
    "reviews:create": (input) => reviews.create(input),
    "reviews:close": ({ id }) => reviews.close(id),
    "dialog:pickFolder": () => pickFolder(),
  };
}
