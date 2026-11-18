import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Caption1,
  makeStyles,
  Spinner,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, DismissCircleRegular, WrenchRegular } from "@fluentui/react-icons";
import type { ConversationEntry } from "@reviewroom/shared";

type ToolCall = Extract<ConversationEntry, { kind: "tool-call" }>;
type ToolResult = Extract<ConversationEntry, { kind: "tool-result" }>;

const useStyles = makeStyles({
  card: {
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    overflow: "hidden",
  },
  header: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, minWidth: 0 },
  name: { fontWeight: tokens.fontWeightSemibold },
  summary: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  ok: { color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  error: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },
  pre: {
    margin: 0,
    marginBottom: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalS,
    maxHeight: "320px",
    overflow: "auto",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

function ResultIcon({ result, pending }: { result: ToolResult | undefined; pending: boolean }) {
  const styles = useStyles();
  if (!result) {
    return pending ? (
      <Spinner size="extra-tiny" aria-label="Running" />
    ) : (
      <WrenchRegular aria-label="No result" />
    );
  }
  return result.isError ? (
    <DismissCircleRegular className={styles.error} aria-label="Failed or refused" />
  ) : (
    <CheckmarkCircleRegular className={styles.ok} aria-label="Done" />
  );
}

/** A collapsed card for one tool call and its result. */
export function ToolCallCard({
  call,
  result,
  pending,
}: {
  call: ToolCall;
  result: ToolResult | undefined;
  /** Whether the turn is still running (a missing result is then on its way). */
  pending: boolean;
}) {
  const styles = useStyles();
  return (
    <Accordion collapsible className={styles.card}>
      <AccordionItem value={call.toolUseId}>
        <AccordionHeader size="small">
          <span className={styles.header}>
            <ResultIcon result={result} pending={pending} />
            <span className={styles.name}>{displayName(call.name)}</span>
            <span className={styles.summary} title={call.summary}>
              {call.summary}
            </span>
          </span>
        </AccordionHeader>
        <AccordionPanel>
          <Caption1>Input</Caption1>
          <pre className={styles.pre}>{call.input}</pre>
          {result && (
            <>
              <Caption1>{result.isError ? "Error" : "Output"}</Caption1>
              <pre className={styles.pre}>{result.output || "(empty)"}</pre>
            </>
          )}
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}

/** MCP tools are named `mcp__<server>__<tool>`; the card shows the tool's own name. */
function displayName(name: string): string {
  return name.match(/^mcp__.+?__(.+)$/)?.[1] ?? name;
}
