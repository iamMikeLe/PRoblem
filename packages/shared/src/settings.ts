import { z } from "zod";

/**
 * App-wide settings, stored by the main process. Today only the editor that `file:line` links
 * open (ADR 0011).
 */

/** Editors with a known command line, plus `custom` for the user's own template. */
export const EditorPresetSchema = z.enum(["vscode", "cursor", "zed", "idea", "webstorm", "custom"]);
export type EditorPreset = z.infer<typeof EditorPresetSchema>;

/**
 * Command templates, split into arguments at spaces *before* the placeholders are filled in, so a
 * file name can never become a separate argument. `{file}` is the absolute path of the file,
 * `{line}` its line (1 when the finding has none), `{dir}` the review's folder (risky: an editor
 * that opens it as a workspace loads the pull request's own editor settings and tasks).
 */
export const EDITOR_TEMPLATES: Record<Exclude<EditorPreset, "custom">, string> = {
  // Only the file, never `{dir}`: opening the checkout as a workspace would load the PR's own
  // editor config (`.vscode/tasks.json` can run commands when a folder opens). ADR 0011.
  vscode: "code --goto {file}:{line}",
  cursor: "cursor --goto {file}:{line}",
  zed: "zed {file}:{line}",
  idea: "idea --line {line} {file}",
  webstorm: "webstorm --line {line} {file}",
};

export const EDITOR_LABELS: Record<EditorPreset, string> = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
  zed: "Zed",
  idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
  custom: "Custom command",
};

export const EDITOR_TEMPLATE_MAX = 500;

export const EditorTemplateSchema = z
  .string()
  .trim()
  .min(1, "Enter a command.")
  .max(EDITOR_TEMPLATE_MAX)
  .refine((value) => value.includes("{file}"), "The command must contain {file}.")
  .refine(
    (value) => !(value.split(/\s+/)[0] ?? "").includes("{"),
    "The program (first word) cannot be a placeholder.",
  );

export const AppSettingsSchema = z.object({
  editor: z.object({
    preset: EditorPresetSchema,
    /** The user's template, used when `preset` is `custom` (kept when switching back and forth). */
    customTemplate: z.string(),
  }),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  editor: { preset: "vscode", customTemplate: "" },
};

export const UpdateSettingsRequestSchema = z.strictObject({
  editor: z
    .strictObject({
      preset: EditorPresetSchema,
      customTemplate: z.union([z.literal(""), EditorTemplateSchema]),
    })
    .refine((value) => value.preset !== "custom" || value.customTemplate !== "", {
      message: "Enter a command for the custom editor.",
      path: ["customTemplate"],
    }),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

/** The template that is in effect for these settings. */
export function editorTemplate(settings: AppSettings): string {
  const { preset, customTemplate } = settings.editor;
  return preset === "custom" ? customTemplate : EDITOR_TEMPLATES[preset];
}
