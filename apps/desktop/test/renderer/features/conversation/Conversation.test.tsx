import type { ConversationEntry, StoredEntry } from "@reviewroom/shared";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, makeReview, removeBridge, stubBridge } from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");

function stored(reviewId: string, seq: number, entry: ConversationEntry): StoredEntry {
  return { reviewId, seq, at: "2026-11-17T10:00:00.000Z", entry };
}

const transcript = (reviewId: string): StoredEntry[] => [
  stored(reviewId, 1, { kind: "user", text: "Review the retry logic." }),
  stored(reviewId, 2, {
    kind: "tool-call",
    toolUseId: "t1",
    name: "Bash",
    summary: "git diff main feature",
    input: '{ "command": "git diff main feature" }',
  }),
  stored(reviewId, 3, {
    kind: "tool-result",
    toolUseId: "t1",
    isError: false,
    output: "+ retry()",
  }),
  stored(reviewId, 4, { kind: "assistant", text: "One **major** issue in `retry()`." }),
  stored(reviewId, 5, {
    kind: "turn-end",
    outcome: "success",
    costUsd: 0.18,
    durationMs: 42_000,
    message: null,
  }),
];

async function openConversation() {
  renderApp();
  return screen.findByRole("log", { name: "Conversation" });
}

const messageBox = () => screen.getByRole("textbox", { name: "Message" });

describe("Conversation", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {} });
  });

  it("shows the stored transcript: messages, markdown, tool cards and the turn summary", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.entries.r1 = transcript("r1");
    const log = await openConversation();

    expect(await within(log).findByText("Review the retry logic.")).toBeTruthy();
    expect(within(log).getByText("major").tagName).toBe("STRONG");
    expect(within(log).getByText("git diff main feature")).toBeTruthy();
    expect(within(log).getByText("Done · 42 s · $0.18")).toBeTruthy();

    fireEvent.click(within(log).getByRole("button", { name: /Bash/ }));
    expect(await within(log).findByText("+ retry()")).toBeTruthy();
  });

  it("follows live events: status, streaming text, then the stored message", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    const log = await openConversation();

    act(() => api.emit({ type: "review.status", reviewId: "r1", status: "running" }));
    expect(await within(log).findByText("Claude is working…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop Claude" })).toBeTruthy();

    act(() => {
      api.emit({ type: "review.delta", reviewId: "r1", text: "Looking at " });
      api.emit({ type: "review.delta", reviewId: "r1", text: "the diff" });
    });
    expect(await within(log).findByText("Looking at the diff")).toBeTruthy();

    act(() => {
      api.emit({
        type: "review.entry",
        entry: stored("r1", 1, { kind: "assistant", text: "Looking at the diff now." }),
      });
      api.emit({ type: "review.status", reviewId: "r1", status: "idle" });
    });
    expect(await within(log).findByText("Looking at the diff now.")).toBeTruthy();
    expect(within(log).queryByText("Looking at the diff")).toBeNull();
    expect(within(log).queryByText("Claude is working…")).toBeNull();
  });

  it("sends with Enter and the chosen model; Shift+Enter does not send", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    await openConversation();

    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(await screen.findByRole("option", { name: "Opus" }));

    fireEvent.change(messageBox(), { target: { value: "  Check the tests  " } });
    fireEvent.keyDown(messageBox(), { key: "Enter", shiftKey: true });
    expect(api.calls.some((c) => c.channel === "reviews:send")).toBe(false);

    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        channel: "reviews:send",
        input: { id: "r1", text: "Check the tests", model: "opus" },
      }),
    );
    await waitFor(() => expect(messageBox()).toHaveProperty("value", ""));
  });

  it("completes slash commands from the keyboard", async () => {
    stubBridge([project], [makeReview("r1", project)]);
    await openConversation();

    fireEvent.change(messageBox(), { target: { value: "/" } });
    const list = await screen.findByRole("listbox", { name: "Commands" });
    expect(within(list).getAllByRole("option")).toHaveLength(2);

    fireEvent.change(messageBox(), { target: { value: "/s" } });
    fireEvent.keyDown(messageBox(), { key: "ArrowDown" });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(messageBox()).toHaveProperty("value", "/simplify ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stops a running review", async () => {
    const api = stubBridge([project], [makeReview("r1", project, { status: "running" })]);
    await openConversation();

    fireEvent.click(screen.getByRole("button", { name: "Stop Claude" }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({ channel: "reviews:stop", input: { id: "r1" } }),
    );
  });

  it("shows why a message was refused", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.sendError = { code: "review_busy", message: "Claude is still working on this review." };
    await openConversation();

    fireEvent.change(messageBox(), { target: { value: "hello" } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(await screen.findByText("Claude is still working on this review.")).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "hello");
  });

  it("shows failed turns as errors", async () => {
    const api = stubBridge([project], [makeReview("r1", project, { status: "failed" })]);
    api.entries.r1 = [
      stored("r1", 1, { kind: "user", text: "Review it." }),
      stored("r1", 2, {
        kind: "turn-end",
        outcome: "error",
        costUsd: null,
        durationMs: null,
        message: "Claude Code was not found on your PATH.",
      }),
    ];
    const log = await openConversation();
    expect(
      await within(log).findByText("Failed: Claude Code was not found on your PATH."),
    ).toBeTruthy();
  });

  it("keeps the chosen model after switching to another review and back", async () => {
    const api = stubBridge([project], [makeReview("r1", project), makeReview("r2", project)]);
    await openConversation();

    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(await screen.findByRole("option", { name: "Opus" }));
    fireEvent.change(messageBox(), { target: { value: "hi" } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await waitFor(() => expect(api.reviews[0]?.model).toBe("opus"));

    const list = screen.getByRole("complementary", { name: "Reviews" });
    fireEvent.click(within(list).getByText("feature/r2"));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain("Default"),
    );
    fireEvent.click(within(list).getByText("feature/r1"));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain("Opus"),
    );
  });

  it("does not show a spinner on tool calls of earlier, interrupted turns", async () => {
    const api = stubBridge([project], [makeReview("r1", project, { status: "running" })]);
    api.entries.r1 = [
      stored("r1", 1, { kind: "user", text: "first" }),
      stored("r1", 2, {
        kind: "tool-call",
        toolUseId: "old",
        name: "Grep",
        summary: "old",
        input: "{}",
      }),
      stored("r1", 3, {
        kind: "turn-end",
        outcome: "interrupted",
        costUsd: null,
        durationMs: null,
        message: "Stopped.",
      }),
      stored("r1", 4, { kind: "user", text: "second" }),
      stored("r1", 5, {
        kind: "tool-call",
        toolUseId: "new",
        name: "Read",
        summary: "new",
        input: "{}",
      }),
    ];
    const log = await openConversation();
    await within(log).findByText("second");

    expect(within(log).getAllByLabelText("Running")).toHaveLength(1);
    expect(within(log).getByLabelText("No result")).toBeTruthy();
  });

  it("closes the command list with Escape", async () => {
    stubBridge([project], [makeReview("r1", project)]);
    await openConversation();
    fireEvent.change(messageBox(), { target: { value: "/" } });
    await screen.findByRole("listbox", { name: "Commands" });
    fireEvent.keyDown(messageBox(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
