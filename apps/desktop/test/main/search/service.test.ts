import type { DatabaseSync } from "node:sqlite";
import type { ChangedFile } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/main/db/database.ts";
import { silentLogger } from "../../../src/main/errors.ts";
import { insertFinding, withdrawFinding } from "../../../src/main/findings/repository.ts";
import { markReviewClosed } from "../../../src/main/reviews/repository.ts";
import { createSearchService, excerpt } from "../../../src/main/search/service.ts";
import { addReview } from "../findings/fixture.ts";

const at = new Date("2026-11-18T10:00:00.000Z");
const changed = (path: string): ChangedFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
});

describe("search", () => {
  let db: DatabaseSync;
  let files: Record<string, ChangedFile[] | Error>;
  const changes = {
    files: vi.fn(async (id: string) => {
      const list = files[id] ?? [];
      if (list instanceof Error) throw list;
      return { fromSha: "c".repeat(40), toSha: "a".repeat(40), files: list };
    }),
  };
  const search = () => createSearchService({ db, changes, log: silentLogger });
  const finding = (reviewId: string, title: string, problem = "p", file: string | null = null) =>
    insertFinding(
      db,
      reviewId,
      { severity: "major", title, file, line: null, problem, suggestion: "", reproduction: "" },
      at,
    );
  const retitle = (id: string, title: string) =>
    db.prepare("UPDATE reviews SET title = ? WHERE id = ?").run(title, id);

  beforeEach(() => {
    db = openDatabase(":memory:");
    files = {};
    changes.files.mockClear();
    addReview(db, "r1", "/w/r1");
    addReview(db, "r2", "/w/r2");
    retitle("r1", "Retry webhooks");
    retitle("r2", "Billing export");
  });
  afterEach(() => db.close());

  it("finds reviews by title, branch and project, needing every word in any case", async () => {
    expect((await search().query("RETRY")).reviews.map((r) => r.reviewId)).toEqual(["r1"]);
    expect((await search().query("p-r2 feature")).reviews.map((r) => r.reviewId)).toEqual(["r2"]);
    expect((await search().query("retry billing")).reviews).toEqual([]);
    expect((await search().query("billing")).reviews[0]).toEqual({
      reviewId: "r2",
      title: "Billing export",
      detail: "p-r2 · feature → main",
    });
  });

  it("ranks title matches first, then paths, then the problem text, with an excerpt", async () => {
    finding("r1", "Timeout is ignored", "The client waits forever on a slow timeout response.");
    finding("r1", "Unsafe cast", "p", "src/timeout.ts");
    finding("r2", "Timeout too long");
    const hits = (await search().query("timeout")).findings;
    expect(hits.map((h) => [h.reviewId, h.number, h.excerpt])).toEqual([
      ["r1", 1, null],
      ["r2", 1, null],
      ["r1", 2, "src/timeout.ts"],
    ]);

    const inProblem = (await search().query("forever")).findings[0];
    expect(inProblem).toMatchObject({ number: 1, reviewTitle: "Retry webhooks" });
    expect(inProblem?.excerpt).toContain("waits forever");
  });

  it("leaves out withdrawn findings and closed reviews", async () => {
    finding("r1", "Retry storm");
    withdrawFinding(db, "r1", 1, "fixed", at);
    finding("r2", "Retry storm");
    markReviewClosed(db, "r2");
    files = { r2: [changed("src/retry.ts")] };
    const results = await search().query("retry");
    expect(results.findings).toEqual([]);
    expect(results.reviews.map((r) => r.reviewId)).toEqual(["r1"]);
    expect(results.files).toEqual([]);
  });

  it("finds changed files, file names first, and skips a review whose files cannot be read", async () => {
    files = {
      r1: [changed("src/payments/client.ts"), changed("payments/readme.md"), changed("x.ts")],
      r2: new Error("not a git folder"),
    };
    const hits = (await search().query("payments")).files;
    expect(hits.map((h) => h.path)).toEqual(["src/payments/client.ts", "payments/readme.md"]);
    expect((await search().query("readme")).files).toEqual([
      { reviewId: "r1", reviewTitle: "Retry webhooks", path: "payments/readme.md" },
    ]);
  });

  it("returns at most 8 hits per group", async () => {
    for (let i = 0; i < 12; i++) finding("r1", `Leak ${i}`);
    files = { r1: Array.from({ length: 12 }, (_, i) => changed(`leak/${i}.ts`)) };
    const results = await search().query("leak");
    expect(results.findings).toHaveLength(8);
    expect(results.files).toHaveLength(8);
  });

  it("cuts an excerpt to one line around the first word found", () => {
    const text = `${"a ".repeat(100)}needle\n\nafter ${"b ".repeat(100)}`;
    const cut = excerpt(text, ["needle"]);
    expect(cut.startsWith("…")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).toContain("needle after");
    expect(excerpt("short text", ["text"])).toBe("short text");
  });
});
