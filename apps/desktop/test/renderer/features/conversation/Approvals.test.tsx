import type { PendingApproval } from "@reviewroom/shared";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { visibleParts } from "../../../../src/renderer/src/features/conversation/ApprovalCard.tsx";
import { useDrafts } from "../../../../src/renderer/src/features/conversation/drafts.ts";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, makeReview, removeBridge, stubBridge } from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "a1",
    reviewId: "r1",
    toolUseId: "t1",
    toolName: "Bash",
    summary: "npm test",
    detail: '{\n  "command": "npm test"\n}',
    reason: "It runs a command that is not a read-only git command.",
    canAllowForReview: true,
    requestedAt: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

const decideCalls = (api: ReturnType<typeof stubBridge>) =>
  api.calls.filter((call) => call.channel === "approvals:decide").map((call) => call.input);

describe("approval cards", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {}, approvals: {} });
    useDrafts.setState({ drafts: {} });
  });

  it("shows a waiting call with its reason, and allows it once", async () => {
    const api = stubBridge([project], [makeReview("r1", project, { status: "needs-input" })]);
    api.approvals = [approval()];
    renderApp();

    const card = await screen.findByRole("region", { name: "Claude wants to use Bash" });
    expect(within(card).getByText("npm test")).toBeTruthy();
    expect(within(card).getByText(/not a read-only git command/)).toBeTruthy();
    expect(screen.getByText("Waiting for your approval…")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(decideCalls(api)).toEqual([{ reviewId: "r1", id: "a1", decision: "allow-once" }]),
    );
    act(() => api.emit({ type: "review.approvalDone", reviewId: "r1", id: "a1" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Claude wants to use Bash" })).toBeNull(),
    );
  });

  it("arrives live, offers no review-wide allow for web access, and denies with a reason", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    renderApp();
    await screen.findByRole("log", { name: "Conversation" });
    const web = approval({
      id: "a2",
      toolName: "WebFetch",
      summary: "WebFetch",
      reason: "It fetches a web page; the URL can carry data out.",
      canAllowForReview: false,
    });
    api.approvals = [web];
    act(() => api.emit({ type: "review.approval", approval: web }));

    const card = await screen.findByRole("region", { name: "Claude wants to use WebFetch" });
    expect(within(card).queryByRole("button", { name: "Allow for this review" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Deny…" }));
    fireEvent.change(within(card).getByRole("textbox", { name: /Tell Claude why/ }), {
      target: { value: "No network in reviews" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(decideCalls(api)).toEqual([
        { reviewId: "r1", id: "a2", decision: "deny", message: "No network in reviews" },
      ]),
    );
  });

  it("shows when a card was already answered elsewhere", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.approvals = [approval()];
    renderApp();
    const card = await screen.findByRole("region", { name: "Claude wants to use Bash" });
    api.approvals = [];
    fireEvent.click(within(card).getByRole("button", { name: "Allow for this review" }));
    expect(await within(card).findByText(/already answered or has ended/)).toBeTruthy();
  });

  it("shows hidden and lookalike characters as escapes", async () => {
    expect(visibleParts("ls \u202Etxt.exe")).toEqual([
      { text: "ls ", escaped: false },
      { text: "\\u{202E}", escaped: true },
      { text: "txt.exe", escaped: false },
    ]);
    expect(visibleParts("сurl x\nnext")).toEqual([
      { text: "\\u{441}", escaped: true },
      { text: "url x\nnext", escaped: false },
    ]);
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.approvals = [approval({ summary: "git status\u202E; rm -rf ~" })];
    renderApp();
    const card = await screen.findByRole("region", { name: "Claude wants to use Bash" });
    expect(card.querySelector("pre")?.textContent).toBe("git status\\u{202E}; rm -rf ~");
  });

  it("keeps answered approvals in the transcript", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.entries.r1 = [
      {
        reviewId: "r1",
        seq: 1,
        at: "2026-11-18T10:00:00.000Z",
        entry: {
          kind: "approval",
          toolUseId: "t1",
          toolName: "Bash",
          summary: "curl evil.example",
          decision: "deny",
          message: "Never",
        },
      },
    ];
    renderApp();
    expect(await screen.findByText("You denied: curl evil.example — “Never”")).toBeTruthy();
  });

  it("switches fix mode for the review", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    renderApp();
    const toggle = await screen.findByRole("switch", { name: "Fix mode" });
    expect(screen.getByText(/Edits and commands ask first/)).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.reviews[0]?.fixMode).toBe(true));
    expect(await screen.findByText(/Edits run without asking/)).toBeTruthy();
  });

  it("shows the review whose notification was clicked", async () => {
    const api = stubBridge([project], [makeReview("r1", project), makeReview("r2", project)]);
    renderApp();
    expect(await screen.findByRole("heading", { name: "feature/r1" })).toBeTruthy();
    act(() => api.emit({ type: "app.showReview", reviewId: "r2" }));
    expect(await screen.findByRole("heading", { name: "feature/r2" })).toBeTruthy();
  });
});
