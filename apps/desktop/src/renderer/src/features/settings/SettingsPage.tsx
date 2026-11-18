import {
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Radio,
  RadioGroup,
  Spinner,
  Subtitle1,
  Subtitle2,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  type AppSettings,
  EDITOR_LABELS,
  EDITOR_TEMPLATES,
  type EditorPreset,
  EditorPresetSchema,
  UpdateSettingsRequestSchema,
} from "@problem/shared";
import { useState } from "react";
import { useSettings, useUpdateSettings } from "./queries.ts";

const useStyles = makeStyles({
  root: {
    gridColumn: "2 / -1",
    gridRow: "2",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    maxWidth: "640px",
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
  },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  command: { fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" },
});

/** App-wide settings. Today: which editor opens `file:line` links. */
export function SettingsPage() {
  const styles = useStyles();
  const settings = useSettings();
  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <Subtitle1 as="h2">Settings</Subtitle1>
        {settings.error && (
          <MessageBar intent="error">
            <MessageBarBody>Could not load the settings: {settings.error.message}</MessageBarBody>
          </MessageBar>
        )}
        {settings.isLoading && <Spinner size="small" label="Loading" />}
        {settings.data && <EditorSettings saved={settings.data} />}
      </div>
    </main>
  );
}

function EditorSettings({ saved }: { saved: AppSettings }) {
  const styles = useStyles();
  const update = useUpdateSettings();
  const [preset, setPreset] = useState<EditorPreset>(saved.editor.preset);
  const [customTemplate, setCustomTemplate] = useState(saved.editor.customTemplate);
  const [touched, setTouched] = useState(false);

  const request = { editor: { preset, customTemplate: customTemplate.trim() } };
  const parsed = UpdateSettingsRequestSchema.safeParse(request);
  const problem = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const changed =
    preset !== saved.editor.preset || customTemplate.trim() !== saved.editor.customTemplate;

  return (
    <section className={styles.section} aria-labelledby="editor-heading">
      <Subtitle2 as="h3" id="editor-heading">
        Editor
      </Subtitle2>
      <Text className={styles.muted}>
        Where file:line links in findings open. PRoblem runs the editor's command-line launcher,
        which must be on your PATH.
      </Text>
      <RadioGroup
        aria-labelledby="editor-heading"
        value={preset}
        onChange={(_, data) => {
          const value = EditorPresetSchema.safeParse(data.value);
          if (value.success) setPreset(value.data);
        }}
      >
        {EditorPresetSchema.options.map((option) => (
          <Radio
            key={option}
            value={option}
            label={
              <>
                {EDITOR_LABELS[option]}
                {option !== "custom" && (
                  <Caption1 className={styles.command}> · {EDITOR_TEMPLATES[option]}</Caption1>
                )}
              </>
            }
          />
        ))}
      </RadioGroup>
      {preset === "custom" && (
        <Field
          label="Command"
          hint="Placeholders: {file} (absolute path), {line}, {dir} (the review's folder). Words are split at spaces; no shell is used."
          validationMessage={touched ? (problem ?? null) : null}
        >
          <Input
            value={customTemplate}
            placeholder="subl {file}:{line}"
            onChange={(_, data) => setCustomTemplate(data.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
      )}
      {preset === "custom" && customTemplate.includes("{dir}") && (
        <MessageBar intent="warning">
          <MessageBarBody>
            {"{dir}"} opens the pull request's folder as a project. Editors then load its own
            settings and tasks, which can run commands. Prefer opening only {"{file}"}.
          </MessageBarBody>
        </MessageBar>
      )}
      {update.error && (
        <MessageBar intent="error">
          <MessageBarBody>{update.error.message}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.actions}>
        <Button
          appearance="primary"
          disabledFocusable={!changed || !parsed.success || update.isPending}
          onClick={() => {
            setTouched(true);
            if (parsed.success) update.mutate(parsed.data);
          }}
        >
          Save
        </Button>
        {update.isSuccess && !changed && <Caption1 className={styles.muted}>Saved.</Caption1>}
      </div>
    </section>
  );
}
