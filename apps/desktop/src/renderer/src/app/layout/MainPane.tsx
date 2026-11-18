import {
  Badge,
  Button,
  Caption1,
  makeStyles,
  Subtitle1,
  Tab,
  TabList,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { Review } from "@reviewroom/shared";
import { useState } from "react";
import { Composer } from "../../features/conversation/Composer.tsx";
import { Conversation } from "../../features/conversation/Conversation.tsx";
import { useConversation } from "../../features/conversation/queries.ts";
import { useReviewStatus } from "../../features/conversation/store.ts";
import { CloseReviewDialog } from "../../features/reviews/CloseReviewDialog.tsx";
import { describeReview, shortSha } from "../../features/reviews/describe.ts";
import { StatusDot } from "../../features/reviews/StatusDot.tsx";

type ReviewTab = "conversation" | "findings" | "changes" | "comments";
const TABS: readonly ReviewTab[] = ["conversation", "findings", "changes", "comments"];
const isReviewTab = (value: unknown): value is ReviewTab =>
  typeof value === "string" && (TABS as readonly string[]).includes(value);

const useStyles = makeStyles({
  root: {
    gridArea: "main",
    display: "grid",
    gridTemplateRows: "auto auto 1fr auto",
    // One column that never grows with its content (long paths, long commands).
    gridTemplateColumns: "minmax(0, 1fr)",
    minHeight: 0,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  title: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
    flexShrink: 1,
  },
  tabs: { flexGrow: 1, flexShrink: 0 },
  details: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  path: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  body: {
    display: "grid",
    placeItems: "center",
    overflowY: "auto",
    color: tokens.colorNeutralForeground3,
  },
});

/** The Conversation tab: transcript plus composer. Keyed by review, so drafts and scroll reset. */
function ConversationTab({ review }: { review: Review }) {
  const status = useReviewStatus(review);
  const { entries, live, error, isLoading } = useConversation(review.id);
  return (
    <>
      {error ? (
        <Text role="alert">Could not load the conversation: {error.message}</Text>
      ) : (
        <Conversation entries={entries} live={live} status={status} loading={isLoading} />
      )}
      <Composer review={review} status={status} />
    </>
  );
}

interface Props {
  review: Review | undefined;
  onClosed: (note: string | null) => void;
}

export function MainPane({ review, onClosed }: Props) {
  const styles = useStyles();
  const [tab, setTab] = useState<ReviewTab>("conversation");
  const [closing, setClosing] = useState(false);

  if (!review) {
    return (
      <main className={styles.root}>
        <div />
        <div />
        <div className={styles.body}>
          <Text>Select a review or start a new one.</Text>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.header}>
        <StatusDot review={review} />
        <Subtitle1 as="h2" className={styles.title} title={review.title}>
          {review.title}
        </Subtitle1>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, data) => {
            if (isReviewTab(data.value)) setTab(data.value);
          }}
        >
          <Tab value="conversation">Conversation</Tab>
          <Tab value="findings">Findings</Tab>
          <Tab value="changes">Changes</Tab>
          <Tab value="comments">PR comments</Tab>
        </TabList>
        <Button icon={<DismissRegular />} appearance="subtle" onClick={() => setClosing(true)}>
          Close review
        </Button>
      </div>
      <div className={styles.details}>
        <Caption1>{describeReview(review)}</Caption1>
        <Caption1>
          head <span className={styles.mono}>{shortSha(review.headSha)}</span> · merge base{" "}
          <span className={styles.mono}>
            {review.mergeBaseSha ? shortSha(review.mergeBaseSha) : "none"}
          </span>
        </Caption1>
        <Badge appearance="tint" color={review.isolated ? "brand" : "warning"}>
          {review.isolated ? "Isolated worktree" : "In project folder"}
        </Badge>
        <Tooltip content={review.workdir} relationship="description">
          <Caption1 className={styles.path}>{review.workdir}</Caption1>
        </Tooltip>
      </div>
      {tab === "conversation" ? (
        <ConversationTab key={review.id} review={review} />
      ) : (
        <>
          <div className={styles.body}>
            <Text>This view arrives in a later phase — see docs/ROADMAP.md.</Text>
          </div>
          <div />
        </>
      )}
      <CloseReviewDialog
        review={review}
        open={closing}
        onOpenChange={setClosing}
        onClosed={onClosed}
      />
    </main>
  );
}
