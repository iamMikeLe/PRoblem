import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "./renderApp.tsx";
import { makeProject, makeReview, removeBridge, stubBridge } from "./stubBridge.ts";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("renders the title bar, rail and review list", async () => {
    const project = makeProject("p1", "payments-api");
    stubBridge([project], [makeReview("r1", project)]);
    renderApp();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Reviews" })).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 3, name: "payments-api" })).toBeTruthy();
  });

  it("groups reviews under their project and hides projects without reviews", async () => {
    const payments = makeProject("p1", "payments-api");
    const portal = makeProject("p2", "web-portal");
    const idle = makeProject("p3", "idle-project");
    stubBridge(
      [payments, portal, idle],
      [makeReview("r1", payments), makeReview("r2", portal), makeReview("r3", payments)],
    );
    renderApp();
    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["payments-api", "web-portal"]);
  });

  it("describes each review by its branches and opens it on click", async () => {
    const project = makeProject("p1", "payments-api");
    stubBridge(
      [project],
      [
        makeReview("r1", project),
        makeReview("r2", project, {
          title: "Retry idempotent webhooks",
          source: {
            kind: "pull-request",
            url: "https://github.com/acme/p/pull/12",
            number: 12,
            repo: "acme/p",
          },
          headBranch: "webhooks",
          isolated: false,
          workdir: "/repos/payments-api",
        }),
      ],
    );
    renderApp();
    const list = await screen.findByRole("complementary", { name: "Reviews" });
    expect(
      await within(list).findByText("PR #12 · webhooks → main · in project folder"),
    ).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: /Retry idempotent webhooks/ }));
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Retry idempotent webhooks" })).toBeTruthy();
    expect(within(main).getByText("In project folder")).toBeTruthy();
    expect(within(main).getByText("/repos/payments-api")).toBeTruthy();
  });

  it("shows an error in the Reviews pane when projects cannot be loaded", async () => {
    const api = stubBridge([]);
    api.listError = { code: "internal", message: "Something went wrong in the app" };
    renderApp();
    const list = screen.getByRole("complementary", { name: "Reviews" });
    expect(await within(list).findByText(/Could not load projects/)).toBeTruthy();
  });

  it("invites adding a project when there are none, and opens the Projects section", async () => {
    stubBridge([]);
    renderApp();
    expect(await screen.findByText("Add a project to start reviewing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.getByRole("complementary", { name: "Projects" })).toBeTruthy();
  });

  it("invites starting a review when projects have none", async () => {
    stubBridge([makeProject("p1", "payments-api")]);
    renderApp();
    expect(await screen.findByText("No open reviews.")).toBeTruthy();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "No review selected" })).toBeTruthy();
    fireEvent.click(within(main).getByRole("button", { name: "New review" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
