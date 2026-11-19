import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "../../renderApp.tsx";
import {
  makeActivity,
  makeFinding,
  makeProject,
  makeReview,
  removeBridge,
  stubBridge,
} from "../../stubBridge.ts";

const shop = makeProject("p1", "shop");
const r1 = makeReview("r1", shop, { title: "Discounts" });
const r2 = makeReview("r2", shop, { title: "Checkout" });

const rail = () => screen.getByRole("navigation", { name: "Main" });
const feed = () => screen.getByRole("complementary", { name: "Activity" });
const selectedTab = () =>
  within(screen.getByRole("main"))
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true");

describe("Activity", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("counts unread rows on the rail and lists the feed with what each row is about", async () => {
    const api = stubBridge([shop], [r1, r2]);
    api.activity = [
      makeActivity("a3", r2, { kind: "approval", toolName: "Bash" }),
      makeActivity("a2", r1, {
        kind: "finished",
        added: 2,
        top: { number: 4, severity: "blocker", title: "Discount applied twice" },
      }),
      makeActivity("a1", r1, { kind: "failed", message: "Too many turns" }, { read: true }),
    ];
    renderApp();

    fireEvent.click(await within(rail()).findByRole("button", { name: "Activity, 2 unread" }));
    const pane = await screen.findByRole("complementary", { name: "Activity" });
    const rows = await within(pane).findAllByRole("button", { name: /Discounts|Checkout/ });
    // The label says everything the row shows, unread in words; the age depends on the clock.
    expect(rows.map((row) => row.getAttribute("aria-label")?.replace(/, [^,]+$/, ""))).toEqual([
      "Unread: Needs your approval, Claude wants to use Bash. Checkout · shop",
      "Unread: Claude finished, 2 new findings · #4 Blocker: Discount applied twice. Discounts · shop",
      "Claude failed, Too many turns. Discounts · shop",
    ]);
    expect(screen.getByRole("heading", { name: "No activity selected" })).toBeTruthy();
  });

  it("opens a row's review on the tab it is about and marks it read", async () => {
    const api = stubBridge([shop], [r1, r2]);
    api.findings.r1 = [
      makeFinding("r1", 4, { severity: "blocker", title: "Discount applied twice" }),
    ];
    api.activity = [
      makeActivity("a2", r2, { kind: "commits", newCommits: 3, latestSha: "f", rewritten: false }),
      makeActivity("a1", r1, {
        kind: "finished",
        added: 1,
        top: { number: 4, severity: "blocker", title: "Discount applied twice" },
      }),
    ];
    renderApp();
    fireEvent.click(await within(rail()).findByRole("button", { name: /^Activity/ }));
    await screen.findByRole("complementary", { name: "Activity" });

    fireEvent.click(await within(feed()).findByRole("button", { name: /Claude finished/ }));
    expect(await screen.findByRole("heading", { name: "Discounts" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Finding #4" })).toBeTruthy();
    await waitFor(() =>
      expect(api.calls).toContainEqual({ channel: "activity:markRead", input: { ids: ["a1"] } }),
    );
    expect(await within(rail()).findByRole("button", { name: "Activity, 1 unread" })).toBeTruthy();

    fireEvent.click(within(feed()).getByRole("button", { name: /New commits/ }));
    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeTruthy();
    await waitFor(() => expect(selectedTab()?.textContent).toContain("Changes"));
  });

  it("filters unread rows, marks all as read, and reloads when the main process says so", async () => {
    const api = stubBridge([shop], [r1]);
    api.activity = [
      makeActivity("a2", r1, { kind: "comments", count: 2, until: "2026-11-19T10:00:00Z" }),
      makeActivity(
        "a1",
        r1,
        { kind: "posted", findings: 1, url: "https://github.com/x", submittedAt: null },
        {
          read: true,
        },
      ),
    ];
    renderApp();
    fireEvent.click(await within(rail()).findByRole("button", { name: /^Activity/ }));
    await screen.findByRole("complementary", { name: "Activity" });
    await within(feed()).findByRole("button", { name: /New PR comments/ });

    fireEvent.click(within(feed()).getByRole("tab", { name: "Unread (1)" }));
    expect(within(feed()).queryByRole("button", { name: /Posted to GitHub/ })).toBeNull();

    fireEvent.click(within(feed()).getByRole("button", { name: "Mark all as read" }));
    expect(await within(feed()).findByText("You're all caught up.")).toBeTruthy();
    expect(api.calls).toContainEqual({ channel: "activity:markRead", input: { ids: ["a2"] } });
    expect(within(rail()).getByRole("button", { name: "Activity" })).toBeTruthy();

    api.activity = [
      makeActivity("a3", r1, { kind: "approval", toolName: "Edit" }),
      ...api.activity,
    ];
    api.emit({ type: "activity.changed" });
    expect(await within(feed()).findByRole("button", { name: /Needs your approval/ })).toBeTruthy();
  });
});
