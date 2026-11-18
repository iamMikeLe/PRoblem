import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDrafts } from "../../../../src/renderer/src/features/conversation/drafts.ts";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { renderApp } from "../../renderApp.tsx";
import {
  makeFinding,
  makeProject,
  makeReview,
  removeBridge,
  stubBridge,
} from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");

async function openFindings() {
  renderApp();
  fireEvent.click(await screen.findByRole("tab", { name: /Findings/ }));
  return screen.findByRole("grid", { name: "Findings" });
}

const rowOf = (grid: HTMLElement, text: string) => {
  const row = within(grid).getByText(text).closest('[role="row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${text}`);
  return row;
};

describe("Findings tab", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {} });
    useDrafts.setState({ drafts: {} });
  });

  it("lists open findings by severity with their number, location and verdict", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [
      makeFinding("r1", 1, { severity: "minor", title: "Unclear name" }),
      makeFinding("r1", 2, { severity: "blocker", title: "Retries never stop", line: 42 }),
      makeFinding("r1", 3, { title: "Already handled", verdict: "dismissed" }),
      makeFinding("r1", 4, { title: "Gone", withdrawnReason: "Fixed upstream" }),
      makeFinding("r1", 5, { title: "Whole thing", file: null, line: null, severity: "nit" }),
    ];
    const grid = await openFindings();

    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/^#\d+$/).textContent)).toEqual([
      "#2",
      "#1",
      "#5",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Blocker")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("src/app.ts:42")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Whole change")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Open (3)" })).toBeTruthy();
    // The review's tab shows the open count.
    expect(screen.getByRole("tab", { name: /Findings\s*3/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Withdrawn (1)" }));
    expect(await within(grid).findByText("Gone")).toBeTruthy();
    expect(within(grid).queryByText("Retries never stop")).toBeNull();
  });

  it("accepts, dismisses and reopens a finding from its detail", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [
      makeFinding("r1", 1, { title: "Retries never stop", problem: "It **loops**." }),
    ];
    const grid = await openFindings();

    fireEvent.click(rowOf(grid, "Retries never stop"));
    const detail = await screen.findByRole("region", { name: "Finding #1" });
    expect(within(detail).getByText("loops").tagName).toBe("STRONG");

    fireEvent.click(within(detail).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.findings.r1?.[0]?.verdict).toBe("accepted"));
    // The detail stays open although the finding left the Open view.
    expect(await within(detail).findByRole("button", { name: "Reopen" })).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.findings.r1?.[0]?.verdict).toBe("dismissed"));
    fireEvent.click(await within(detail).findByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(api.findings.r1?.[0]?.verdict).toBe("open"));
  });

  it("updates live when Claude reports findings", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    renderApp();
    fireEvent.click(await screen.findByRole("tab", { name: /Findings/ }));
    expect(await screen.findByText(/No findings yet/)).toBeTruthy();

    api.findings.r1 = [
      makeFinding("r1", 1, { title: "New one", changedSinceVerdict: true, verdict: "accepted" }),
    ];
    act(() =>
      api.emit({ type: "review.findings", reviewId: "r1", findings: api.findings.r1 ?? [] }),
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Accepted (1)" }));
    const grid = await screen.findByRole("grid", { name: "Findings" });
    expect(within(rowOf(grid, "New one")).getByText(/changed/)).toBeTruthy();
  });

  it("opens the location in the editor and shows why it could not", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [makeFinding("r1", 1, { line: 7 })];
    const grid = await openFindings();

    fireEvent.click(within(grid).getByText("src/app.ts:7"));
    await waitFor(() =>
      expect(api.calls.find((call) => call.channel === "editor:open")?.input).toEqual({
        id: "r1",
        file: "src/app.ts",
        line: 7,
      }),
    );
    // Clicking the link does not select the row.
    expect(screen.queryByRole("region", { name: "Finding #1" })).toBeNull();

    api.editorError = { code: "editor_not_found", message: "code was not found on your PATH." };
    fireEvent.click(within(grid).getByText("src/app.ts:7"));
    expect(await screen.findByText("code was not found on your PATH.")).toBeTruthy();
  });

  it("Ask about #N fills in the composer and switches to the conversation", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [makeFinding("r1", 2, { title: "Retries never stop" })];
    const grid = await openFindings();

    fireEvent.click(rowOf(grid, "Retries never stop"));
    fireEvent.click(await screen.findByRole("button", { name: "Ask about #2" }));
    const box = await screen.findByRole("textbox", { name: "Message" });
    expect((box as HTMLTextAreaElement).value).toBe("About #2 (Retries never stop): ");
    expect(document.activeElement).toBe(box);
  });

  it("focuses the composer only once after Ask, not on later review switches", async () => {
    const api = stubBridge([project], [makeReview("r1", project), makeReview("r2", project)]);
    api.findings.r1 = [makeFinding("r1", 2, { title: "Retries never stop" })];
    const grid = await openFindings();
    fireEvent.click(rowOf(grid, "Retries never stop"));
    fireEvent.click(await screen.findByRole("button", { name: "Ask about #2" }));
    await screen.findByRole("textbox", { name: "Message" });

    const list = screen.getByRole("complementary", { name: "Reviews" });
    const other = within(list).getByRole("button", { name: /feature\/r2/ });
    other.focus();
    fireEvent.click(other);
    await waitFor(() => expect(screen.getByRole("heading", { name: "feature/r2" })).toBeTruthy());
    expect(document.activeElement).toBe(other);
  });

  it("shows open findings and blockers under the review in the list", async () => {
    const api = stubBridge([project], [makeReview("r1", project), makeReview("r2", project)]);
    api.findings.r1 = [
      makeFinding("r1", 1, { severity: "blocker" }),
      makeFinding("r1", 2),
      makeFinding("r1", 3, { verdict: "accepted", severity: "blocker" }),
    ];
    renderApp();
    const list = await screen.findByRole("complementary", { name: "Reviews" });
    expect(await within(list).findByText(/2 open/)).toBeTruthy();
    expect(within(list).getByText(/1 blocker/)).toBeTruthy();
    expect(within(list).getAllByText(/open/)).toHaveLength(1);
  });
});
