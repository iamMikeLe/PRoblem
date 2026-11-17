import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ApiErrorSchema,
  DEFAULT_REVIEW_PROMPT,
  ProjectListResponseSchema,
  ProjectSchema,
} from "@reviewroom/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandHome } from "../../../src/modules/projects/paths.ts";
import { git, initRepo, makeTempDir } from "../../gitFixture.ts";
import { createTestApp } from "../../helpers.ts";

function errorCode(response: { json: () => unknown }): string {
  return ApiErrorSchema.parse(response.json()).error.code;
}

describe("/api/projects", () => {
  let app: FastifyInstance;
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
    app = await createTestApp({ userHome: dir });
  });

  afterEach(async () => {
    await app.close();
    await cleanup();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/projects", body });

  it("creates, lists, updates and deletes a project", async () => {
    const created = await create({ path: repo });
    expect(created.statusCode).toBe(201);
    const project = ProjectSchema.parse(created.json());
    expect(project).toMatchObject({
      name: "payments-api",
      path: repo,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
    });

    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(ProjectListResponseSchema.parse(list.json()).projects).toEqual([project]);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      body: { name: "Payments", reviewPrompt: "Look for bugs." },
    });
    expect(patched.statusCode).toBe(200);
    const updated = ProjectSchema.parse(patched.json());
    expect(updated).toMatchObject({ name: "Payments", reviewPrompt: "Look for bugs." });
    expect(updated.updatedAt >= project.updatedAt).toBe(true);

    // Like the web client, DELETE is sent with no body and no content type.
    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");
    const after = await app.inject({ method: "GET", url: "/api/projects" });
    expect(ProjectListResponseSchema.parse(after.json()).projects).toEqual([]);
  });

  it("uses the given name and lists projects by name, ignoring case", async () => {
    const other = join(dir, "other");
    await mkdir(other);
    initRepo(other);
    await create({ path: repo, name: "zeta" });
    await create({ path: other, name: "Alpha" });
    const list = ProjectListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/projects" })).json(),
    );
    expect(list.projects.map((p) => p.name)).toEqual(["Alpha", "zeta"]);
  });

  it("normalizes a subfolder, a trailing slash, a symlink and ~ to the repository root", async () => {
    const first = ProjectSchema.parse((await create({ path: join(repo, "src") })).json());
    expect(first.path).toBe(repo);

    await symlink(repo, join(dir, "link"));
    for (const path of [`${repo}/`, join(dir, "link"), "~/payments-api"]) {
      const response = await create({ path });
      expect(response.statusCode, path).toBe(409);
      expect(errorCode(response)).toBe("project_exists");
    }
  });

  it("rejects relative, missing, file and non-git paths with a clear code", async () => {
    const plain = join(dir, "plain");
    await mkdir(plain);
    await writeFile(join(dir, "file.txt"), "x");

    const cases: [string, number, string][] = [
      ["relative/path", 400, "invalid_path"],
      ["~other/repo", 400, "invalid_path"],
      [join(dir, "missing"), 422, "path_not_found"],
      [join(dir, "file.txt"), 422, "not_a_directory"],
      [plain, 422, "not_a_git_repo"],
    ];
    for (const [path, status, code] of cases) {
      const response = await create({ path });
      expect(response.statusCode, path).toBe(status);
      expect(errorCode(response), path).toBe(code);
    }
  });

  it("rejects a repository whose config points its work tree elsewhere", async () => {
    const elsewhere = join(dir, "elsewhere");
    await mkdir(elsewhere);
    git(repo, "config", "core.worktree", elsewhere);

    const response = await create({ path: repo });
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("outside_repository");
  });

  it("keeps trailing spaces in the repository root git reports", async () => {
    // The request path itself is trimmed (pasted input), so reach the root via a subfolder.
    const spaced = join(dir, "My Repo ");
    await mkdir(join(spaced, "src"), { recursive: true });
    initRepo(spaced);
    const response = await create({ path: join(spaced, "src"), name: "Spaced" });
    expect(response.statusCode).toBe(201);
    expect(ProjectSchema.parse(response.json()).path).toBe(spaced);
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports an unreadable path as path_not_accessible",
    async () => {
      const locked = join(dir, "locked");
      await mkdir(join(locked, "inner"), { recursive: true });
      await chmod(locked, 0o000);
      try {
        const response = await create({ path: join(locked, "inner") });
        expect(response.statusCode).toBe(422);
        expect(errorCode(response)).toBe("path_not_accessible");
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );

  it("rejects invalid bodies with invalid_request", async () => {
    expect(errorCode(await create({}))).toBe("invalid_request");
    const project = ProjectSchema.parse((await create({ path: repo })).json());
    for (const body of [{}, { path: "/elsewhere" }, { reviewPrompt: "  " }]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        body,
      });
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe("invalid_request");
    }
  });

  it("returns project_not_found for unknown ids", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/projects/nope",
      body: { name: "x" },
    });
    expect(patch.statusCode).toBe(404);
    expect(errorCode(patch)).toBe("project_not_found");
    const del = await app.inject({ method: "DELETE", url: "/api/projects/nope" });
    expect(del.statusCode).toBe(404);
    expect(errorCode(del)).toBe("project_not_found");
  });

  it("answers malformed JSON and unknown routes with the ApiError shape", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(malformed.statusCode).toBe(400);
    expect(errorCode(malformed)).toBe("invalid_request");

    const unknown = await app.inject({ method: "GET", url: "/api/nothing" });
    expect(unknown.statusCode).toBe(404);
    expect(errorCode(unknown)).toBe("not_found");
  });

  it("refuses a create from a foreign browser origin", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { origin: "https://evil.example" },
      body: { path: repo },
    });
    expect(response.statusCode).toBe(403);
    const list = ProjectListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/projects" })).json(),
    );
    expect(list.projects).toEqual([]);
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
