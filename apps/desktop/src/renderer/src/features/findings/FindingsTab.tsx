import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Caption1,
  createTableColumn,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Subtitle2,
  Tab,
  TabList,
  type TableColumnDefinition,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUndoRegular,
  BugRegular,
  ChatRegular,
  CheckmarkRegular,
  DismissCircleRegular,
  DocumentRegular,
  LightbulbRegular,
  SendRegular,
  SparkleRegular,
  TextNumberListLtrRegular,
} from "@fluentui/react-icons";
import type { Finding, Severity, Verdict } from "@problem/shared";
import { type ReactNode, useId, useState } from "react";
import { LoadingRows } from "../../app/LoadingRows.tsx";
import { type PanelLimits, usePanel } from "../../lib/panel.ts";
import { ResizeHandle } from "../../lib/ResizeHandle.tsx";
import { useShortcuts } from "../../lib/shortcuts.ts";
import { Markdown } from "../conversation/Markdown.tsx";
import { useFindings, useOpenInEditor, useSetVerdict } from "./queries.ts";

/** Which findings the list shows. "Withdrawn" are those Claude took back; the others exclude them. */
export type FindingFilter = Verdict | "withdrawn" | "all";
const FILTERS: { value: FindingFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "accepted", label: "Accepted" },
  { value: "dismissed", label: "Dismissed" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
];
const isFilter = (value: unknown): value is FindingFilter =>
  FILTERS.some((filter) => filter.value === value);

export function matchesFilter(finding: Finding, filter: FindingFilter): boolean {
  if (filter === "all") return true;
  if (filter === "withdrawn") return finding.withdrawnReason !== null;
  return finding.withdrawnReason === null && finding.verdict === filter;
}

const SEVERITY: Record<
  Severity,
  { label: string; color: "danger" | "severe" | "warning" | "informative" }
> = {
  blocker: { label: "Blocker", color: "danger" },
  major: { label: "Major", color: "severe" },
  minor: { label: "Minor", color: "warning" },
  nit: { label: "Nit", color: "informative" },
};
const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };

const VERDICT_LABEL: Record<Verdict, string> = {
  open: "Open",
  accepted: "Accepted",
  dismissed: "Dismissed",
};

const VERDICT_COLOR: Record<Verdict | "withdrawn", "brand" | "success" | "subtle" | "informative"> =
  {
    open: "brand",
    accepted: "success",
    dismissed: "subtle",
    withdrawn: "informative",
  };

/** The detail panel's height; it shrinks below this when the tab is short, the list keeps room. */
export const DETAIL_LIMITS: PanelLimits = { initial: 380, min: 160, max: 1200 };

