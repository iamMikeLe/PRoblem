import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "../../renderApp.tsx";
import {
  makeFinding,
  makeProject,
  makeReview,
  removeBridge,
  type StubState,
  stubBridge,
} from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");

function setup(): StubState {
  const api = stubBridge([project], [makeReview("r1", project), makeReview("r2", project)]);
  api.findings.r2 = [
    makeFinding("r2", 1, { title: "Unrelated" }),
    makeFinding("r2", 2, { title: "Retry loop never ends", severity: "blocker" }),
  ];
  api.changes.r2 = {
    fromSha: "c".repeat(40),
    toSha: "a".repeat(40),
    files: [
      { path: "src/app.ts", oldPath: null, status: "modified", additions: 1, deletions: 0 },
      { path: "src/retry.ts", oldPath: null, status: "added", additions: 4, deletions: 0 },
    ],
  };
  api.diffs["src/retry.ts"] = { path: "src/retry.ts", binary: false, tooLarge: false, hunks: [] };
  api.searchResults = {
    reviews: [{ reviewId: "r2", title: "feature/r2", detail: "payments-api · feature/r2 → main" }],
    findings: [
      {
        reviewId: "r2",
        reviewTitle: "feature/r2",
        number: 2,
        severity: "blocker",
        title: "Retry loop never ends",
        excerpt: null,
      },
    ],
    files: [{ reviewId: "r2", reviewTitle: "feature/r2", path: "src/retry.ts" }],
  };
  return api;
}

async function typeSearch(text: string) {
  const box = await screen.findByRole("combobox", { name: "Search reviews, findings and files" });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  const list = await screen.findByRole("listbox", { name: "Search results" });
  return { box, list };
}

const selectedTab = () =>
  screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");

describe("search", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("shows results grouped by kind, with the words emphasized, after typing pauses", async () => {
    const api = setup();
    renderApp();
    const { list } = await typeSearch("retry");
    const findings = await within(list).findByRole("group", { name: "Findings" });
    expect(within(list).getByRole("group", { name: "Reviews" })).toBeTruthy();
    expect(within(list).getByRole("group", { name: "Files" })).toBeTruthy();
    const option = within(findings).getByRole("option", {
      name: "Finding #2 Retry loop never ends in feature/r2",
    });
    expect(option.querySelector("mark")?.textContent).toBe("Retry");
    expect(api.calls.filter((c) => c.channel === "search:query").map((c) => c.input)).toEqual([
      { text: "retry" },
    ]);
  });

  it("opens a finding from the keyboard: its review, the Findings tab, the finding", async () => {
    setup();
    renderApp();
    const { box, list } = await typeSearch("retry");
    await within(list).findByRole("option", { name: /^Finding #2/ });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(
      within(list).getByRole("option", { name: /^Finding #2/ }).id,
    );
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByRole("region", { name: "Finding #2" })).toBeTruthy();
    expect(selectedTab()?.textContent).toContain("Findings");
    expect(screen.getByRole("heading", { name: "feature/r2" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Search results" })).toBeNull();
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("opens a changed file in the Changes tab", async () => {
    setup();
    renderApp();
    const { list } = await typeSearch("retry");
    fireEvent.click(await within(list).findByRole("option", { name: /^File src\/retry.ts/ }));
    await waitFor(() => expect(selectedTab()?.textContent).toBe("Changes"));
    const diff = await screen.findByRole("region", { name: "Diff" });
    expect(await within(diff).findByTitle("src/retry.ts")).toBeTruthy();
  });

  it("says when nothing is found, closes on Esc, and focuses on Ctrl+K", async () => {
    const api = setup();
    api.searchResults = { reviews: [], findings: [], files: [] };
    renderApp();
    const { box, list } = await typeSearch("zzz");
    expect(await within(list).findByText("Nothing found in open reviews.")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Search results" })).toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");

    (box as HTMLInputElement).blur();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(box);
  });
});
