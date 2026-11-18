import { useCallback, useState } from "react";
import { z } from "zod";

/** A side panel's width and whether it is collapsed, remembered per panel in this browser. */
export interface PanelState {
  width: number;
  collapsed: boolean;
}

export interface PanelLimits {
  initial: number;
  min: number;
  max: number;
}

const StoredSchema = z.object({ width: z.number().finite(), collapsed: z.boolean() });

const clamp = (width: number, limits: PanelLimits) =>
  Math.round(Math.min(limits.max, Math.max(limits.min, width)));

const storageKey = (key: string) => `problem.panel.${key}`;

export function loadPanel(key: string, limits: PanelLimits): PanelState {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    const parsed = StoredSchema.safeParse(raw === null ? undefined : JSON.parse(raw));
    if (parsed.success) return { ...parsed.data, width: clamp(parsed.data.width, limits) };
  } catch {
    // Not stored, or storage is unavailable: the defaults.
  }
  return { width: limits.initial, collapsed: false };
}

function savePanel(key: string, state: PanelState): void {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(state));
  } catch {
    // Not remembered.
  }
}

/** A collapsible, resizable panel whose state survives restarts. */
export function usePanel(key: string, limits: PanelLimits) {
  const [state, setState] = useState(() => loadPanel(key, limits));
  const { min, max } = limits;
  const update = useCallback(
    (change: Partial<PanelState>) =>
      setState((current) => {
        const next = { ...current, ...change };
        next.width = clamp(next.width, { initial: next.width, min, max });
        savePanel(key, next);
        return next;
      }),
    [key, min, max],
  );
  return {
    ...state,
    setWidth: (width: number) => update({ width }),
    setCollapsed: (collapsed: boolean) => update({ collapsed }),
  };
}
