import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppEvent } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertActivity } from "../../../src/main/activity/repository.ts";
import { type ActivityService, createActivityService } from "../../../src/main/activity/service.ts";
import { openDatabase } from "../../../src/main/db/database.ts";
import { silentLogger } from "../../../src/main/errors.ts";
import { markReviewClosed } from "../../../src/main/reviews/repository.ts";
import { addReview } from "../findings/fixture.ts";

describe("activity", () => {
  let db: DatabaseSync;
  let dir: string;
  let events: AppEvent[];
  let activity: ActivityService;
  let clock: Date;
  const tick = () => {
    clock = new Date(clock.getTime() + 1000);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "problem-activity-"));
    db = openDatabase(":memory:");
    events = [];
    clock = new Date("2026-11-19T10:00:00.000Z");
    activity = createActivityService({
      db,
      broadcast: (event) => events.push(event),
      log: silentLogger,
      now: () => clock,
    });
    addReview(db, "r1", dir);
    addReview(db, "r2", dir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists rows of open reviews newest first, with their review and project", () => {
    activity.record("r1", { kind: "approval", toolName: "Bash" });
    tick();
    activity.record("r2", { kind: "failed", message: "Too many turns" });

    expect(activity.list()).toEqual([
      {
        id: expect.any(String),
        reviewId: "r2",
        reviewTitle: "Retry webhooks",
        projectName: "p-r2",
        at: "2026-11-19T10:00:01.000Z",
        read: false,
        detail: { kind: "failed", message: "Too many turns" },
      },
      expect.objectContaining({ reviewId: "r1", detail: { kind: "approval", toolName: "Bash" } }),
    ]);
    expect(events).toEqual([{ type: "activity.changed" }, { type: "activity.changed" }]);

    // A closed review's rows leave the feed.
    markReviewClosed(db, "r2");
    expect(activity.list().map((item) => item.reviewId)).toEqual(["r1"]);
  });

  it("marks chosen rows, or all of them, as read; telling the window only when something changed", () => {
    activity.record("r1", { kind: "approval", toolName: "Bash" });
    activity.record("r2", { kind: "approval", toolName: "Edit" });
    const [first] = activity.list();
    events = [];

    activity.markRead({ ids: [first?.id ?? ""] });
    expect(activity.list().map((item) => item.read)).toEqual([true, false]);
    activity.markRead({ ids: [first?.id ?? ""] });
    expect(events).toHaveLength(1);

    activity.markRead({});
    expect(activity.list().every((item) => item.read)).toBe(true);
    expect(events).toHaveLength(2);
  });

  it("resolves a review's rows of one kind (answered approvals)", () => {
    activity.record("r1", { kind: "approval", toolName: "Bash" });
    activity.record("r1", { kind: "failed", message: "x" });
    activity.record("r2", { kind: "approval", toolName: "Bash" });

    activity.resolve("r1", "approval");

    const unread = activity
      .list()
      .filter((item) => !item.read)
      .map((item) => [item.reviewId, item.detail.kind]);
    expect(unread).toEqual(
      expect.arrayContaining([
        ["r1", "failed"],
        ["r2", "approval"],
      ]),
    );
    expect(unread).toHaveLength(2);
  });

  it("returns the newest row of a kind, with its time", () => {
    expect(activity.last("r1", "commits")).toBeUndefined();
    activity.record("r1", { kind: "commits", newCommits: 1, latestSha: "a", rewritten: false });
    tick();
    activity.record("r1", { kind: "commits", newCommits: 2, latestSha: "b", rewritten: false });
    activity.record("r2", { kind: "commits", newCommits: 9, latestSha: "z", rewritten: true });

    expect(activity.last("r1", "commits")).toEqual({
      detail: { kind: "commits", newCommits: 2, latestSha: "b", rewritten: false },
      at: "2026-11-19T10:00:01.000Z",
    });
  });

  it("keeps only the newest rows", () => {
    for (let index = 0; index < 5; index++) {
      insertActivity(db, "r1", { kind: "failed", message: `#${index}` }, clock, 3);
      tick();
    }
    expect(activity.list().map((item) => item.detail)).toEqual([
      { kind: "failed", message: "#4" },
      { kind: "failed", message: "#3" },
      { kind: "failed", message: "#2" },
    ]);
  });

  it("skips rows it cannot read, and never throws from record", () => {
    db.prepare(
      "INSERT INTO activity (id, review_id, kind, detail, at) VALUES ('x', 'r1', 'future', '{\"kind\":\"future\"}', ?)",
    ).run(clock.toISOString());
    activity.record("r1", { kind: "approval", toolName: "Bash" });
    expect(activity.list().map((item) => item.detail.kind)).toEqual(["approval"]);

    // A review that does not exist breaks the foreign key: logged, not thrown.
    expect(() => activity.record("nope", { kind: "approval", toolName: "Bash" })).not.toThrow();
  });
});
