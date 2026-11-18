import type { UpdateSettingsRequest } from "@reviewroom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const settingsKey = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: () => api.settings.get() });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateSettingsRequest) => api.settings.update(request),
    onSuccess: (settings) => client.setQueryData(settingsKey, settings),
  });
}
