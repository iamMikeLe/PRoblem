import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, schemaVersion } from "../src/db/database.ts";
import { migrations } from "../src/db/migrations.ts";

describe("openDatabase", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("applies every migration once", () => {
    const db = openDatabase(":memory:");
    expect(schemaVersion(db)).toBe(migrations.at(-1)?.version);
    db.close();
  });

  it("rolls back a failing migration and reports which one failed", () => {
    expect(() =>
      openDatabase(":memory:", [{ version: 1, name: "broken", sql: "CREATE TABLE (" }]),
    ).toThrow(/Migration 1 \(broken\) failed/);
  });

  it("backfills projects.updated_at from created_at for existing rows", async () => {
    dir = await mkdtemp(join(tmpdir(), "reviewroom-db-"));
    const file = join(dir, "test.db");

    const v1 = openDatabase(file, migrations.slice(0, 1));
    v1.prepare(
      "INSERT INTO projects (id, name, path, review_prompt, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("p1", "a", "/repos/a", "prompt", "2026-01-01T00:00:00.000Z");
    v1.close();

    const latest = openDatabase(file);
    const row = latest.prepare("SELECT updated_at FROM projects WHERE id = ?").get("p1");
    expect(row?.updated_at).toBe("2026-01-01T00:00:00.000Z");
    latest.close();
  });
});