/** What "Ask Claude for steps" puts in the composer. */
export function stepsRequest(finding: Finding): string {
  return (
    `Please add numbered steps to reproduce #${finding.number} (${finding.title}), ` +
    `with the expected and the actual result. Save them by updating finding #${finding.number} ` +
    "with report_findings."
  );
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  },
  post: { marginInlineStart: "auto" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // The list keeps room for a few rows however tall the detail is.
  list: { overflowY: "auto", flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: "120px" },
  number: { fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground3 },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  location: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  empty: {
    display: "grid",
    placeItems: "center",
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
  },
  // Its height comes from the resize handle (flex-basis); it gives way before the list does.
  detail: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 0,
    flexShrink: 1,
    minHeight: "160px",
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    // The body sits on the main background, like the conversation, so markdown reads the same.
    backgroundColor: tokens.colorNeutralBackground1,
  },
  // Header: what it is (left) and what to do with it (right). It stays put while the body
  // scrolls; the actions wrap below the title when the pane is narrow.
  detailHeader: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  summary: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    flexGrow: 1,
    flexBasis: "320px",
    minWidth: 0,
  },
  headline: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  heading: {
    minWidth: 0,
    margin: 0,
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
  },
  headingNumber: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  chip: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalXXL}`,
  },
  // A comfortable line length for prose; code blocks scroll inside it.
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXL,
    maxWidth: "860px",
  },
  part: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0 },
  partHeading: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    margin: 0,
    color: tokens.colorNeutralForeground2,
    paddingBottom: tokens.spacingVerticalXS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  partIcon: { fontSize: tokens.fontSizeBase400, color: tokens.colorNeutralForeground3 },
  noSteps: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** One titled part of the detail: Problem, How to reproduce, Suggestion. */
function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const styles = useStyles();
  const id = useId();
  return (
    <section className={styles.part} aria-labelledby={id}>
      <Body1Strong as="h4" id={id} className={styles.partHeading}>
        <span className={styles.partIcon} aria-hidden>
          {icon}
        </span>
        {title}
      </Body1Strong>
      {children}
    </section>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, color } = SEVERITY[severity];
  return (
    <Badge appearance="tint" color={color} shape="rounded">
      {label}
    </Badge>
  );
}

function verdictText(finding: Finding): string {
  return finding.withdrawnReason !== null ? "Withdrawn" : VERDICT_LABEL[finding.verdict];
}

const location = (finding: Finding): string | null =>
  finding.file === null
    ? null
    : finding.line === null
      ? finding.file
      : `${finding.file}:${finding.line}`;

interface Props {
  reviewId: string;
  /**
   * "Ask about #N": prefill the composer and switch to the conversation. With `request`, the
   * composer starts with that text instead of "About #N (title): ".
   */
  onAsk: (finding: Finding, request?: string) => void;
  /** Open with this finding selected (from the Changes tab). */
  initialSelected?: number | undefined;
  /** Opens the "post to GitHub" preview. */
  onPost: () => void;
}

/** Findings Claude reported for a review, with the user's verdicts. */
export function FindingsTab({ reviewId, onAsk, initialSelected, onPost }: Props) {
  const styles = useStyles();
  const findings = useFindings(reviewId);
  const setVerdict = useSetVerdict();
  const openEditor = useOpenInEditor();
  // A finding chosen elsewhere may be accepted or dismissed: show all findings then.
  const [filter, setFilter] = useState<FindingFilter>(
    initialSelected === undefined ? "open" : "all",
  );
  const [selected, setSelected] = useState<number | undefined>(initialSelected);
  const detailPanel = usePanel("findings.detail", DETAIL_LIMITS);

  const all = findings.data ?? [];
  const shown = all
    .filter((finding) => matchesFilter(finding, filter))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.number - b.number);
  // The detail stays open after a verdict moves the finding out of the current filter.
  const current = all.find((finding) => finding.number === selected);
  // J/K walk the list as shown; from nothing selected, either key starts at the top.
  const step = (by: 1 | -1) => {
    const index = shown.findIndex((finding) => finding.number === selected);
    const next =
      index === -1 ? shown[0] : shown[Math.min(Math.max(index + by, 0), shown.length - 1)];
    if (next) setSelected(next.number);
  };
  useShortcuts({ j: () => step(1), k: () => step(-1) });
  const count = (value: FindingFilter) =>
    all.filter((finding) => matchesFilter(finding, value)).length;

  const open = (finding: Finding) => {
    if (finding.file === null) return;
    openEditor.mutate({ id: reviewId, file: finding.file, line: finding.line });
  };

  const columns: TableColumnDefinition<Finding>[] = [
    createTableColumn<Finding>({
      columnId: "number",
      renderHeaderCell: () => "#",
      renderCell: (finding) => <span className={styles.number}>#{finding.number}</span>,
    }),
    createTableColumn<Finding>({
      columnId: "severity",
      renderHeaderCell: () => "Severity",
      renderCell: (finding) => <SeverityBadge severity={finding.severity} />,
    }),
    createTableColumn<Finding>({
      columnId: "title",
      renderHeaderCell: () => "Title",
      renderCell: (finding) => (
        <span className={styles.title} title={finding.title}>
          {finding.title}
        </span>
      ),
    }),
    createTableColumn<Finding>({
      columnId: "location",
      renderHeaderCell: () => "Location",
      renderCell: (finding) => {
        const where = location(finding);
        return where === null ? (
          <Caption1 className={styles.muted}>Whole change</Caption1>
        ) : (
          <Link
            className={styles.location}
            title={`Open ${where} in your editor`}
            onClick={(event) => {
              // The row would take the click as a selection too.
              event.stopPropagation();
              open(finding);
            }}
          >
            {where}
          </Link>
        );
      },
    }),
    createTableColumn<Finding>({
      columnId: "verdict",
      renderHeaderCell: () => "Verdict",
      renderCell: (finding) => (
        <Caption1>
          {verdictText(finding)}
          {finding.changedSinceVerdict && " · changed"}
          {finding.postedUrl && " · posted"}
        </Caption1>
      ),
    }),
  ];

  const decide = (finding: Finding, verdict: Verdict) =>
    setVerdict.mutate({ id: reviewId, number: finding.number, verdict });

  const error = findings.error ?? setVerdict.error ?? openEditor.error;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <TabList
          size="small"
          selectedValue={filter}
          aria-label="Show findings"
          onTabSelect={(_, data) => {
            if (isFilter(data.value)) setFilter(data.value);
          }}
        >
          {FILTERS.map(({ value, label }) => (
            <Tab key={value} value={value}>
              {label} ({count(value)})
            </Tab>
          ))}
        </TabList>
        <Button className={styles.post} size="small" icon={<SendRegular />} onClick={onPost}>
          Post to GitHub…
        </Button>
      </div>

      <div className={styles.list}>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error.message}</MessageBarBody>
          </MessageBar>
        )}
        {findings.isLoading ? (
          <LoadingRows label="Loading findings" />
        ) : shown.length === 0 ? (
          <div className={styles.empty}>
            <Text>
              {all.length === 0
                ? "No findings yet. Claude reports them here as it reviews."
                : "No findings in this view."}
            </Text>
          </div>
        ) : (
          <DataGrid
            items={shown}
            columns={columns}
            getRowId={(finding: Finding) => finding.number}
            selectionMode="single"
            selectedItems={selected === undefined ? [] : [selected]}
            onSelectionChange={(_, data) => {
              const [first] = [...data.selectedItems];
              setSelected(typeof first === "number" ? first : undefined);
            }}
            columnSizingOptions={{
              number: { idealWidth: 48, minWidth: 40 },
              severity: { idealWidth: 90, minWidth: 80 },
              title: { idealWidth: 360, minWidth: 160 },
              location: { idealWidth: 220, minWidth: 120 },
              verdict: { idealWidth: 140, minWidth: 100 },
            }}
            resizableColumns
            aria-label="Findings"
            focusMode="composite"
          >
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell }) => (
                  <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody<Finding>>
              {({ item, rowId }) => (
                <DataGridRow<Finding> key={rowId}>
                  {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        )}
      </div>

      {current && (
        <>
          <ResizeHandle
            label="Resize the finding details"
            orientation="horizontal"
            width={detailPanel.width}
            limits={DETAIL_LIMITS}
            onWidth={detailPanel.setWidth}
          />
          <section
            className={styles.detail}
            style={{ flexBasis: `${detailPanel.width}px` }}
            aria-label={`Finding #${current.number}`}
          >
            <header className={styles.detailHeader}>
              <div className={styles.summary}>
                <div className={styles.headline}>
                  <SeverityBadge severity={current.severity} />
                  <Subtitle2 as="h3" className={styles.heading}>
                    <span className={styles.headingNumber}>#{current.number}</span>
                    <span>{current.title}</span>
                  </Subtitle2>
                </div>
                <div className={styles.meta}>
                  {location(current) === null ? (
                    <Caption1 className={styles.muted}>Whole change</Caption1>
                  ) : (
                    <Tooltip content="Open in your editor" relationship="description">
                      <Button
                        className={styles.chip}
                        size="small"
                        appearance="subtle"
                        icon={<DocumentRegular />}
                        onClick={() => open(current)}
                      >
                        <span className={styles.chipText}>{location(current)}</span>
                      </Button>
                    </Tooltip>
                  )}
                  <Badge
                    appearance="outline"
                    shape="rounded"
                    color={
                      VERDICT_COLOR[
                        current.withdrawnReason !== null ? "withdrawn" : current.verdict
                      ]
                    }
                  >
                    {verdictText(current)}
                  </Badge>
                  {current.postedUrl && (
                    <Badge appearance="tint" shape="rounded" color="informative">
                      Posted
                    </Badge>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                {current.verdict !== "accepted" && (
                  <Button icon={<CheckmarkRegular />} onClick={() => decide(current, "accepted")}>
                    Accept
                  </Button>
                )}
                {current.verdict !== "dismissed" && (
                  <Button
                    icon={<DismissCircleRegular />}
                    onClick={() => decide(current, "dismissed")}
                  >
                    Dismiss
                  </Button>
                )}
                {current.verdict !== "open" && (
                  <Button icon={<ArrowUndoRegular />} onClick={() => decide(current, "open")}>
                    Reopen
                  </Button>
                )}
                <Button appearance="primary" icon={<ChatRegular />} onClick={() => onAsk(current)}>
                  Ask about #{current.number}
                </Button>
              </div>
            </header>
            <div className={styles.body}>
              <div className={styles.column}>
                {current.changedSinceVerdict && (
                  <MessageBar intent="warning">
                    <MessageBarBody>Claude changed this finding after your verdict.</MessageBarBody>
                  </MessageBar>
                )}
                {current.withdrawnReason !== null && (
                  <MessageBar intent="info">
                    <MessageBarBody>Withdrawn by Claude: {current.withdrawnReason}</MessageBarBody>
                  </MessageBar>
                )}
                <Part icon={<BugRegular />} title="Problem">
                  <Markdown text={current.problem} />
                </Part>
                <Part icon={<TextNumberListLtrRegular />} title="How to reproduce">
                  {current.reproduction.trim() !== "" ? (
                    <Markdown text={current.reproduction} />
                  ) : (
                    <div className={styles.noSteps}>
                      <Body1 className={styles.muted}>No steps yet.</Body1>
                      <Button
                        size="small"
                        icon={<SparkleRegular />}
                        onClick={() => onAsk(current, stepsRequest(current))}
                      >
                        Ask Claude for steps
                      </Button>
                    </div>
                  )}
                </Part>
                {current.suggestion.trim() !== "" && (
                  <Part icon={<LightbulbRegular />} title="Suggestion">
                    <Markdown text={current.suggestion} />
                  </Part>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
