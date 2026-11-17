import { describe, expect, it } from "vitest";
import { openDatabase, schemaVersion } from "../src/db/database.ts";
import { migrations } from "../src/db/migrations.ts";

describe("openDatabase", () => {
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
});
