import type { DatabaseSync } from "node:sqlite";
import type {
  ActivityDetail,
  ActivityItem,
  ActivityKind,
  AppEvent,
  MarkActivityReadRequest,
} from "@problem/shared";
import type { Logger } from "../errors.ts";
import {
  insertActivity,
  lastActivity,
  listActivity,
  markActivityRead,
  markKindRead,
} from "./repository.ts";

/**
 * The Activity feed (ADR 0015). Services record what happened in a review; the renderer lists
 * it and is told with `activity.changed` whenever it changes.
 */
export interface ActivityService {
  list(): ActivityItem[];
  markRead(request: MarkActivityReadRequest): void;
  /** Adds a row. Never throws: the feed must not break the work it reports on. */
  record(reviewId: string, detail: ActivityDetail): void;
  /** Marks a review's unread rows of a kind as read (its approvals were answered). */
  resolve(reviewId: string, kind: ActivityKind): void;
  /** The newest row of a kind for a review, with its time; `undefined` also when it cannot be read. */
  last<K extends ActivityKind>(
    reviewId: string,
    kind: K,
  ): { detail: Extract<ActivityDetail, { kind: K }>; at: string } | undefined;
}

export interface ActivityServiceDeps {
  db: DatabaseSync;
  broadcast: (event: AppEvent) => void;
  log: Logger;
  now?: () => Date;
}

export function createActivityService({
  db,
  broadcast,
  log,
  now,
}: ActivityServiceDeps): ActivityService {
  const clock = now ?? (() => new Date());
  const changed = () => broadcast({ type: "activity.changed" });

  return {
    list: () => listActivity(db),
    markRead({ ids }) {
      if (markActivityRead(db, ids, clock()) > 0) changed();
    },
    record(reviewId, detail) {
      try {
        insertActivity(db, reviewId, detail, clock());
        changed();
      } catch (error) {
        log.error("could not record activity", { review: reviewId, kind: detail.kind, error });
      }
    },
    resolve(reviewId, kind) {
      try {
        if (markKindRead(db, reviewId, kind, clock()) > 0) changed();
      } catch (error) {
        log.error("could not update activity", { review: reviewId, kind, error });
      }
    },
    last(reviewId, kind) {
      try {
        return lastActivity(db, reviewId, kind);
      } catch (error) {
        log.error("could not read activity", { review: reviewId, kind, error });
        return undefined;
      }
    },
  };
}
