import type { SessionService } from "../claude/sessions.ts";
import type { ProjectService } from "../projects/service.ts";
import type { ReviewService } from "../reviews/service.ts";
import type { IpcHandlers } from "./dispatcher.ts";

export interface HandlerDeps {
  projects: ProjectService;
  reviews: ReviewService;
  sessions: SessionService;
  /** Shows the native folder picker; resolves with the chosen folder or `null`. */
  pickFolder: () => Promise<string | null>;
}

/** Binds every IPC channel to the use case that implements it. */
export function createHandlers({
  projects,
  reviews,
  sessions,
  pickFolder,
}: HandlerDeps): IpcHandlers {
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
    "reviews:create": async (input) => {
      const review = await reviews.create(input);
      // Claude starts reviewing right away; the returned review shows it as queued or running.
      sessions.start(review);
      return reviews.get(review.id);
    },
    "reviews:close": async ({ id }) => {
      // Stop Claude first, so nothing runs in the folder while it is removed or switched back.
      await sessions.cancel(id);
      return reviews.close(id);
    },
    "reviews:events": ({ id }) => {
      reviews.get(id);
      return sessions.entries(id);
    },
    "reviews:send": (input) => {
      sessions.send(input);
      return null;
    },
    "reviews:stop": async ({ id }) => {
      await sessions.stop(id);
      return null;
    },
    "claude:catalog": () => sessions.catalog(),
    "dialog:pickFolder": () => pickFolder(),
  };
}
