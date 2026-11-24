import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Subtitle2,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUndoRegular,
  BugRegular,
  ChatRegular,
  CheckmarkCircleFilled,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  CircleRegular,
  DismissCircleFilled,
  DismissCircleRegular,
  DocumentRegular,
  LightbulbRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  ShieldRegular,
  SubtractCircleRegular,
  TextNumberListLtrRegular,
} from "@fluentui/react-icons";
import {
  type Finding,
  SECURITY_CATEGORIES,
  SECURITY_CATEGORY_ORDER,
  type SecurityScan,
  type Verdict,
} from "@problem/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { LoadingRows } from "../../app/LoadingRows.tsx";
import { Markdown } from "../conversation/Markdown.tsx";
import { Part, SEVERITY_ORDER, SeverityBadge } from "../findings/FindingsTab.tsx";
import { useFindings, useOpenInEditor, useSetVerdict } from "../findings/queries.ts";
import { type CheckDisplay, checkStatus, isActive } from "./model.ts";
import { useSecurityScan } from "./queries.ts";

const STATUS: Record<
  CheckDisplay,
  { label: string; icon: ReactNode; tone: "pass" | "fail" | "muted" }
> = {
  pass: { label: "Passed", icon: <CheckmarkCircleFilled />, tone: "pass" },
  fail: { label: "Issues found", icon: <DismissCircleFilled />, tone: "fail" },
  resolved: { label: "Resolved", icon: <CheckmarkCircleRegular />, tone: "muted" },
  "not-applicable": { label: "Not applicable", icon: <SubtractCircleRegular />, tone: "muted" },
  "not-scanned": { label: "Not scanned yet", icon: <CircleRegular />, tone: "muted" },
};

const useStyles = makeStyles({
  root: { overflowY: "auto", minHeight: 0, minWidth: 0 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXL,
    maxWidth: "960px",
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalXXL}`,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    minWidth: 0,
  },
  outcome: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM },
  outcomeIcon: { fontSize: tokens.fontSizeBase600, display: "flex" },
  outcomeText: { display: "flex", flexDirection: "column", minWidth: 0 },
  pass: { color: tokens.colorStatusSuccessForeground1 },
  fail: { color: tokens.colorStatusDangerForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  checks: {
    listStyleType: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  check: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalXXS,
    alignItems: "start",
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  checkIcon: { fontSize: tokens.fontSizeBase400, display: "flex", paddingTop: "2px" },
  checkBody: { display: "flex", flexDirection: "column", minWidth: 0 },
  sectionHeading: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    margin: 0,
  },
  findings: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  findingHeader: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalS,
  },
  findingSummary: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    flexGrow: 1,
    flexBasis: "320px",
    minWidth: 0,
  },
  headline: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, minWidth: 0 },
  heading: { margin: 0, display: "flex", alignItems: "baseline", gap: tokens.spacingHorizontalS },
  number: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  meta: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
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
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  parts: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  // Dismissed or withdrawn: a dashed border, no blending (keeps contrast in every theme).
  closed: { border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}` },
});

const location = (finding: Finding): string | null =>
  finding.file === null
    ? null
    : finding.line === null
      ? finding.file
      : `${finding.file}:${finding.line}`;

function verdictLabel(finding: Finding): string | null {
  if (finding.withdrawnReason !== null) return "Withdrawn";
  if (finding.verdict === "accepted") return "Accepted";
  if (finding.verdict === "dismissed") return "Dismissed";
  return null;
}

