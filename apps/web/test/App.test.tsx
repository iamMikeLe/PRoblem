import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./renderApp.tsx";
import { makeProject, stubApi } from "./stubApi.ts";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the rail, review list and server status", async () => {
    stubApi([makeProject("p1", "payments-api")]);
    renderApp();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Reviews" })).toBeTruthy();
    expect(await screen.findByText("Server 0.1.0")).toBeTruthy();
  });

  it("groups placeholder reviews under each project, in API order", async () => {
    stubApi([makeProject("p1", "payments-api"), makeProject("p2", "web-portal")]);
    renderApp();
    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["payments-api", "web-portal"]);

    const list = screen.getByRole("complementary", { name: "Reviews" });
    // Two placeholder reviews per project; the disabled "New review" button is the fifth.
    expect(within(list).getAllByRole("button", { current: false })).toHaveLength(4);
  });

  it("opens a review when it is clicked in the list", async () => {
    stubApi([makeProject("p1", "payments-api"), makeProject("p2", "web-portal")]);
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Dark mode for settings/ }));
    expect(screen.getByRole("heading", { name: "#1290 Dark mode for settings" })).toBeTruthy();
  });

  it("shows an error in the Reviews pane when projects cannot be loaded", async () => {
    const api = stubApi([]);
    api.listError = {
      status: 500,
      code: "internal",
      message: "Something went wrong on the server",
    };
    renderApp();
    const list = screen.getByRole("complementary", { name: "Reviews" });
    expect(await within(list).findByText(/Could not load projects/)).toBeTruthy();
  });

  it("drops a removed project's reviews from the Reviews list", async () => {
    stubApi([makeProject("p1", "payments-api"), makeProject("p2", "web-portal")]);
    renderApp();
    await screen.findByRole("heading", { level: 3, name: "web-portal" });

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    const pane = await screen.findByRole("complementary", { name: "Projects" });
    fireEvent.click(within(pane).getByRole("button", { name: /web-portal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove project",
      }),
    );
    await waitFor(() => expect(within(pane).queryByText("web-portal")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["payments-api"]);
  });

  it("invites adding a project when there are none, and opens the Projects section", async () => {
    stubApi([]);
    renderApp();
    expect(await screen.findByText("Add a project to start reviewing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.getByRole("complementary", { name: "Projects" })).toBeTruthy();
  });
});
