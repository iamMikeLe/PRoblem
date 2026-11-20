import type { AppSettings, UpdateSettingsRequest } from "@problem/shared";
import type { ActivityService } from "../activity/service.ts";
import type { ChangesService } from "../changes/service.ts";
import type { SessionService } from "../claude/sessions.ts";
import type { EditorOpener } from "../editor/open.ts";
import { AppFailure, type Logger } from "../errors.ts";
import type { FindingsService } from "../findings/service.ts";
import type { ProjectService } from "../projects/service.ts";
import type { GitHost } from "../pullrequests/host.ts";
import type { PullRequestService } from "../pullrequests/service.ts";
import type { ReviewService } from "../reviews/service.ts";
import type { SearchService } from "../search/service.ts";
import type { IpcHandlers } from "./dispatcher.ts";

export interface HandlerDeps {
  projects: ProjectService;
  reviews: ReviewService;
  sessions: SessionService;
  findings: FindingsService;
  changes: ChangesService;
  pullRequests: PullRequestService;
  /** The supported git hosts: their websites are the links `pr:open` may open. */
  hosts: readonly GitHost[];
  search: SearchService;
  activity: ActivityService;
  log: Logger;
  /** Opens a URL in the user's browser (already checked to be a pull request host link). */
  openExternal: (url: string) => Promise<void>;
  settings: { get(): AppSettings; update(request: UpdateSettingsRequest): AppSettings };
  editor: EditorOpener;
  /** Shows the native folder picker; resolves with the chosen folder or `null`. */
  pickFolder: () => Promise<string | null>;
}

/** Binds every IPC channel to the use case that implements it. */
export function createHandlers({
  projects,
  reviews,
  sessions,
  findings,
  changes,
  pullRequests,
  hosts,
  search,
  activity,
  log,
  openExternal,
  settings,
  editor,
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
      // Claude starts reviewing right away, knowing what reviewers already said on the PR.
      sessions.start(review, await pullRequests.firstDigest(review));
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
    "reviews:checkUpdate": ({ id }) => reviews.checkUpdate(id),
    // The folder must not move under Claude's feet: no turn runs or starts during a refresh.
    "reviews:refresh": ({ id }) => sessions.withoutTurns(id, () => reviews.refresh(id)),
    "changes:files": ({ id }) => changes.files(id),
    "search:query": ({ text }) => search.query(text),
    "app:reportError": (report) => {
      log.error("renderer error", report);
      return null;
    },
    "pr:conversation": ({ id }) => pullRequests.conversation(id),
    "pr:preview": ({ id }) => pullRequests.preview(id),
    "pr:post": (input) => pullRequests.post(input),
    "pr:open": async ({ url }) => {
      if (!hosts.some((host) => host.isWebUrl(url)))
        throw new AppFailure("invalid_url", "Only pull request host links can be opened");
      await openExternal(url);
      return null;
    },
    "changes:file": ({ id, path }) => changes.file(id, path),
    "reviews:setFixMode": ({ id, fixMode }) => sessions.setFixMode(id, fixMode),
    "approvals:list": () => sessions.approvals(),
    "approvals:decide": (input) => {
      sessions.decide(input);
      return null;
    },
    "reviews:stop": async ({ id }) => {
      await sessions.stop(id);
      return null;
    },
    "claude:catalog": () => sessions.catalog(),
    "findings:list": ({ id }) => findings.list(id),
    "findings:counts": () => findings.counts(),
    "findings:setVerdict": (input) => findings.setVerdict(input),
    "settings:get": () => settings.get(),
    "settings:update": (input) => settings.update(input),
    "editor:open": async (input) => {
      await editor.open(input);
      return null;
    },
    "dialog:pickFolder": () => pickFolder(),
    "activity:list": () => activity.list(),
    "activity:markRead": (input) => {
      activity.markRead(input);
      return null;
    },
  };
}