/** The scan's outcome, its summary and the checklist of every category. Always shown. */
function ScanSummary({
  scan,
  findings,
}: {
  scan: SecurityScan | null | undefined;
  findings: readonly Finding[];
}) {
  const styles = useStyles();
  const headingId = useId();
  const active = findings.filter(isActive).length;
  const statuses = new Map(
    SECURITY_CATEGORY_ORDER.map((category) => [category, checkStatus(category, scan, findings)]),
  );
  // The header never contradicts the rows: any failing row makes it a failed scan.
  const failing = [...statuses.values()].includes("fail");
  const outcome =
    active > 0
      ? {
          icon: <ShieldErrorRegular />,
          tone: styles.fail,
          text: `${active} security ${active === 1 ? "issue" : "issues"} found`,
        }
      : failing
        ? { icon: <ShieldErrorRegular />, tone: styles.fail, text: "Issues reported" }
        : scan
          ? {
              icon: <ShieldCheckmarkRegular />,
              tone: styles.pass,
              text: "No security issues found",
            }
          : { icon: <ShieldRegular />, tone: styles.muted, text: "Not scanned yet" };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.outcome}>
        <span className={mergeClasses(styles.outcomeIcon, outcome.tone)} aria-hidden>
          {outcome.icon}
        </span>
        <div className={styles.outcomeText}>
          <Subtitle2 as="h3" id={headingId} className={styles.sectionHeading}>
            Security scan: {outcome.text}
          </Subtitle2>
          <Caption1 className={styles.muted}>
            {scan
              ? `Last scanned ${new Date(scan.updatedAt).toLocaleString()}`
              : "Claude scans every review for the categories below and reports the result here."}
          </Caption1>
        </div>
      </div>
      {scan && <Markdown text={scan.summary} />}
      <ul className={styles.checks} aria-label="Security checks">
        {SECURITY_CATEGORY_ORDER.map((category) => {
          const status = statuses.get(category) ?? "not-scanned";
          const { label, icon, tone } = STATUS[status];
          const count = findings.filter(
            (finding) => isActive(finding) && finding.securityCategory === category,
          ).length;
          const note = scan?.checks.find((check) => check.category === category)?.note;
          return (
            <li key={category} className={styles.check}>
              <span className={mergeClasses(styles.checkIcon, styles[tone])} aria-hidden>
                {icon}
              </span>
              <div className={styles.checkBody}>
                <Body1Strong>{SECURITY_CATEGORIES[category].label}</Body1Strong>
                <Caption1 className={styles.muted}>
                  {note ?? `Checks for ${SECURITY_CATEGORIES[category].covers}.`}
                </Caption1>
              </div>
              <Caption1 className={styles[tone]}>
                {label}
                {count > 0 && ` (${count})`}
              </Caption1>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface CardProps {
  finding: Finding;
  /** Scroll to this card once (the finding was chosen in search, Activity or Changes). */
  focused: boolean;
  onOpen: (finding: Finding) => void;
  onDecide: (finding: Finding, verdict: Verdict) => void;
  onAsk: (finding: Finding) => void;
}

/** One security finding: what, where, why it is risky and the fix. */
function SecurityFindingCard({ finding, focused, onOpen, onDecide, onAsk }: CardProps) {
  const styles = useStyles();
  const where = location(finding);
  const verdict = verdictLabel(finding);
  const category = finding.securityCategory;
  const card = useRef<HTMLElement>(null);
  // Once, when the card appears: later renders (verdicts, new reports) must not pull focus back.
  useEffect(() => {
    if (!focused) return;
    card.current?.focus({ preventScroll: true });
    card.current?.scrollIntoView?.({ block: "start" });
  }, [focused]);
  return (
    <article
      className={mergeClasses(styles.card, !isActive(finding) && styles.closed)}
      aria-label={`Security finding #${finding.number}`}
      tabIndex={focused ? -1 : undefined}
      ref={card}
    >
      <header className={styles.findingHeader}>
        <div className={styles.findingSummary}>
          <div className={styles.headline}>
            <SeverityBadge severity={finding.severity} />
            <Subtitle2 as="h4" className={styles.heading}>
              <span className={styles.number}>#{finding.number}</span>
              <span>{finding.title}</span>
            </Subtitle2>
          </div>
          <div className={styles.meta}>
            {category !== null && (
              <Badge appearance="outline" shape="rounded" color="danger">
                {SECURITY_CATEGORIES[category].label}
              </Badge>
            )}
            {where === null ? (
              <Caption1 className={styles.muted}>Whole change</Caption1>
            ) : (
              <Tooltip content="Open in your editor" relationship="description">
                <Button
                  className={styles.chip}
                  size="small"
                  appearance="subtle"
                  icon={<DocumentRegular />}
                  onClick={() => onOpen(finding)}
                >
                  <span className={styles.chipText}>{where}</span>
                </Button>
              </Tooltip>
            )}
            {verdict && (
              <Badge appearance="outline" shape="rounded" color="informative">
                {verdict}
              </Badge>
            )}
          </div>
        </div>
        <div className={styles.actions}>
          {finding.verdict !== "accepted" && (
            <Button icon={<CheckmarkRegular />} onClick={() => onDecide(finding, "accepted")}>
              Accept
            </Button>
          )}
          {finding.verdict !== "dismissed" && (
            <Button icon={<DismissCircleRegular />} onClick={() => onDecide(finding, "dismissed")}>
              Dismiss
            </Button>
          )}
          {finding.verdict !== "open" && (
            <Button icon={<ArrowUndoRegular />} onClick={() => onDecide(finding, "open")}>
              Reopen
            </Button>
          )}
          <Button icon={<ChatRegular />} onClick={() => onAsk(finding)}>
            Ask about #{finding.number}
          </Button>
        </div>
      </header>
      {finding.withdrawnReason !== null && (
        <MessageBar intent="info">
          <MessageBarBody>Withdrawn by Claude: {finding.withdrawnReason}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.parts}>
        <Part icon={<BugRegular />} title="Why it is risky">
          <Markdown text={finding.problem} />
        </Part>
        {finding.reproduction.trim() !== "" && (
          <Part icon={<TextNumberListLtrRegular />} title="How to reproduce">
            <Markdown text={finding.reproduction} />
          </Part>
        )}
        <Part icon={<LightbulbRegular />} title="Suggested fix">
          {finding.suggestion.trim() !== "" ? (
            <Markdown text={finding.suggestion} />
          ) : (
            <Body1 className={styles.muted}>No fix suggested yet.</Body1>
          )}
        </Part>
      </div>
    </article>
  );
}

interface Props {
  reviewId: string;
  /** "Ask about #N": prefill the composer and switch to the conversation. */
  onAsk: (finding: Finding) => void;
  /** Open with this finding shown (it is scrolled to and focused). */
  initialFinding?: number | undefined;
}

/** The security scan of a review: what was checked, and the security findings. */
export function SecurityTab({ reviewId, onAsk, initialFinding }: Props) {
  const styles = useStyles();
  const findings = useFindings(reviewId);
  const scan = useSecurityScan(reviewId);
  const setVerdict = useSetVerdict();
  const openEditor = useOpenInEditor();
  // A dismissed or withdrawn finding chosen elsewhere must be visible.
  const [showClosed, setShowClosed] = useState(initialFinding !== undefined);
  const headingId = useId();

  const security = (findings.data ?? [])
    .filter((finding) => finding.securityCategory !== null)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.number - b.number);
  const active = security.filter(isActive);
  const closed = security.filter((finding) => !isActive(finding));
  const shown = showClosed ? [...active, ...closed] : active;

  const error = findings.error ?? scan.error ?? setVerdict.error ?? openEditor.error;

  return (
    <div className={styles.root}>
      <div className={styles.column}>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error.message}</MessageBarBody>
          </MessageBar>
        )}
        {findings.isLoading || scan.isLoading ? (
          <LoadingRows label="Loading security scan" />
        ) : (
          <>
            <ScanSummary scan={scan.data} findings={security} />
            <section className={styles.findings} aria-labelledby={headingId}>
              <div className={styles.outcome}>
                <Subtitle2 as="h3" id={headingId} className={styles.sectionHeading}>
                  Security findings ({active.length})
                </Subtitle2>
                {closed.length > 0 && (
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-pressed={showClosed}
                    onClick={() => setShowClosed(!showClosed)}
                  >
                    {showClosed
                      ? "Hide dismissed and withdrawn"
                      : `Show dismissed and withdrawn (${closed.length})`}
                  </Button>
                )}
              </div>
              {shown.length === 0 ? (
                <Text className={styles.muted}>
                  {scan.data
                    ? "No open security findings."
                    : "No security findings yet. Claude reports them here as it reviews."}
                </Text>
              ) : (
                shown.map((finding) => (
                  <SecurityFindingCard
                    key={finding.number}
                    finding={finding}
                    focused={finding.number === initialFinding}
                    onAsk={onAsk}
                    onOpen={(target) => {
                      if (target.file === null) return;
                      openEditor.mutate({ id: reviewId, file: target.file, line: target.line });
                    }}
                    onDecide={(target, verdict) =>
                      setVerdict.mutate({ id: reviewId, number: target.number, verdict })
                    }
                  />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
