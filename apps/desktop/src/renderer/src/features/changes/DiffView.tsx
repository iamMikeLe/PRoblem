import {
  Badge,
  Caption1,
  makeStyles,
  mergeClasses,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { DiffLine, FileDiff, Finding } from "@problem/shared";
import { Fragment, type ReactNode } from "react";
import { type DiffMode, splitRows } from "./model.ts";

const SEVERITY_COLOR = {
  blocker: "danger",
  major: "severe",
  minor: "warning",
  nit: "informative",
} as const;

const useStyles = makeStyles({
  scroller: { overflow: "auto", minHeight: 0 },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  hunk: {
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    whiteSpace: "pre",
  },
  number: {
    width: "1%",
    minWidth: "48px",
    textAlign: "right",
    padding: `0 ${tokens.spacingHorizontalS}`,
    color: tokens.colorNeutralForeground4,
    userSelect: "none",
    verticalAlign: "top",
  },
  numberButton: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    color: tokens.colorNeutralForeground3,
    cursor: "pointer",
    ":hover": { color: tokens.colorBrandForeground1, textDecorationLine: "underline" },
  },
  marker: { width: "1%", padding: `0 ${tokens.spacingHorizontalXS}`, userSelect: "none" },
  code: { whiteSpace: "pre", padding: `0 ${tokens.spacingHorizontalS}` },
  add: { backgroundColor: tokens.colorPaletteGreenBackground1 },
  del: { backgroundColor: tokens.colorPaletteRedBackground1 },
  empty: { backgroundColor: tokens.colorNeutralBackground3 },
  split: { borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  findingRow: { backgroundColor: tokens.colorNeutralBackground2 },
  finding: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    fontFamily: tokens.fontFamilyBase,
    border: "none",
    background: "none",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  notice: { padding: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground3 },
});

interface Props {
  diff: FileDiff;
  mode: DiffMode;
  /** Findings in this file. */
  findings: readonly Finding[];
  /** Opens the file at a line of the head version in the user's editor. */
  onOpenLine: (line: number) => void;
  onShowFinding: (finding: Finding) => void;
}

/** One file's diff; findings appear under the line they point to (head version). */
export function DiffView({ diff, mode, findings, onOpenLine, onShowFinding }: Props) {
  const styles = useStyles();
  if (diff.binary) return <Text className={styles.notice}>Binary file; no diff to show.</Text>;
  if (diff.tooLarge) {
    return (
      <Text className={styles.notice}>
        This diff is too large to show. Open the file in your editor.
      </Text>
    );
  }
  if (diff.hunks.length === 0) {
    return <Text className={styles.notice}>No content changes (renamed or mode change only).</Text>;
  }

  const byLine = new Map<number, Finding[]>();
  for (const finding of findings) {
    if (finding.line !== null)
      byLine.set(finding.line, [...(byLine.get(finding.line) ?? []), finding]);
  }
  const columns = mode === "split" ? 6 : 4;

  const lineNumber = (line: DiffLine | undefined, side: "old" | "new"): ReactNode => {
    const value = side === "old" ? line?.oldLine : line?.newLine;
    if (value === null || value === undefined) return null;
    if (side === "old") return value;
    return (
      <button
        type="button"
        className={styles.numberButton}
        aria-label={`Open line ${value} in the editor`}
        onClick={() => onOpenLine(value)}
      >
        {value}
      </button>
    );
  };
  const tone = (line: DiffLine | undefined) =>
    line === undefined
      ? styles.empty
      : line.kind === "add"
        ? styles.add
        : line.kind === "del"
          ? styles.del
          : undefined;
  const sign = (line: DiffLine | undefined) =>
    line === undefined ? "" : line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  // Color and the sign are visual; screen readers hear what the line is.
  const spoken = (line: DiffLine | undefined) =>
    line?.kind === "add" ? (
      <span className={styles.visuallyHidden}>added: </span>
    ) : line?.kind === "del" ? (
      <span className={styles.visuallyHidden}>removed: </span>
    ) : null;

  const findingRows = (newLine: number | null | undefined) => {
    const here = newLine === null || newLine === undefined ? [] : (byLine.get(newLine) ?? []);
    return here.map((finding) => (
      <tr key={`finding-${finding.number}`} className={styles.findingRow}>
        <td colSpan={columns}>
          <button type="button" className={styles.finding} onClick={() => onShowFinding(finding)}>
            <Badge appearance="tint" shape="rounded" color={SEVERITY_COLOR[finding.severity]}>
              #{finding.number}
            </Badge>
            <Text size={200}>{finding.title}</Text>
            {finding.verdict !== "open" && <Caption1>· {finding.verdict}</Caption1>}
          </button>
        </td>
      </tr>
    ));
  };

  return (
    <div className={styles.scroller}>
      <table className={styles.table} aria-label={`Diff of ${diff.path}`}>
        <tbody>
          {diff.hunks.map((hunk, h) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hunks never reorder
            <Fragment key={h}>
              <tr>
                <td colSpan={columns} className={styles.hunk}>
                  {hunk.header}
                </td>
              </tr>
              {mode === "unified"
                ? hunk.lines.map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines never reorder
                    <Fragment key={i}>
                      <tr className={tone(line)}>
                        <td className={styles.number}>{lineNumber(line, "old")}</td>
                        <td className={styles.number}>{lineNumber(line, "new")}</td>
                        <td className={styles.marker} aria-hidden>
                          {sign(line)}
                        </td>
                        <td className={styles.code}>
                          {spoken(line)}
                          {line.text}
                        </td>
                      </tr>
                      {findingRows(line.newLine)}
                    </Fragment>
                  ))
                : splitRows(hunk.lines).map(({ left, right }, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows never reorder
                    <Fragment key={i}>
                      <tr>
                        <td className={mergeClasses(styles.number, tone(left))}>
                          {lineNumber(left, "old")}
                        </td>
                        <td className={mergeClasses(styles.marker, tone(left))} aria-hidden>
                          {sign(left)}
                        </td>
                        <td className={mergeClasses(styles.code, tone(left))}>
                          {spoken(left)}
                          {left?.text}
                        </td>
                        <td className={mergeClasses(styles.number, styles.split, tone(right))}>
                          {lineNumber(right, "new")}
                        </td>
                        <td className={mergeClasses(styles.marker, tone(right))} aria-hidden>
                          {sign(right)}
                        </td>
                        <td className={mergeClasses(styles.code, tone(right))}>
                          {spoken(right)}
                          {right?.text}
                        </td>
                      </tr>
                      {findingRows(right?.newLine)}
                    </Fragment>
                  ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The new-version line numbers a diff shows, to tell which findings fall outside its hunks. */
export function shownNewLines(diff: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) if (line.newLine !== null) lines.add(line.newLine);
  }
  return lines;
}
