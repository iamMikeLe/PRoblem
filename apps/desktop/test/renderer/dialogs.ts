import { type ByRoleOptions, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Finds an open Fluent dialog once it is ready to use. Fluent's focus manager (Tabster) hides
 * every modal that is not active with `aria-hidden`, on a 250 ms timer, and a dialog becomes
 * active only when focus moves into it. On a slow machine the timer can run first, so a dialog
 * that was just found can turn hidden for a moment and role queries inside it fail. Waiting until
 * focus is inside and the dialog is not hidden avoids that.
 */
export async function findDialog(name?: ByRoleOptions["name"]): Promise<HTMLElement> {
  const options = { hidden: true, ...(name === undefined ? {} : { name }) };
  const dialog = await screen.findByRole("dialog", options);
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.closest("[aria-hidden='true']")).toBeNull();
  });
  return dialog;
}
