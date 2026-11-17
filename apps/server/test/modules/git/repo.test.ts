import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitUnavailableError,
  gitEnv,
  NotAGitRepoError,
  resolveRepoRoot,
} from "../../../src/modules/git/repo.ts";
import { git, initRepo, makeTempDir } from "../../gitFixture.ts";

describe("resolveRepoRoot", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function tempDir(): Promise<string> {
    const temp = await makeTempDir();
    cleanup = temp.cleanup;
    return temp.dir;
  }

  it("returns the root of a repository", async () => {
    const dir = await tempDir();
    initRepo(dir);
    expect(await resolveRepoRoot(dir)).toBe(dir);
  });

  it("normalizes a subfolder and a symlink to the root", async () => {
    const dir = await tempDir();
    const repo = join(dir, "repo");
    await mkdir(join(repo, "src", "deep"), { recursive: true });
    initRepo(repo);
    await symlink(repo, join(dir, "link"));

    expect(await resolveRepoRoot(join(repo, "src", "deep"))).toBe(repo);
    expect(await resolveRepoRoot(join(dir, "link"))).toBe(repo);
  });

  it("rejects a plain folder, a bare repository and the .git folder", async () => {
    const dir = await tempDir();
    const plain = join(dir, "plain");
    const bare = join(dir, "bare.git");
    const repo = join(dir, "repo");
    await mkdir(plain);
    await mkdir(repo);
    git(dir, "init", "--quiet", "--bare", bare);
    initRepo(repo);

    await expect(resolveRepoRoot(plain)).rejects.toBeInstanceOf(NotAGitRepoError);
    await expect(resolveRepoRoot(bare)).rejects.toBeInstanceOf(NotAGitRepoError);
    await expect(resolveRepoRoot(join(repo, ".git"))).rejects.toBeInstanceOf(NotAGitRepoError);
  });

  it("treats a linked worktree as its own root", async () => {
    const dir = await tempDir();
    const repo = join(dir, "repo");
    const linked = join(dir, "linked");
    await mkdir(repo);
    initRepo(repo);
    git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);

    expect(await resolveRepoRoot(linked)).toBe(linked);
  });
});

describe("resolveRepoRoot without git", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a missing git binary as GitUnavailableError, not as 'not a repo'", async () => {
    vi.stubEnv("PATH", "/nonexistent");
    await expect(resolveRepoRoot(process.cwd())).rejects.toBeInstanceOf(GitUnavailableError);
  });
});

describe("gitEnv", () => {
  it("drops every GIT_* variable and keeps the rest", () => {
    expect(gitEnv({ GIT_DIR: "/evil", GIT_WORK_TREE: "/evil", PATH: "/bin" })).toEqual({
      PATH: "/bin",
    });
  });
});
