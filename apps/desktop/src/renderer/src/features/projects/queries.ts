import type { CreateProjectRequest, Project, UpdateProjectRequest } from "@problem/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const projectsKey = ["projects"] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: (): Promise<Project[]> => api.projects.list(),
  });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectRequest) => api.projects.create(body),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useUpdateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProjectRequest }) =>
      api.projects.update(id, body),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.projects.remove(id),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsKey }),
  });
}
