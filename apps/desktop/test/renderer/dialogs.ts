import { type ByRoleOptions, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

type DialogRole = "dialog" | "alertdialog";

/** Controls a user can focus, without Tabster's invisible focus-trap helpers. */
const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex='0']:not([data-tabster-dummy])";

/**
 * Finds an open Fluent dialog once it is ready to use.
 *
 * Fluent's focus manager (Tabster) hides every modal that is not active with `aria-hidden`, on a
 * 250 ms timer. A modal becomes active only when focus lands on a control inside it (not on the
 * dialog surface itself). Fluent moves focus in on open, but on a slow machine Tabster's timers
 * (the hide timer, the focus restore of a dialog that just closed) can run around it, leaving the
 * new dialog inactive and hidden. A user would click into the dialog; the test focuses its first
 * control the same way, which makes Tabster activate and unhide it.
 */
export async function findDialog(
  name?: ByRoleOptions["name"],
  role: DialogRole = "dialog",
): Promise<HTMLElement> {
  const options = { hidden: true, ...(name === undefined ? {} : { name }) };
  const dialog = await screen.findByRole(role, options);
  await waitFor(
    () => {
      const active = document.activeElement;
      if (active === dialog || !dialog.contains(active)) {
        dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      }
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(dialog.closest("[aria-hidden='true']")).toBeNull();
    },
    { timeout: 3000 },
  );
  return dialog;
}

/**
 * Waits until no dialog is left and the rest of the app is shown again. Tabster unhides the app
 * behind a closed modal on its 250 ms timer, so a button outside the dialog can stay hidden for a
 * moment after the dialog is gone. Its own invisible focus helpers stay hidden on purpose.
 */
export async function dialogClosed(role: DialogRole = "dialog"): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByRole(role, { hidden: true })).toBeNull();
      expect(
        document.querySelector("body > [aria-hidden='true']:not([data-tabster-dummy])"),
      ).toBeNull();
    },
    { timeout: 3000 },
  );
}
