import {
  SECURITY_CATEGORIES,
  SECURITY_CATEGORY_ORDER,
  type SecurityCategory,
  type SecurityScan,
} from "@problem/shared";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDrafts } from "../../../../src/renderer/src/features/conversation/drafts.ts";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { checkStatus } from "../../../../src/renderer/src/features/security/model.ts";
import { renderApp } from "../../renderApp.tsx";
import {
  makeFinding,
  makeProject,
  makeReview,
  removeBridge,
  stubBridge,
} from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");

function makeScan(
  reviewId: string,
  failing: readonly SecurityCategory[] = [],
  summary = "Scanned the changed files.",
): SecurityScan {
  return {
    reviewId,
    summary,
    checks: SECURITY_CATEGORY_ORDER.map((category) => ({
      category,
      status: failing.includes(category) ? "fail" : "pass",
      note: `Looked for ${category} problems.`,
    })),
    updatedAt: "2026-11-24T10:00:00.000Z",
  };
}

const sqlInjection = makeFinding("r1", 1, {
  severity: "blocker",
  securityCategory: "injection",
  title: "SQL built from the search query",
  file: "src/search.ts",
  line: 12,
  problem: "`q` is concatenated into the SQL, so a request can **read any table**.",
  suggestion: "Use a parameterized query.",
});

const leakedKey = makeFinding("r1", 2, {
  severity: "blocker",
  securityCategory: "secrets",
  title: "AWS access key committed in .env.example",
  file: ".env.example",
  line: 3,
  problem: "Anyone with read access to the repository can use the key.",
  suggestion: "Rotate the key, then load it from the environment.",
});

async function openSecurity() {
  renderApp();
  fireEvent.click(await screen.findByRole("tab", { name: /Security/ }));
  return screen.findByRole("list", { name: "Security checks" });
}

const checkRow = (checks: HTMLElement, category: SecurityCategory) => {
  const row = within(checks).getByText(SECURITY_CATEGORIES[category].label).closest("li");
  if (!(row instanceof HTMLElement)) throw new Error(`no check for ${category}`);
  return row;
};

/** The status text a check row shows (e.g. "Passed", "Issues found (1)"). */
const statusOf = (checks: HTMLElement, category: SecurityCategory) =>
  checkRow(checks, category).lastElementChild?.textContent;

