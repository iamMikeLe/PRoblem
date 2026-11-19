import { useEffect, useRef } from "react";

/**
 * Keys to actions, e.g. `{ j: next, "alt+ArrowDown": nextReview, "mod+b": toggle }`.
 * `mod` is ⌘ on macOS and Ctrl elsewhere; Shift is ignored, so "?" works on any layout.
 */
export type Bindings = Readonly<Record<string, () => void>>;

export const MOD_LABEL = window.problem?.platform === "darwin" ? "⌘" : "Ctrl+";

/** The combo a key press spells, in the form the bindings use. */
export function comboOf(event: KeyboardEvent): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return `${event.metaKey || event.ctrlKey ? "mod+" : ""}${event.altKey ? "alt+" : ""}${key}`;
}

/** Typing in a field, or working in a dialog: keys belong to that, not to the app. */
function isBusyElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [role='dialog'], [role='alertdialog']") !== null
  );
}

/**
 * Window-wide shortcuts while the calling component is mounted. Only `mod+` combos work while
 * typing; the rest (plain letters, Alt+arrows) would otherwise take keys from a text field.
 */
export function useShortcuts(bindings: Bindings): void {
  const current = useRef(bindings);
  current.current = bindings;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const combo = comboOf(event);
      const action = current.current[combo];
      if (!action) return;
      if (!combo.startsWith("mod+") && isBusyElement(event.target)) return;
      event.preventDefault();
      action();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
