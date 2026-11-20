import type { SaveBitbucketCredentials, UpdateSettingsRequest } from "@problem/shared";
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

const bitbucketKey = ["bitbucket"] as const;

/** Whether Bitbucket credentials are saved, and for which account (never the token). */
export function useBitbucketStatus() {
  return useQuery({ queryKey: bitbucketKey, queryFn: () => api.bitbucket.status() });
}

export function useSaveBitbucket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveBitbucketCredentials) => api.bitbucket.save(request),
    onSuccess: (status) => client.setQueryData(bitbucketKey, status),
  });
}

export function useRemoveBitbucket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.bitbucket.remove(),
    onSuccess: (status) => client.setQueryData(bitbucketKey, status),
  });
}

export function useTestBitbucket() {
  return useMutation({ mutationFn: () => api.bitbucket.test() });
}
