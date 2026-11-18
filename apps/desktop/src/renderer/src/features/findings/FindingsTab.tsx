import {
  Badge,
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
  Spinner,
  Subtitle2,
  Tab,
  TabList,
  type TableColumnDefinition,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUndoRegular,
  ChatRegular,
  CheckmarkRegular,
  DismissCircleRegular,
} from "@fluentui/react-icons";
import type { Finding, Severity, Verdict } from "@problem/shared";
import { useState } from "react";
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

const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    gridTemplateColumns: "minmax(0, 1fr)",
    minHeight: 0,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  list: { overflowY: "auto", minHeight: 0 },
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
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    maxHeight: "45vh",
    overflowY: "auto",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

function SeverityBadge({ severity }: { severity: Severity }) {
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
  /** "Ask about #N": prefill the composer and switch to the conversation. */
  onAsk: (finding: Finding) => void;
  /** Open with this finding selected (from the Changes tab). */
  initialSelected?: number | undefined;
}

/** Findings Claude reported for a review, with the user's verdicts. */
export function FindingsTab({ reviewId, onAsk, initialSelected }: Props) {
  const styles = useStyles();
  const findings = useFindings(reviewId);
  const setVerdict = useSetVerdict();
  const openEditor = useOpenInEditor();
  // A finding chosen elsewhere may be accepted or dismissed: show all findings then.
  const [filter, setFilter] = useState<FindingFilter>(
    initialSelected === undefined ? "open" : "all",
  );
  const [selected, setSelected] = useState<number | undefined>(initialSelected);

  const all = findings.data ?? [];
  const shown = all
    .filter((finding) => matchesFilter(finding, filter))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.number - b.number);
  // The detail stays open after a verdict moves the finding out of the current filter.
  const current = all.find((finding) => finding.number === selected);
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
      </div>

      <div className={styles.list}>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error.message}</MessageBarBody>
          </MessageBar>
        )}
        {findings.isLoading ? (
          <div className={styles.empty}>
            <Spinner size="small" label="Loading findings" />
          </div>
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
        <section className={styles.detail} aria-label={`Finding #${current.number}`}>
          <div className={styles.detailHeader}>
            <SeverityBadge severity={current.severity} />
            <Subtitle2 as="h3">
              #{current.number} {current.title}
            </Subtitle2>
            <Caption1 className={styles.muted}>
              {location(current) ?? "Whole change"} · {verdictText(current)}
            </Caption1>
          </div>
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
          <Markdown text={current.problem} />
          {current.suggestion.trim() !== "" && (
            <>
              <Text weight="semibold">Suggestion</Text>
              <Markdown text={current.suggestion} />
            </>
          )}
          <div className={styles.actions}>
            {current.verdict !== "accepted" && (
              <Button icon={<CheckmarkRegular />} onClick={() => decide(current, "accepted")}>
                Accept
              </Button>
            )}
            {current.verdict !== "dismissed" && (
              <Button icon={<DismissCircleRegular />} onClick={() => decide(current, "dismissed")}>
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
        </section>
      )}
    </div>
  );
}
