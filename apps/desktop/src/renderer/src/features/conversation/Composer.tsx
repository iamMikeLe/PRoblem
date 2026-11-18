import {
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Option,
  Textarea,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { SendRegular, StopRegular } from "@fluentui/react-icons";
import type { ClaudeCatalog, Review, ReviewStatus } from "@reviewroom/shared";
import { type KeyboardEvent, useId, useState } from "react";
import { useCatalog, useSendMessage, useStopReview } from "./queries.ts";
import { isBusy } from "./store.ts";

const DEFAULT_MODEL = "__default__";
const MAX_SUGGESTIONS = 8;

const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  row: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "flex-end" },
  input: { flexGrow: 1 },
  toolbar: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  hint: { color: tokens.colorNeutralForeground3, marginInlineStart: "auto" },
  model: { minWidth: "180px" },
  suggestions: {
    position: "absolute",
    bottom: "100%",
    left: tokens.spacingHorizontalL,
    width: "min(420px, calc(100% - 32px))",
    padding: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
  },
  suggestion: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    overflow: "hidden",
  },
  active: { backgroundColor: tokens.colorNeutralBackground1Selected },
  command: { fontFamily: tokens.fontFamilyMonospace, flexShrink: 0 },
  description: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

/** Slash commands matching what is typed, while the message is just `/partial-name`. */
export function matchCommands(text: string, catalog: ClaudeCatalog | undefined) {
  const match = /^\/([\w:-]*)$/.exec(text);
  if (!match || !catalog) return [];
  const typed = (match[1] ?? "").toLowerCase();
  return catalog.commands
    .filter((command) => command.name.toLowerCase().startsWith(typed))
    .slice(0, MAX_SUGGESTIONS);
}

interface Props {
  review: Pick<Review, "id" | "model">;
  status: ReviewStatus;
}

/** Message box under the conversation. Enter sends, Shift+Enter adds a line, `/` lists commands. */
export function Composer({ review, status }: Props) {
  const styles = useStyles();
  const listId = useId();
  const [text, setText] = useState("");
  const [model, setModel] = useState<string | null>(review.model);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const catalog = useCatalog();
  const send = useSendMessage();
  const stop = useStopReview();
  const busy = isBusy(status);

  const suggestions = dismissed === text ? [] : matchCommands(text, catalog.data);
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));
  const canSend = !busy && !send.isPending && text.trim() !== "";

  const submit = () => {
    if (!canSend) return;
    const sent = text;
    // Keep anything typed while the message was being sent.
    send.mutate(
      { id: review.id, text: sent.trim(), model },
      { onSuccess: () => setText((current) => (current === sent ? "" : current)) },
    );
  };

  const choose = (name: string) => {
    setText(`/${name} `);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + suggestions.length) % suggestions.length);
        return;
      }
      const chosen = suggestions[activeIndex];
      if ((event.key === "Enter" || event.key === "Tab") && chosen) {
        event.preventDefault();
        choose(chosen.name);
        return;
      }
      if (event.key === "Escape") {
        setDismissed(text);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const models = catalog.data?.models ?? [];
  const modelLabel =
    model === null
      ? "Default model"
      : (models.find((option) => option.value === model)?.displayName ?? model);

  return (
    <div className={styles.root}>
      {suggestions.length > 0 && (
        <div id={listId} role="listbox" aria-label="Commands" className={styles.suggestions}>
          {suggestions.map((command, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection happens in the textarea
            <div
              key={command.name}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={mergeClasses(styles.suggestion, index === activeIndex && styles.active)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(command.name)}
            >
              <span className={styles.command}>/{command.name}</span>
              <span className={styles.description}>{command.description}</span>
            </div>
          ))}
        </div>
      )}
      {send.error && (
        <MessageBar intent="error">
          <MessageBarBody>{send.error.message}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.row}>
        <Textarea
          className={styles.input}
          resize="vertical"
          value={text}
          onChange={(_, data) => {
            setText(data.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            busy
              ? "Claude is working… you can write your next message"
              : "Ask Claude about this review"
          }
          aria-label="Message"
          aria-controls={suggestions.length > 0 ? listId : undefined}
          aria-expanded={suggestions.length > 0}
          aria-autocomplete="list"
          aria-activedescendant={suggestions.length > 0 ? `${listId}-${activeIndex}` : undefined}
        />
        {busy ? (
          <Tooltip content="Stop Claude" relationship="label">
            <Button
              icon={<StopRegular />}
              onClick={() => stop.mutate(review.id)}
              disabled={stop.isPending}
            />
          </Tooltip>
        ) : (
          <Tooltip content="Send (Enter)" relationship="label">
            <Button
              appearance="primary"
              icon={<SendRegular />}
              onClick={submit}
              disabledFocusable={!canSend}
            />
          </Tooltip>
        )}
      </div>
      <div className={styles.toolbar}>
        <Dropdown
          className={styles.model}
          size="small"
          aria-label="Model"
          value={modelLabel}
          selectedOptions={[model ?? DEFAULT_MODEL]}
          onOptionSelect={(_, data) => {
            const value = data.optionValue;
            if (value !== undefined) setModel(value === DEFAULT_MODEL ? null : value);
          }}
        >
          <Option value={DEFAULT_MODEL} text="Default model">
            Default model
          </Option>
          {models.map((option) => (
            <Option key={option.value} value={option.value} text={option.displayName}>
              {option.displayName}
            </Option>
          ))}
        </Dropdown>
        <Caption1 className={styles.hint}>Read-only review · Shift+Enter for a new line</Caption1>
      </div>
    </div>
  );
}
