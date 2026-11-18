import {
  Badge,
  Button,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { ArrowResetRegular, SaveRegular } from "@fluentui/react-icons";
import {
  DEFAULT_REVIEW_PROMPT,
  type Project,
  REVIEW_PROMPT_MAX,
  ReviewPromptSchema,
} from "@problem/shared";
import { useState } from "react";
import { useUpdateProject } from "./queries.ts";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  label: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  textarea: { minHeight: "320px" },
  actions: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  muted: { color: tokens.colorNeutralForeground3 },
});

/**
 * Edits the prompt a new review of this project starts with. The text is stored on the project;
 * "Reset to default" fills in the built-in prompt, which the user then saves (ADR 0007).
 * Mount with `key={project.id}` so the draft resets when another project is selected.
 */
export function ReviewPromptEditor({ project }: { project: Project }) {
  const styles = useStyles();
  const update = useUpdateProject();
  const [draft, setDraft] = useState(project.reviewPrompt);

  const parsed = ReviewPromptSchema.safeParse(draft);
  const invalid = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const isDefault = project.reviewPrompt === DEFAULT_REVIEW_PROMPT;
  const dirty = draft.trim() !== project.reviewPrompt;
  const canSave = dirty && parsed.success && !update.isPending;

  const change = (value: string) => {
    setDraft(value);
    // A save result belongs to the text that was saved, not to a new edit.
    if (!update.isPending) update.reset();
  };
  const save = () => {
    if (parsed.success) update.mutate({ id: project.id, body: { reviewPrompt: parsed.data } });
  };

  return (
    <div className={styles.root}>
      <Field
        label={{
          children: (
            <span className={styles.label}>
              Review prompt
              <Badge appearance="tint" color={isDefault ? "informative" : "brand"} size="small">
                {isDefault ? "Default" : "Custom"}
              </Badge>
            </span>
          ),
        }}
        hint="Sent to Claude when a review of this project starts. You can change it per review."
        {...(invalid === undefined ? {} : { validationState: "error", validationMessage: invalid })}
      >
        <Textarea
          className={styles.textarea}
          resize="vertical"
          value={draft}
          onChange={(_, data) => change(data.value)}
          maxLength={REVIEW_PROMPT_MAX}
        />
      </Field>
      {update.isError && (
        <MessageBar intent="error">
          <MessageBarBody>Could not save the prompt: {update.error.message}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.actions}>
        <Button appearance="primary" icon={<SaveRegular />} disabled={!canSave} onClick={save}>
          Save
        </Button>
        <Button
          icon={<ArrowResetRegular />}
          disabled={draft === DEFAULT_REVIEW_PROMPT}
          onClick={() => change(DEFAULT_REVIEW_PROMPT)}
        >
          Reset to default
        </Button>
        <Text size={200} className={styles.muted} role="status">
          {dirty ? "Unsaved changes" : update.isSuccess ? "Saved" : ""}
        </Text>
      </div>
    </div>
  );
}
