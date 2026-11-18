import { parseAppEvent } from "@problem/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { findingCountsKey, findingsKey } from "../findings/queries.ts";
import { reviewsKey } from "../reviews/queries.ts";
import { catalogKey } from "./queries.ts";
import { useConversationStore } from "./store.ts";

/**
 * Subscribes to main-process events for the lifetime of the app. `onShowReview`: the user clicked
 * a notification about a review.
 */
export function useAppEvents(onShowReview: (reviewId: string) => void): void {
  const receive = useConversationStore((state) => state.receive);
  const client = useQueryClient();
  // The latest callback, without resubscribing on every render.
  const showReview = useRef(onShowReview);
  showReview.current = onShowReview;
  useEffect(() => {
    const bridge = window.problem;
    if (!bridge) return;
    return bridge.onEvent((raw) => {
      // The preload already checks events; parse again so the store only sees valid ones.
      const event = parseAppEvent(raw);
      if (!event) return;
      receive(event);
      if (event.type === "app.showReview") showReview.current(event.reviewId);
      if (event.type === "review.session") void client.invalidateQueries({ queryKey: reviewsKey });
      if (event.type === "review.findings") {
        client.setQueryData(findingsKey(event.reviewId), event.findings);
        void client.invalidateQueries({ queryKey: findingCountsKey });
      }
      // Models and commands load during a turn; pick them up once one has ended.
      if (event.type === "review.entry" && event.entry.entry.kind === "turn-end") {
        void client.invalidateQueries({ queryKey: catalogKey });
      }
    });
  }, [receive, client]);
}
