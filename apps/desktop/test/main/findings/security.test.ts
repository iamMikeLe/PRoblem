import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type AppEvent, SECURITY_CATEGORY_ORDER, type SecurityCategory } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reviewSystemAppend } from "../../../src/main/claude/prompt.ts";
import { openDatabase } from "../../../src/main/db/database.ts";
import { createFindingsService, type FindingsService } from "../../../src/main/findings/service.ts";
import { markReviewClosed } from "../../../src/main/reviews/repository.ts";
import { addReview } from "./fixture.ts";

const checks = (failing: readonly SecurityCategory[] = []) =>
  SECURITY_CATEGORY_ORDER.map((category) => ({
    category,
    status: failing.includes(category) ? "fail" : "pass",
    note: `Checked ${category}.`,
  }));

describe("security scan", () => {
  let db: DatabaseSync;
  let dir: string;
  let events: AppEvent[];
  let findings: FindingsService;
  let clock: Date;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "problem-security-"));
    db = openDatabase(":memory:");
    events = [];
    clock = new Date("2026-11-24T10:00:00.000Z");
    findings = createFindingsService({ db, broadcast: (e) => events.push(e), now: () => clock });
    addReview(db, "r1", dir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const report = (input: unknown) => findings.report("r1", dir, input);

  it("has no scan until Claude reports one", () => {
    expect(findings.securityScan("r1")).toBeNull();
  });

  it("saves an injection finding with its category, and the scan that failed on it", () => {
    const outcome = report({
      add: [
        {
          severity: "blocker",
          security: "injection",
          title: "SQL built from the search query",
          file: "src/search.ts",
          line: 12,
          problem: "`q` is concatenated into the SQL, so a request can read any table.",
          suggestion: "Use a parameterized query.",
        },
        { severity: "minor", title: "Unclear name", problem: "p", suggestion: "s" },
      ],
      securityScan: { summary: "Scanned the search endpoint.", checks: checks(["injection"]) },
    });

    expect(outcome).toMatchObject({
      ok: true,
      text: "Saved:\n- #1 added: SQL built from the search query\n- #2 added: Unclear name\n- security scan",
    });
    const [security, other] = findings.list("r1");
    expect(security).toMatchObject({
      securityCategory: "injection",
      severity: "blocker",
      file: "src/search.ts",
      line: 12,
    });
    expect(other?.securityCategory).toBeNull();

    const scan = findings.securityScan("r1");
    expect(scan).toMatchObject({ reviewId: "r1", summary: "Scanned the search endpoint." });
    expect(scan?.checks.find((c) => c.category === "injection")?.status).toBe("fail");
    expect(events).toContainEqual({ type: "review.securityScan", scan });
  });

  it("saves a leaked secret as a secrets finding", () => {
    report({
      add: [
        {
          severity: "blocker",
          security: "secrets",
          title: "AWS access key committed in .env.example",
          file: ".env.example",
          line: 3,
          problem:
            "A live-looking key is in the repository history; anyone with read access can use it.",
          suggestion: "Rotate the key, remove it, and load it from the environment.",
        },
      ],
      securityScan: { summary: "Scanned config files.", checks: checks(["secrets"]) },
    });
    expect(findings.list("r1")[0]).toMatchObject({
      securityCategory: "secrets",
      file: ".env.example",
    });
  });

  it("accepts a scan alone for a clean change, and a new scan replaces the old one", () => {
    expect(
      report({ securityScan: { summary: "First pass.", checks: checks(["secrets"]) } }),
    ).toMatchObject({
      ok: true,
      text: "Saved:\n- security scan",
    });
    clock = new Date("2026-11-24T11:00:00.000Z");
    report({ securityScan: { summary: "Nothing found.", checks: checks() } });

    const scan = findings.securityScan("r1");
    expect(scan?.summary).toBe("Nothing found.");
    expect(scan?.checks.map((c) => c.status)).toEqual(SECURITY_CATEGORY_ORDER.map(() => "pass"));
    expect(scan?.updatedAt).toBe("2026-11-24T11:00:00.000Z");
    expect(findings.list("r1")).toEqual([]);
  });

  it("broadcasts the scan only with a report that sends one", () => {
    report({ securityScan: { summary: "s", checks: checks() } });
    events = [];
    const outcome = report({
      add: [{ severity: "minor", title: "A", problem: "p", suggestion: "s" }],
    });
    expect(outcome).toMatchObject({ ok: true, scan: null });
    expect(events.map((e) => e.type)).toEqual(["review.findings"]);
  });

  it("keeps the checks in category order whatever order Claude sends", () => {
    report({ securityScan: { summary: "s", checks: checks().reverse() } });
    expect(findings.securityScan("r1")?.checks.map((c) => c.category)).toEqual([
      ...SECURITY_CATEGORY_ORDER,
    ]);
  });

  it("refuses a scan that skips or repeats a category, and saves nothing with it", () => {
    const missing = report({
      add: [{ severity: "major", title: "A", problem: "p", suggestion: "s" }],
      securityScan: { summary: "s", checks: checks().slice(1) },
    });
    expect(missing).toMatchObject({ ok: false });
    expect(missing.text).toContain("add a check for secrets");
    expect(findings.list("r1")).toEqual([]);

    const first = checks()[0];
    const twice = report({
      securityScan: { summary: "s", checks: [...checks().slice(0, 4), first] },
    });
    expect(twice.text).toContain("listed twice");
    expect(findings.securityScan("r1")).toBeNull();
  });

  it("refuses an unknown category", () => {
    const outcome = report({
      add: [{ severity: "major", security: "vibes", title: "A", problem: "p", suggestion: "s" }],
    });
    expect(outcome.ok).toBe(false);
  });

  it("moves a finding into or out of security with an update, keeping it otherwise", () => {
    report({
      add: [{ severity: "major", title: "Token in log line", problem: "p", suggestion: "s" }],
    });
    report({ update: [{ number: 1, security: "sensitive-data" }] });
    expect(findings.list("r1")[0]).toMatchObject({
      securityCategory: "sensitive-data",
      title: "Token in log line",
    });
    report({ update: [{ number: 1, title: "Renamed" }] });
    expect(findings.list("r1")[0]?.securityCategory).toBe("sensitive-data");
    report({ update: [{ number: 1, security: null }] });
    expect(findings.list("r1")[0]?.securityCategory).toBeNull();
  });

  it("does not show the scan of a closed review", () => {
    report({ securityScan: { summary: "s", checks: checks() } });
    markReviewClosed(db, "r1", new Date());
    expect(() => findings.securityScan("r1")).toThrow("Review not found");
  });

  it("tells Claude to scan every category and to report the scan even when clean", () => {
    const prompt = reviewSystemAppend(false);
    for (const category of SECURITY_CATEGORY_ORDER) expect(prompt).toContain(`- ${category}:`);
    expect(prompt).toMatch(/also when nothing was found/);
    expect(prompt).toMatch(/Never repeat a secret's value/);
  });
});
