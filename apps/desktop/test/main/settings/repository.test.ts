import { DEFAULT_SETTINGS, editorTemplate, UpdateSettingsRequestSchema } from "@reviewroom/shared";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/database.ts";
import { getSettings, updateSettings } from "../../../src/main/settings/repository.ts";

describe("settings", () => {
  it("defaults to VS Code and stores the editor choice", () => {
    const db = openDatabase(":memory:");
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(editorTemplate(getSettings(db))).toBe("code --goto {file}:{line}");

    const saved = updateSettings(db, {
      editor: { preset: "custom", customTemplate: "subl {file}:{line}" },
    });
    expect(saved.editor).toEqual({ preset: "custom", customTemplate: "subl {file}:{line}" });
    expect(editorTemplate(getSettings(db))).toBe("subl {file}:{line}");
    db.close();
  });

  it("falls back to the default when the stored value is unreadable", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('editor', ?)").run("{not json");
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
    db.prepare("UPDATE app_settings SET value = ?").run(JSON.stringify({ preset: "emacs" }));
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
    db.close();
  });

  it("validates custom templates", () => {
    const parse = (preset: string, customTemplate: string) =>
      UpdateSettingsRequestSchema.safeParse({ editor: { preset, customTemplate } }).success;
    expect(parse("custom", "subl {file}")).toBe(true);
    expect(parse("vscode", "")).toBe(true);
    expect(parse("custom", "")).toBe(false);
    expect(parse("custom", "subl")).toBe(false);
    expect(parse("custom", "{file}")).toBe(false);
  });
});
