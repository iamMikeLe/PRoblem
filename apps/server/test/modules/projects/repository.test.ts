import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/db/database.ts";
import {
  insertProject,
  isUniqueViolation,
  listProjects,
} from "../../../src/modules/projects/repository.ts";

describe("projects repository", () => {
  it("rejects a second project with the same path as a UNIQUE violation", () => {
    const db = openDatabase(":memory:");
    const input = { name: "a", path: "/repos/a", reviewPrompt: "p" };
    insertProject(db, input);

    let caught: unknown;
    try {
      insertProject(db, { ...input, name: "b" });
    } catch (error) {
      caught = error;
    }
    expect(isUniqueViolation(caught)).toBe(true);
    expect(isUniqueViolation(new Error("other"))).toBe(false);
    expect(listProjects(db)).toHaveLength(1);
    db.close();
  });
});