describe("Security tab", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {} });
    useDrafts.setState({ drafts: {} });
  });

  it("shows an injection finding with where, why and the fix, and keeps it out of Findings", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [
      sqlInjection,
      makeFinding("r1", 3, { severity: "minor", title: "Unclear name" }),
    ];
    api.securityScans.r1 = makeScan("r1", ["injection"]);
    const checks = await openSecurity();

    expect(
      screen.getByRole("heading", { name: /Security scan: 1 security issue found/ }),
    ).toBeTruthy();
    expect(statusOf(checks, "injection")).toMatch(/^Issues found/);
    expect(statusOf(checks, "secrets")).toMatch(/^Passed/);

    const card = screen.getByRole("article", { name: "Security finding #1" });
    expect(within(card).getByText("Blocker")).toBeTruthy();
    expect(within(card).getByText("SQL built from the search query")).toBeTruthy();
    expect(within(card).getByText("Injection")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "src/search.ts:12" })).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Why it is risky" })).toBeTruthy();
    expect(within(card).getByText("read any table").tagName).toBe("STRONG");
    expect(within(card).getByRole("heading", { name: "Suggested fix" })).toBeTruthy();
    expect(within(card).getByText("Use a parameterized query.")).toBeTruthy();
    expect(screen.queryByText("Unclear name")).toBeNull();
    // The tab's badge counts it.
    expect(screen.getByRole("tab", { name: /Security\s*1/ })).toBeTruthy();

    // The Findings tab is unchanged: only the other finding.
    fireEvent.click(screen.getByRole("tab", { name: /Findings/ }));
    const grid = await screen.findByRole("grid", { name: "Findings" });
    expect(within(grid).getByText("Unclear name")).toBeTruthy();
    expect(within(grid).queryByText("SQL built from the search query")).toBeNull();
    expect(screen.getByRole("tab", { name: /Findings\s*1/ })).toBeTruthy();
  });

  it("flags a leaked secret under secrets, also when the scan has not caught up", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [leakedKey];
    // The scan predates the finding: the open finding still fails its category.
    api.securityScans.r1 = makeScan("r1");
    const checks = await openSecurity();

    expect(statusOf(checks, "secrets")).toBe("Issues found (1)");
    const card = screen.getByRole("article", { name: "Security finding #2" });
    expect(within(card).getByRole("button", { name: ".env.example:3" })).toBeTruthy();
    expect(within(card).getByText(/Rotate the key/)).toBeTruthy();
  });

  it("shows the summary and every passed check for a clean PR", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.securityScans.r1 = makeScan("r1", [], "Scanned 4 files: the API handler and its tests.");
    const checks = await openSecurity();

    expect(
      screen.getByRole("heading", { name: /Security scan: No security issues found/ }),
    ).toBeTruthy();
    expect(screen.getByText("Scanned 4 files: the API handler and its tests.")).toBeTruthy();
    const rows = within(checks).getAllByRole("listitem");
    expect(rows).toHaveLength(SECURITY_CATEGORY_ORDER.length);
    for (const category of SECURITY_CATEGORY_ORDER) {
      expect(statusOf(checks, category)).toMatch(/^Passed/);
      expect(
        within(checkRow(checks, category)).getByText(`Looked for ${category} problems.`),
      ).toBeTruthy();
    }
    expect(screen.getByText("No open security findings.")).toBeTruthy();
  });

  it("scrolls to a security finding chosen in search, even a dismissed one", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [{ ...leakedKey, verdict: "dismissed" }, sqlInjection];
    api.securityScans.r1 = makeScan("r1");
    api.searchResults = {
      reviews: [],
      findings: [
        {
          reviewId: "r1",
          reviewTitle: "Retry webhooks",
          number: 2,
          severity: "blocker",
          title: leakedKey.title,
          excerpt: null,
        },
      ],
      files: [],
    };
    renderApp();
    const box = await screen.findByRole("combobox", { name: "Search reviews, findings and files" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "AWS" } });
    const list = await screen.findByRole("listbox", { name: "Search results" });
    fireEvent.click(await within(list).findByRole("option", { name: /^Finding #2/ }));

    const card = await screen.findByRole("article", { name: "Security finding #2" });
    expect(screen.getByRole("tab", { name: /Security/, selected: true })).toBeTruthy();
    expect(screen.queryByRole("grid", { name: "Findings" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(card));

    // Deciding on another finding re-renders the tab without pulling focus back.
    const other = screen.getByRole("article", { name: "Security finding #1" });
    const accept = within(other).getByRole("button", { name: "Accept" });
    accept.focus();
    fireEvent.click(accept);
    await waitFor(() => expect(api.findings.r1?.[1]?.verdict).toBe("accepted"));
    await within(other).findByRole("button", { name: "Reopen" });
    expect(document.activeElement).not.toBe(card);
  });

  it("lists what will be checked before the first scan", async () => {
    stubBridge([project], [makeReview("r1", project)]);
    const checks = await openSecurity();
    expect(screen.getByRole("heading", { name: /Security scan: Not scanned yet/ })).toBeTruthy();
    for (const category of SECURITY_CATEGORY_ORDER) {
      expect(statusOf(checks, category)).toMatch(/^Not scanned yet/);
    }
  });

  it("updates live when Claude reports a scan and findings", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    await openSecurity();
    expect(screen.getByRole("heading", { name: /Not scanned yet/ })).toBeTruthy();

    act(() => {
      api.emit({ type: "review.findings", reviewId: "r1", findings: [leakedKey] });
      api.emit({ type: "review.securityScan", scan: makeScan("r1", ["secrets"]) });
    });
    expect(await screen.findByRole("heading", { name: /1 security issue found/ })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Security finding #2" })).toBeTruthy();
  });

  it("dismissing the finding of a failed check resolves it and hides the card until asked", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.findings.r1 = [sqlInjection];
    api.securityScans.r1 = makeScan("r1", ["injection"]);
    const checks = await openSecurity();

    const card = screen.getByRole("article", { name: "Security finding #1" });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.findings.r1?.[0]?.verdict).toBe("dismissed"));
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "Security finding #1" })).toBeNull(),
    );
    // The scan said "fail"; with its only finding dismissed the row and the header agree.
    expect(statusOf(checks, "injection")).toBe("Resolved");
    expect(screen.getByRole("heading", { name: /No security issues found/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Security\s*\d/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show dismissed and withdrawn (1)" }));
    expect(screen.getByRole("article", { name: "Security finding #1" })).toBeTruthy();
  });

  it("a check fails on active findings, else shows the scan, else 'not scanned'", () => {
    expect(checkStatus("injection", undefined, [sqlInjection])).toBe("fail");
    expect(checkStatus("injection", makeScan("r1"), [])).toBe("pass");
    expect(checkStatus("injection", null, [])).toBe("not-scanned");
    const dismissed = { ...sqlInjection, verdict: "dismissed" as const };
    expect(checkStatus("injection", makeScan("r1", ["injection"]), [dismissed])).toBe("resolved");
    // A failed check without any finding stays failed.
    expect(checkStatus("injection", makeScan("r1", ["injection"]), [])).toBe("fail");
    expect(
      checkStatus("injection", makeScan("r1"), [{ ...sqlInjection, withdrawnReason: "Fixed" }]),
    ).toBe("pass");
  });
});
