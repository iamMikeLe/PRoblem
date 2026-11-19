import { type ByRoleOptions, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Finds an open Fluent dialog once it is ready to use.
 *
 * Fluent's focus manager (Tabster) hides every modal that is not active with `aria-hidden`, on a
 * 250 ms timer, and a dialog becomes active only when focus moves into it. Fluent moves focus in
 * on open, but on a slow machine Tabster's timers (the hide timer, and the 100 ms focus restore of
 * a dialog that just closed) can run around it, leaving the new dialog hidden with focus outside.
 * A user would be clicking inside the dialog; the test does the same by focusing it, which makes
 * Tabster activate it and unhide it. Then it waits until nothing hides it.
 */
export async function findDialog(name?: ByRoleOptions["name"]): Promise<HTMLElement> {
  const options = { hidden: true, ...(name === undefined ? {} : { name }) };
  const dialog = await screen.findByRole("dialog", options);
  await waitFor(
    () => {
      if (!dialog.contains(document.activeElement)) dialog.focus();
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(dialog.closest("[aria-hidden='true']")).toBeNull();
    },
    { timeout: 3000 },
  );
  return dialog;
}
