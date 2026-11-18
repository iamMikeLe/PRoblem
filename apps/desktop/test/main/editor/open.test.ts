import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDITOR_TEMPLATES } from "@problem/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEditorCommand,
  createEditorOpener,
  type Launcher,
  resolveProgram,
  resolveReviewFile,
} from "../../../src/main/editor/open.ts";

describe("opening a file in the editor", () => {
  let base: string;
  let workdir: string;
  let bin: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "problem-editor-")));
    workdir = join(base, "repo");
    bin = join(base, "bin");
    mkdirSync(join(workdir, "src"), { recursive: true });
    mkdirSync(join(workdir, ".git"));
    mkdirSync(join(workdir, "sub", ".git"), { recursive: true });
    writeFileSync(join(workdir, "sub", ".git", "HEAD"), "x");
    mkdirSync(bin);
    writeFileSync(join(workdir, "src", "a b.ts"), "x");
    writeFileSync(join(workdir, ".git", "config"), "x");
    writeFileSync(join(base, "secret.txt"), "x");
    for (const name of ["code", "idea"]) {
      writeFileSync(join(bin, name), "#!/bin/sh\n");
      chmodSync(join(bin, name), 0o755);
    }
    writeFileSync(join(bin, "notexec"), "");
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("fills placeholders inside words, never splitting or re-reading inserted text", () => {
    const target = { file: "/r/a {line} --x.ts", line: 7, dir: "/r" };
    expect(buildEditorCommand(EDITOR_TEMPLATES.vscode, target)).toEqual({
      program: "code",
      args: ["--goto", "/r/a {line} --x.ts:7"],
    });
    expect(buildEditorCommand("subl {dir} {file}", target).args).toEqual([
      "/r",
      "/r/a {line} --x.ts",
    ]);
    expect(buildEditorCommand(EDITOR_TEMPLATES.idea, target)).toEqual({
      program: "idea",
      args: ["--line", "7", "/r/a {line} --x.ts"],
    });
    expect(() => buildEditorCommand("{file}", target)).toThrow(
      expect.objectContaining({ code: "editor_failed" }),
    );
  });

  it("only opens real files inside the review's folder, outside its .git", () => {
    expect(resolveReviewFile(workdir, "src/a b.ts")).toBe(join(workdir, "src", "a b.ts"));
    symlinkSync(join(base, "secret.txt"), join(workdir, "link.txt"));
    for (const file of [
      "../secret.txt",
      join(base, "secret.txt"),
      "~/x",
      ".git/config",
      "link.txt",
    ]) {
      expect(() => resolveReviewFile(workdir, file), file).toThrow(
        expect.objectContaining({ code: "outside_repository" }),
      );
    }
    expect(() => resolveReviewFile(workdir, "src/missing.ts")).toThrow(
      expect.objectContaining({ code: "file_not_found" }),
    );
    expect(() => resolveReviewFile(workdir, "src")).toThrow(
      expect.objectContaining({ code: "file_not_found" }),
    );
  });

  it("finds the program on PATH or by absolute path, never relative to a folder", () => {
    expect(resolveProgram("code", bin)).toBe(join(bin, "code"));
    expect(resolveProgram(join(bin, "idea"), undefined)).toBe(join(bin, "idea"));
    for (const program of ["cursor", "notexec", "./code", "bin/code"]) {
      expect(() => resolveProgram(program, bin), program).toThrow(
        expect.objectContaining({ code: "editor_not_found" }),
      );
    }
  });

  it("launches the resolved program with the filled-in arguments, started from the home folder", async () => {
    const launch = vi.fn<Launcher>(async () => {});
    const opener = createEditorOpener({
      template: () => EDITOR_TEMPLATES.vscode,
      workdirOf: () => workdir,
      path: () => bin,
      home: base,
      launch,
    });
    await opener.open({ id: "r1", file: "src/a b.ts", line: 12 });
    await opener.open({ id: "r1", file: "src/a b.ts", line: null });
    expect(launch.mock.calls).toEqual([
      [join(bin, "code"), ["--goto", `${join(workdir, "src", "a b.ts")}:12`], base],
      [join(bin, "code"), ["--goto", `${join(workdir, "src", "a b.ts")}:1`], base],
    ]);
  });

  it("reports a program that fails to start", async () => {
    const opener = createEditorOpener({
      template: () => "code {file}",
      workdirOf: () => workdir,
      path: () => bin,
      home: base,
      launch: async () => {
        throw new Error("spawn EACCES");
      },
    });
    await expect(opener.open({ id: "r1", file: "src/a b.ts", line: 1 })).rejects.toMatchObject({
      code: "editor_failed",
      message: "Could not start code: spawn EACCES",
    });
  });
});
