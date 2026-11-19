import type { ActivityItem } from "@problem/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const activityKey = ["activity"] as const;

/** The Activity feed; `activity.changed` events load it again (see `useAppEvents`). */
export function useActivity() {
  return useQuery({ queryKey: activityKey, queryFn: () => api.activity.list() });
}

/** Unread rows, for the badge on the rail. */
export function useUnreadActivity(): number {
  const activity = useActivity();
  return activity.data?.filter((item) => !item.read).length ?? 0;
}

/** Marks rows as read (all when `ids` is omitted), at once in the list. */
export function useMarkActivityRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids?: readonly string[]) => api.activity.markRead(ids),
    onMutate: (ids) => {
      client.setQueryData<ActivityItem[]>(activityKey, (list) =>
        list?.map((item) =>
          ids === undefined || ids.includes(item.id) ? { ...item, read: true } : item,
        ),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: activityKey }),
  });
}
