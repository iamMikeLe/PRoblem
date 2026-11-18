import type { DatabaseSync } from "node:sqlite";
import {
  type AppSettings,
  AppSettingsSchema,
  DEFAULT_SETTINGS,
  type UpdateSettingsRequest,
} from "@reviewroom/shared";
import { z } from "zod";

/** App settings as one JSON value per section (`app_settings` table). */
const EditorSchema = AppSettingsSchema.shape.editor;

export function getSettings(db: DatabaseSync): AppSettings {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'editor'").get();
  const value = z.object({ value: z.string() }).safeParse(row);
  if (!value.success) return DEFAULT_SETTINGS;
  // A value from an older or newer version that no longer parses falls back to the default.
  let json: unknown;
  try {
    json = JSON.parse(value.data.value);
  } catch {
    return DEFAULT_SETTINGS;
  }
  const editor = EditorSchema.safeParse(json);
  return editor.success ? { editor: editor.data } : DEFAULT_SETTINGS;
}

export function updateSettings(db: DatabaseSync, request: UpdateSettingsRequest): AppSettings {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('editor', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(request.editor));
  return getSettings(db);
}
