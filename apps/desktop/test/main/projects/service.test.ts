import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_REVIEW_PROMPT } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/database.ts";
import { AppFailure, silentLogger } from "../../../src/main/errors.ts";
import { expandHome } from "../../../src/main/projects/paths.ts";
import { createProjectService, type ProjectService } from "../../../src/main/projects/service.ts";
import { git, initRepo, makeTempDir } from "../gitFixture.ts";

/** Resolves with the failure code, or fails the test if the call succeeds. */
async function failureCode(action: () => unknown): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppFailure) return error.code;
    throw error;
  }
  throw new Error("expected an AppFailure");
}

describe("project service", () => {
  let db: DatabaseSync;
  let projects: ProjectService;
  let dir: string;
  let repo: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const temp = await makeTempDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    repo = join(dir, "payments-api");
    await mkdir(join(repo, "src"), { recursive: true });
    initRepo(repo);
    db = openDatabase(":memory:");
    projects = createProjectService({ db, home: dir, log: silentLogger });
  });

  afterEach(async () => {
    db.close();
    await cleanup();
  });

  it("creates, lists, updates and removes a project", async () => {
    const project = await projects.create({ path: repo });
    expect(project).toMatchObject({
      name: "payments-api",
      path: repo,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
    });
    expect(projects.list()).toEqual([project]);

    const updated = projects.update(project.id, {
      name: "Payments",
      reviewPrompt: "Look for bugs.",
    });
    expect(updated).toMatchObject({ name: "Payments", reviewPrompt: "Look for bugs." });
    expect(updated.updatedAt >= project.updatedAt).toBe(true);

    projects.remove(project.id);
    expect(projects.list()).toEqual([]);
  });

  it("uses the given name and lists projects by name, ignoring case", async () => {
    const other = join(dir, "other");
    await mkdir(other);
    initRepo(other);
    await projects.create({ path: repo, name: "zeta" });
    await projects.create({ path: other, name: "Alpha" });
    expect(projects.list().map((p) => p.name)).toEqual(["Alpha", "zeta"]);
  });

  it("normalizes a subfolder, a trailing slash, a symlink and ~ to the repository root", async () => {
    const first = await projects.create({ path: join(repo, "src") });
    expect(first.path).toBe(repo);

    await symlink(repo, join(dir, "link"));
    for (const path of [`${repo}/`, join(dir, "link"), "~/payments-api"]) {
      expect(await failureCode(() => projects.create({ path })), path).toBe("project_exists");
    }
  });

  it("rejects relative, missing, file and non-git paths with a clear code", async () => {
    const plain = join(dir, "plain");
    await mkdir(plain);
    await writeFile(join(dir, "file.txt"), "x");

    const cases: [string, string][] = [
      ["relative/path", "invalid_path"],
      ["~other/repo", "invalid_path"],
      [join(dir, "missing"), "path_not_found"],
      [join(dir, "file.txt"), "not_a_directory"],
      [plain, "not_a_git_repo"],
    ];
    for (const [path, code] of cases) {
      expect(await failureCode(() => projects.create({ path })), path).toBe(code);
    }
  });

  it("rejects a repository whose config points its work tree elsewhere", async () => {
    const elsewhere = join(dir, "elsewhere");
    await mkdir(elsewhere);
    git(repo, "config", "core.worktree", elsewhere);
    expect(await failureCode(() => projects.create({ path: repo }))).toBe("outside_repository");
  });

  it("keeps trailing spaces in the repository root git reports", async () => {
    // Input paths are trimmed by the contract, so reach the root via a subfolder.
    const spaced = join(dir, "My Repo ");
    await mkdir(join(spaced, "src"), { recursive: true });
    initRepo(spaced);
    const project = await projects.create({ path: join(spaced, "src"), name: "Spaced" });
    expect(project.path).toBe(spaced);
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports an unreadable path as path_not_accessible",
    async () => {
      const locked = join(dir, "locked");
      await mkdir(join(locked, "inner"), { recursive: true });
      await chmod(locked, 0o000);
      try {
        const code = await failureCode(() => projects.create({ path: join(locked, "inner") }));
        expect(code).toBe("path_not_accessible");
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );

  it("returns project_not_found for unknown ids", async () => {
    expect(await failureCode(() => projects.update("nope", { name: "x" }))).toBe(
      "project_not_found",
    );
    expect(await failureCode(() => projects.remove("nope"))).toBe("project_not_found");
  });
});

describe("expandHome", () => {
  it("expands only a leading ~ or ~/", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/code", "/home/me")).toBe("/home/me/code");
    expect(expandHome("~bob/code", "/home/me")).toBe("~bob/code");
    expect(expandHome("/abs/~/x", "/home/me")).toBe("/abs/~/x");
  });
});
