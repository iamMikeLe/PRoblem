import {
  Button,
  Caption1,
  makeStyles,
  mergeClasses,
  Tab,
  TabList,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { ArrowUndoRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { Markdown } from "../conversation/Markdown.tsx";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    paddingInline: tokens.spacingHorizontalXS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTopLeftRadius: tokens.borderRadiusMedium,
    borderTopRightRadius: tokens.borderRadiusMedium,
  },
  spacer: { flexGrow: 1 },
  muted: { color: tokens.colorNeutralForeground3 },
  body: { padding: tokens.spacingHorizontalS },
  textarea: { width: "100%" },
  monospace: {
    "& textarea": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
      lineHeight: tokens.lineHeightBase200,
    },
  },
  preview: {
    minHeight: "64px",
    maxHeight: "320px",
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalXS,
  },
});

interface Props {
  /** The textarea's accessible name, when it is not inside a labelled `Field`. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown with a reset action once the value differs from it (Claude's text). */
  original?: string;
  readOnly?: boolean;
  placeholder?: string;
  /** Lines shown before the textarea scrolls; it grows with the text up to this. */
  maxRows?: number;
}

/**
 * A comment box like GitHub's: Write (a monospace textarea) and Preview (the markdown as GitHub
 * renders it, with the app's renderer: GitHub-flavored, no raw HTML, links as text).
 */
export function MarkdownEditor({
  label,
  value,
  onChange,
  original,
  readOnly = false,
  placeholder,
  maxRows = 12,
}: Props) {
  const styles = useStyles();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const rows = Math.min(maxRows, Math.max(4, value.split("\n").length + 1));

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <TabList
          size="small"
          selectedValue={tab}
          onTabSelect={(_, d) => setTab(d.value === "preview" ? "preview" : "write")}
          aria-label={label ? `${label}: write or preview` : "Write or preview"}
        >
          <Tab value="write">Write</Tab>
          <Tab value="preview">Preview</Tab>
        </TabList>
        <span className={styles.spacer} />
        {original !== undefined && value !== original && !readOnly && (
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowUndoRegular />}
            onClick={() => onChange(original)}
          >
            Reset to Claude's text
          </Button>
        )}
        <Caption1 className={styles.muted}>Markdown supported</Caption1>
      </div>
      <div className={styles.body}>
        {tab === "write" ? (
          <Textarea
            className={mergeClasses(styles.textarea, styles.monospace)}
            aria-label={label}
            value={value}
            readOnly={readOnly}
            placeholder={placeholder}
            onChange={(_, d) => onChange(d.value)}
            resize="vertical"
            rows={rows}
          />
        ) : (
          <section
            className={styles.preview}
            aria-label={label ? `Preview of ${label}` : "Preview"}
          >
            {value.trim() === "" ? (
              <Caption1 className={styles.muted}>Nothing to preview.</Caption1>
            ) : (
              <Markdown text={value} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
