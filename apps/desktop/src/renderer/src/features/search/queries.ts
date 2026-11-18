import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

/** How long typing pauses before a search runs. */
export const SEARCH_DELAY_MS = 150;

/** `value`, once it has stopped changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Search across open reviews; keeps the last results on screen while the next ones load. */
export function useSearch(text: string) {
  const settled = useDebounced(text.trim(), SEARCH_DELAY_MS);
  return useQuery({
    queryKey: ["search", settled],
    queryFn: () => api.search.query(settled),
    enabled: settled !== "",
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: false,
  });
}
