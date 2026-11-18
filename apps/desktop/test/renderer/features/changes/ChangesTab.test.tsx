import type { FileDiff } from "@problem/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { renderApp } from "../../renderApp.tsx";
import {
  makeFinding,
  makeProject,
  makeReview,
  removeBridge,
  stubBridge,
} from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api", {
  changeFilters: { hideTests: false, hideGenerated: true, exclude: [] },
});

const appDiff: FileDiff = {
  path: "src/app.ts",
  binary: false,
  tooLarge: false,
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "import x;" },
        { kind: "del", oldLine: 2, newLine: null, text: "retry(3);" },
        { kind: "add", oldLine: null, newLine: 2, text: "retry(Infinity);" },
        { kind: "context", oldLine: 3, newLine: 3, text: "export {};" },
      ],
    },
  ],
};

function setup() {
  const api = stubBridge([project], [makeReview("r1", project)]);
  api.changes.r1 = {
    fromSha: "c".repeat(40),
    toSha: "a".repeat(40),
    files: [
      { path: "src/app.ts", oldPath: null, status: "modified", additions: 1, deletions: 1 },
      { path: "src/app.test.ts", oldPath: null, status: "added", additions: 10, deletions: 0 },
      { path: "pnpm-lock.yaml", oldPath: null, status: "modified", additions: 40, deletions: 2 },
    ],
  };
  api.diffs["src/app.ts"] = appDiff;
  api.findings.r1 = [
    makeFinding("r1", 1, {
      file: "src/app.ts",
      line: 2,
      title: "Retries never stop",
      severity: "blocker",
    }),
    makeFinding("r1", 2, { file: "src/app.ts", line: 90, title: "Far away" }),
  ];
  return api;
}

async function openChanges() {
  renderApp();
  fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
  return screen.findByRole("tree", { name: "Changed files" });
}

describe("Changes tab", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {}, approvals: {} });
  });

  it("lists changed files with counts, and still names the files the filters hide", async () => {
    const api = setup();
    api.diffs["pnpm-lock.yaml"] = {
      path: "pnpm-lock.yaml",
      binary: false,
      tooLarge: false,
      hunks: [],
    };
    const tree = await openChanges();
    expect(await within(tree).findByText("app.ts")).toBeTruthy();
    expect(within(tree).getByText("app.test.ts")).toBeTruthy();
    expect(within(tree).queryByText("pnpm-lock.yaml")).toBeNull();
    expect(within(tree).getByText("+10")).toBeTruthy();
    expect(screen.getByText("1 hidden file")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "pnpm-lock.yaml" }));
    expect(await screen.findByText(/No content changes/)).toBeTruthy();
  });

  it("hides nothing for a project with default filters", async () => {
    const plain = makeProject("p2", "plain");
    const api = stubBridge([plain], [makeReview("r9", plain)]);
    api.changes.r9 = {
      fromSha: "c".repeat(40),
      toSha: "a".repeat(40),
      files: [
        { path: "build/evil.js", oldPath: null, status: "added", additions: 1, deletions: 0 },
      ],
    };
    const tree = await openChanges();
    expect(await within(tree).findByText("evil.js")).toBeTruthy();
    expect(screen.queryByText(/hidden file/)).toBeNull();
  });

  it("saves filters for the project", async () => {
    const api = setup();
    const tree = await openChanges();
    await within(tree).findByText("app.test.ts");
    fireEvent.click(screen.getByRole("switch", { name: "Hide tests" }));
    await waitFor(() =>
      expect(api.projects[0]?.changeFilters).toEqual({
        hideTests: true,
        hideGenerated: true,
        exclude: [],
      }),
    );
    await waitFor(() => expect(within(tree).queryByText("app.test.ts")).toBeNull());

    const patterns = screen.getByRole("textbox", { name: /Hide patterns/ });
    fireEvent.change(patterns, { target: { value: "src/**, *.md" } });
    fireEvent.blur(patterns);
    await waitFor(() => expect(api.projects[0]?.changeFilters.exclude).toEqual(["src/**", "*.md"]));
  });

  it("shows the diff with findings on their lines, unified and split", async () => {
    setup();
    await openChanges();
    const table = await screen.findByRole("table", { name: "Diff of src/app.ts" });
    expect(within(table).getByText("retry(Infinity);")).toBeTruthy();
    const marker = within(table).getByRole("button", { name: /#1.*Retries never stop/ });
    expect(marker).toBeTruthy();
    // A finding outside the shown lines is listed above the diff.
    expect(screen.getByRole("button", { name: /#2 \(line 90\) Far away/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Split" }));
    const split = await screen.findByRole("table", { name: "Diff of src/app.ts" });
    const row = within(split).getByText("retry(3);").closest("tr");
    expect(row && within(row).getByText("retry(Infinity);")).toBeTruthy();
  });

  it("opens a line in the editor and a finding in the Findings tab", async () => {
    const api = setup();
    await openChanges();
    const table = await screen.findByRole("table", { name: "Diff of src/app.ts" });
    fireEvent.click(within(table).getByRole("button", { name: "Open line 2 in the editor" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.channel === "editor:open")?.input).toEqual({
        id: "r1",
        file: "src/app.ts",
        line: 2,
      }),
    );
    fireEvent.click(within(table).getByRole("button", { name: /#1.*Retries never stop/ }));
    expect(await screen.findByRole("region", { name: "Finding #1" })).toBeTruthy();
  });

  it("offers a refresh when the branch has new commits", async () => {
    const api = setup();
    api.updateCheck = {
      headSha: "a".repeat(40),
      latestSha: "d".repeat(40),
      newCommits: 2,
      commits: [
        { sha: "d".repeat(40), subject: "Cap retries" },
        { sha: "e".repeat(40), subject: "Add test" },
      ],
      rewritten: false,
    };
    await openChanges();
    expect(await screen.findByText("2 new commits on feature/r1")).toBeTruthy();
    expect(screen.getByText(/Cap retries · Add test/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh to dddddddd" }));
    await waitFor(() => expect(api.calls.some((c) => c.channel === "reviews:refresh")).toBe(true));
    expect(await screen.findByText(/Up to date at dddddddd/)).toBeTruthy();
  });

  it("does not refresh while Claude is working", async () => {
    const api = stubBridge([project], [makeReview("r1", project, { status: "running" })]);
    api.updateCheck = {
      headSha: "a".repeat(40),
      latestSha: "d".repeat(40),
      newCommits: 1,
      commits: [{ sha: "d".repeat(40), subject: "x" }],
      rewritten: true,
    };
    renderApp();
    fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(await screen.findByText(/history of feature\/r1 was rewritten/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Refresh to dddddddd" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
