import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

export function useServerHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
}
