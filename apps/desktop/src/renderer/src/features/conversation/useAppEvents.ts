import { parseAppEvent } from "@reviewroom/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { reviewsKey } from "../reviews/queries.ts";
import { catalogKey } from "./queries.ts";
import { useConversationStore } from "./store.ts";

/** Subscribes to main-process events for the lifetime of the app. */
export function useAppEvents(): void {
  const receive = useConversationStore((state) => state.receive);
  const client = useQueryClient();
  useEffect(() => {
    const bridge = window.reviewroom;
    if (!bridge) return;
    return bridge.onEvent((raw) => {
      // The preload already checks events; parse again so the store only sees valid ones.
      const event = parseAppEvent(raw);
      if (!event) return;
      receive(event);
      if (event.type === "review.session") void client.invalidateQueries({ queryKey: reviewsKey });
      // Models and commands load during a turn; pick them up once one has ended.
      if (event.type === "review.entry" && event.entry.entry.kind === "turn-end") {
        void client.invalidateQueries({ queryKey: catalogKey });
      }
    });
  }, [receive, client]);
}
