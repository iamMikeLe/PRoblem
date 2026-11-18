import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/main/db/database.ts";
import { silentLogger } from "../../src/main/errors.ts";
import { repairWorktree } from "../../src/main/git/worktree.ts";
import { migrateLegacyDataDir, relocateReviews } from "../../src/main/legacy.ts";
import { insertProject } from "../../src/main/projects/repository.ts";
import { getReviewRecord, markReviewClosed } from "../../src/main/reviews/repository.ts";
import { addReview } from "./findings/fixture.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
  })
    .toString()
    .trim();

describe("moving the ReviewRoom data folder (rename to PRoblem)", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "problem-legacy-")));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("moves ~/.reviewroom with its database files once, only for the default location", () => {
    const old = join(home, ".reviewroom");
    mkdirSync(join(old, "worktrees"), { recursive: true });
    for (const name of ["reviewroom.db", "reviewroom.db-wal", "reviewroom.db-shm"]) {
      writeFileSync(join(old, name), name);
    }
    const target = join(home, ".problem");

    expect(
      migrateLegacyDataDir({ PROBLEM_HOME: "/elsewhere" }, home, "/elsewhere", "problem.db"),
    ).toBeUndefined();
    expect(existsSync(old)).toBe(true);

    expect(migrateLegacyDataDir({}, home, target, "problem.db")).toBe(old);
    expect(existsSync(old)).toBe(false);
    for (const name of ["problem.db", "problem.db-wal", "problem.db-shm"]) {
      expect(existsSync(join(target, name)), name).toBe(true);
    }
    expect(existsSync(join(target, "worktrees"))).toBe(true);
    // Second start: nothing left to move.
    expect(migrateLegacyDataDir({}, home, target, "problem.db")).toBeUndefined();
  });

  it("leaves an existing new folder alone", () => {
    mkdirSync(join(home, ".reviewroom"));
    mkdirSync(join(home, ".problem"));
    expect(migrateLegacyDataDir({}, home, join(home, ".problem"), "problem.db")).toBeUndefined();
    expect(existsSync(join(home, ".reviewroom"))).toBe(true);
  });

  it("points reviews at the moved folder and repairs their git worktrees", async () => {
    const repo = join(home, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "a");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base");
    const old = join(home, ".reviewroom");
    const oldWorktree = join(old, "worktrees", "p1", "r1");
    git(repo, "worktree", "add", "-q", "--detach", oldWorktree, "HEAD");

    const db = openDatabase(":memory:");
    const project = insertProject(db, { name: "repo", path: repo, reviewPrompt: "x" });
    const open = addReview(db, "r1", oldWorktree);
    db.prepare("UPDATE reviews SET project_id = ? WHERE id = ?").run(project.id, open.id);
    const closed = addReview(db, "r2", join(old, "worktrees", "p1", "r2"));
    markReviewClosed(db, closed.id);
    addReview(db, "r3", repo);

    const target = join(home, ".problem");
    expect(migrateLegacyDataDir({}, home, target, "problem.db")).toBe(old);
    await relocateReviews(db, old, target, repairWorktree, silentLogger);

    const moved = join(target, "worktrees", "p1", "r1");
    expect(getReviewRecord(db, "r1")?.review.workdir).toBe(moved);
    expect(getReviewRecord(db, "r2")?.review.workdir).toBe(join(target, "worktrees", "p1", "r2"));
    expect(getReviewRecord(db, "r3")?.review.workdir).toBe(repo);
    // git works in the moved worktree, and the repository knows where it is now.
    expect(git(moved, "status", "--porcelain")).toBe("");
    expect(git(repo, "worktree", "list", "--porcelain")).toContain(`worktree ${moved}`);
    db.close();
  });
});
