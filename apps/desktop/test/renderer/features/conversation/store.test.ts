import type { StoredEntry } from "@reviewroom/shared";
import { afterEach, describe, expect, it } from "vitest";
import { describeTurnEnd } from "../../../../src/renderer/src/features/conversation/format.ts";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";

const entry = (seq: number, text: string): StoredEntry => ({
  reviewId: "r1",
  seq,
  at: "2026-11-17T10:00:00.000Z",
  entry: { kind: "assistant", text },
});

describe("conversation store", () => {
  afterEach(() => useConversationStore.setState({ entries: {}, live: {}, statuses: {} }));

  it("merges a loaded transcript with entries that arrived first, by sequence number", () => {
    const store = useConversationStore.getState();
    store.receive({ type: "review.entry", entry: entry(3, "third") });
    store.load("r1", [entry(1, "first"), entry(2, "second"), entry(3, "third")]);

    expect(useConversationStore.getState().entries.r1?.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("builds live text from deltas and clears it when the message is stored", () => {
    const store = useConversationStore.getState();
    store.receive({ type: "review.delta", reviewId: "r1", text: "Hel" });
    store.receive({ type: "review.delta", reviewId: "r1", text: "lo" });
    expect(useConversationStore.getState().live.r1).toBe("Hello");

    store.receive({ type: "review.entry", entry: entry(1, "Hello") });
    expect(useConversationStore.getState().live.r1).toBeUndefined();
  });

  it("keeps the latest status per review", () => {
    const store = useConversationStore.getState();
    store.receive({ type: "review.status", reviewId: "r1", status: "running" });
    store.receive({ type: "review.status", reviewId: "r2", status: "queued" });
    expect(useConversationStore.getState().statuses).toEqual({ r1: "running", r2: "queued" });
  });
});

describe("turn summary", () => {
  it("describes how a turn ended", () => {
    const base = { kind: "turn-end", costUsd: null, durationMs: null, message: null } as const;
    expect(
      describeTurnEnd({ ...base, outcome: "success", durationMs: 125_000, costUsd: 1.234 }),
    ).toBe("Done · 2 min 5 s · $1.23");
    expect(describeTurnEnd({ ...base, outcome: "interrupted" })).toBe("Stopped");
    expect(describeTurnEnd({ ...base, outcome: "error" })).toBe("Failed");
  });
});
