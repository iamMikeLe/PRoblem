import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dialogClosed, findDialog } from "../dialogs.ts";
import { renderApp } from "../renderApp.tsx";
import { makeFinding, makeProject, makeReview, removeBridge, stubBridge } from "../stubBridge.ts";

const payments = makeProject("p1", "payments-api");
const web = makeProject("p2", "web");

const press = (key: string, options: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...options });

const selectedTab = () =>
  screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");

describe("keyboard shortcuts", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("moves between reviews in list order with Alt+arrows, and hides the list with Mod+B", async () => {
    stubBridge(
      [payments, web],
      [makeReview("r1", payments), makeReview("r2", web), makeReview("r3", payments)],
    );
    renderApp();
    expect(await screen.findByRole("heading", { name: "feature/r1" })).toBeTruthy();

    // The list shows payments-api (r1, r3) before web (r2).
    press("ArrowDown", { altKey: true });
    expect(await screen.findByRole("heading", { name: "feature/r3" })).toBeTruthy();
    press("ArrowDown", { altKey: true });
    expect(await screen.findByRole("heading", { name: "feature/r2" })).toBeTruthy();
    press("ArrowDown", { altKey: true });
    expect(screen.getByRole("heading", { name: "feature/r2" })).toBeTruthy();
    press("ArrowUp", { altKey: true });
    expect(await screen.findByRole("heading", { name: "feature/r3" })).toBeTruthy();

    press("b", { ctrlKey: true });
    expect(await screen.findByRole("button", { name: "Show reviews" })).toBeTruthy();
    press("b", { metaKey: true });
    expect(await screen.findByRole("button", { name: "Hide reviews" })).toBeTruthy();
  });

  it("switches tabs with digits, walks findings with J/K and focuses the message box with R", async () => {
    const api = stubBridge([payments], [makeReview("r1", payments)]);
    api.findings.r1 = [
      makeFinding("r1", 1, { severity: "minor", title: "Unclear name" }),
      makeFinding("r1", 2, { severity: "blocker", title: "Retries never stop" }),
    ];
    renderApp();
    await screen.findByRole("heading", { name: "feature/r1" });

    press("2");
    await waitFor(() => expect(selectedTab()?.textContent).toContain("Findings"));
    await screen.findByRole("grid", { name: "Findings" });
    press("j");
    expect(await screen.findByRole("region", { name: "Finding #2" })).toBeTruthy();
    press("j");
    expect(await screen.findByRole("region", { name: "Finding #1" })).toBeTruthy();
    press("k");
    expect(await screen.findByRole("region", { name: "Finding #2" })).toBeTruthy();

    press("r");
    await waitFor(() => expect(selectedTab()?.textContent).toBe("Conversation"));
    const box = await screen.findByRole("textbox", { name: /message/i });
    await waitFor(() => expect(document.activeElement).toBe(box));

    // While typing, letters and digits are text, not shortcuts.
    press("3");
    press("?");
    expect(selectedTab()?.textContent).toBe("Conversation");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("lists the shortcuts on ? and from the title bar", async () => {
    stubBridge([payments], [makeReview("r1", payments)]);
    renderApp();
    await screen.findByRole("heading", { name: "feature/r1" });
    press("?", { shiftKey: true });
    const dialog = await findDialog("Keyboard shortcuts");
    expect(within(dialog).getByText("Next or previous review")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await dialogClosed();

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts (?)" }));
    expect(await findDialog("Keyboard shortcuts")).toBeTruthy();
  });
});
