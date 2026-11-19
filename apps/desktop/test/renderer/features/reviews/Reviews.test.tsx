import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDialog } from "../../dialogs.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, makeReview, removeBridge, stubBridge } from "../../stubBridge.ts";

/** Opens the dialog from the list header, once projects have loaded and enabled it. */
async function openNewReview() {
  renderApp();
  const list = await screen.findByRole("complementary", { name: "Reviews" });
  const header = within(list).getAllByRole("button", { name: "New review" })[0];
  if (!header) throw new Error("no New review button");
  await waitFor(() => expect(header.hasAttribute("disabled")).toBe(false));
  fireEvent.click(header);
  return findDialog();
}

const sourceBox = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: /Branch or pull request/ });

describe("Reviews", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("starts a review with the project's prompt and selects it", async () => {
    const project = makeProject("p1", "payments-api", { reviewPrompt: "Find bugs." });
    const api = stubBridge([project]);
    const dialog = await openNewReview();

    const start = within(dialog).getByRole("button", { name: "Start review" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByRole("textbox", { name: /Review prompt/ })).toHaveProperty(
      "value",
      "Find bugs.",
    );

    fireEvent.change(sourceBox(dialog), { target: { value: " feature/login " } });
    fireEvent.click(start);

    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { name: "feature/login" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls).toContainEqual({
      channel: "reviews:create",
      input: { projectId: "p1", source: "feature/login", isolated: true, prompt: "Find bugs." },
    });
  });

  it("sends an explicit base and remembers in-place mode per project", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    const dialog = await openNewReview();
    fireEvent.change(sourceBox(dialog), { target: { value: "feature/login" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /Base branch/ }), {
      target: { value: "release/1.0" },
    });
    fireEvent.click(within(dialog).getByRole("switch", { name: "Isolated worktree" }));
    expect(within(dialog).getByText(/Checks out the code in your project folder/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start review" }));
    // Gone from the DOM, not only hidden: a closing dialog that lingers (slow CI) would make the
    // next one's focus trap start hidden.
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());

    expect(api.calls).toContainEqual(
      expect.objectContaining({
        channel: "reviews:create",
        input: expect.objectContaining({ base: "release/1.0", isolated: false }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New review" }));
    const reopened = await findDialog();
    expect(within(reopened).getByRole("switch", { name: "Isolated worktree" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("shows why a review could not start and keeps the dialog open", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    api.createReviewError = {
      code: "local_changes",
      message: "The project folder has uncommitted changes.",
    };
    const dialog = await openNewReview();
    fireEvent.change(sourceBox(dialog), { target: { value: "feature/login" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start review" }));

    expect(
      await within(dialog).findByText("The project folder has uncommitted changes."),
    ).toBeTruthy();
    fireEvent.change(sourceBox(dialog), { target: { value: "feature/other" } });
    expect(within(dialog).queryByText("The project folder has uncommitted changes.")).toBeNull();
  });

  it("shows a base branch error on the base field, not on the branch field", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    api.createReviewError = { code: "base_not_found", message: 'Base branch "nope" was not found' };
    const dialog = await openNewReview();
    fireEvent.change(sourceBox(dialog), { target: { value: "feature/login" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start review" }));

    await within(dialog).findByText('Base branch "nope" was not found');
    const base = within(dialog).getByRole("combobox", { name: /Base branch/ });
    expect(base.getAttribute("aria-invalid")).toBe("true");
    expect(sourceBox(dialog).getAttribute("aria-invalid")).not.toBe("true");
  });

  it("does not show a failed close again after the dialog was cancelled", async () => {
    const project = makeProject("p1", "payments-api");
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.closeReviewError = { code: "internal", message: "Something went wrong in the app" };
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Close review" }));
    let confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Close review" }));
    expect(await within(confirm).findByText("Something went wrong in the app")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).queryByText("Something went wrong in the app")).toBeNull();
  });

  it("closes a review after confirming and shows what happened to the folder", async () => {
    const project = makeProject("p1", "payments-api");
    const api = stubBridge([project], [makeReview("r1", project, { isolated: false })]);
    api.closeNote = "Switched the project folder back to main.";
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Close review" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/switches back to the branch it was on/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Close review" }));

    expect(await screen.findByText("Switched the project folder back to main.")).toBeTruthy();
    expect(await screen.findByText("No open reviews.")).toBeTruthy();
    expect(api.calls).toContainEqual({ channel: "reviews:close", input: { id: "r1" } });
  });

  it("collapses the reviews list to its buttons and remembers it", async () => {
    const project = makeProject("p1", "payments-api");
    stubBridge([project], [makeReview("r1", project)]);
    renderApp();
    const list = await screen.findByRole("complementary", { name: "Reviews" });
    await within(list).findByText("feature/r1");
    fireEvent.click(within(list).getByRole("button", { name: "Hide reviews" }));

    const rail = screen.getByRole("complementary", { name: "Reviews" });
    expect(within(rail).queryByRole("heading", { name: "Reviews" })).toBeNull();
    expect(within(rail).getByRole("button", { name: "New review" })).toBeTruthy();
    expect(window.localStorage.getItem("problem.panel.reviews.list")).toContain('"collapsed":true');

    fireEvent.click(within(rail).getByRole("button", { name: "Show reviews" }));
    expect(await screen.findByRole("heading", { name: "Reviews" })).toBeTruthy();
  });
});
