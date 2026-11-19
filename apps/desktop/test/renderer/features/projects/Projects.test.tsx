import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dialogClosed, findDialog } from "../../dialogs.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, removeBridge, stubBridge } from "../../stubBridge.ts";

async function openProjects() {
  renderApp();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  return screen.findByRole("complementary", { name: "Projects" });
}

describe("Projects section", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("lists projects with their paths and shows the first one", async () => {
    stubBridge([makeProject("p1", "payments-api"), makeProject("p2", "web-portal")]);
    const pane = await openProjects();
    expect(await within(pane).findByText("/repos/web-portal")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "payments-api" })).toBeTruthy();

    fireEvent.click(within(pane).getByRole("button", { name: /web-portal/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "web-portal" })).toBeTruthy();
  });

  it("shows the server's message inline when adding fails", async () => {
    const api = stubBridge([]);
    api.createError = {
      code: "not_a_git_repo",
      message: "/tmp/x is not inside a git work tree",
    };
    await openProjects();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = await findDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Repository folder/ }), {
      target: { value: "/tmp/x" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(await within(dialog).findByText("/tmp/x is not inside a git work tree")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Editing the path clears the verdict about the previous path.
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Repository folder/ }), {
      target: { value: "/tmp/y" },
    });
    expect(within(dialog).queryByText("/tmp/x is not inside a git work tree")).toBeNull();
  });

  it("adds a project, closes the dialog and selects it", async () => {
    const api = stubBridge([]);
    await openProjects();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = await findDialog();
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox", { name: /Repository folder/ }), {
      target: { value: " ~/code/ledger " },
    });
    fireEvent.click(add);

    expect(await screen.findByRole("heading", { level: 2, name: "ledger" })).toBeTruthy();
    await dialogClosed();
    expect(api.calls).toContainEqual({
      channel: "projects:create",
      input: { path: "~/code/ledger" },
    });
  });

  it("fills the path from the native folder picker and keeps it when the picker is cancelled", async () => {
    const api = stubBridge([]);
    api.pickedFolder = "/Users/me/code/ledger";
    await openProjects();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: /Repository folder/ });

    fireEvent.click(within(dialog).getByRole("button", { name: "Browse for a folder" }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("/Users/me/code/ledger"));

    api.pickedFolder = null;
    fireEvent.click(within(dialog).getByRole("button", { name: "Browse for a folder" }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.channel === "dialog:pickFolder")).toHaveLength(2),
    );
    expect((input as HTMLInputElement).value).toBe("/Users/me/code/ledger");
  });

  it("removes a project only after confirming", async () => {
    const api = stubBridge([makeProject("p1", "payments-api"), makeProject("p2", "web-portal")]);
    const pane = await openProjects();
    await within(pane).findByText("payments-api");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await findDialog(undefined, "alertdialog");
    expect(within(dialog).getByText("Remove payments-api?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove project" }));

    await waitFor(() => expect(within(pane).queryByText("payments-api")).toBeNull());
    expect(api.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(screen.getByRole("heading", { level: 2, name: "web-portal" })).toBeTruthy();
  });

  it("keeps the project and shows the error when removing fails", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    api.deleteError = { code: "internal", message: "Something went wrong" };
    await openProjects();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await findDialog(undefined, "alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove project" }));

    expect(await within(dialog).findByText("Something went wrong")).toBeTruthy();
    expect(api.projects).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await dialogClosed("alertdialog");
    expect(screen.getByRole("heading", { level: 2, name: "payments-api" })).toBeTruthy();
  });

  it("shows the empty states after removing the last project", async () => {
    stubBridge([makeProject("p1", "payments-api")]);
    const pane = await openProjects();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(
      within(await findDialog(undefined, "alertdialog")).getByRole("button", {
        name: "Remove project",
      }),
    );
    expect(await within(pane).findByText(/No projects yet/)).toBeTruthy();
    expect(screen.getByText("Select a project or add one.")).toBeTruthy();
  });

  it("shows an empty state when there are no projects", async () => {
    stubBridge([]);
    const pane = await openProjects();
    expect(await within(pane).findByText(/No projects yet/)).toBeTruthy();
  });
});
