import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  Subtitle1,
  Tab,
  TabList,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { ComposeRegular, DismissRegular } from "@fluentui/react-icons";
import type { Finding, Review } from "@problem/shared";
import { lazy, Suspense, useState } from "react";
import { Composer } from "../../features/conversation/Composer.tsx";
import { Conversation } from "../../features/conversation/Conversation.tsx";
import { useDrafts } from "../../features/conversation/drafts.ts";
import { useConversation } from "../../features/conversation/queries.ts";
import { usePendingApprovals, useReviewStatus } from "../../features/conversation/store.ts";
import { FindingsTab } from "../../features/findings/FindingsTab.tsx";
import { useFindingCounts } from "../../features/findings/queries.ts";
import { PostReviewDialog } from "../../features/github/PostReviewDialog.tsx";
import { useOpenGitHub } from "../../features/github/queries.ts";
import { useProjects } from "../../features/projects/queries.ts";
import { CloseReviewDialog } from "../../features/reviews/CloseReviewDialog.tsx";
import { describeReview, shortSha } from "../../features/reviews/describe.ts";
import { StatusDot } from "../../features/reviews/StatusDot.tsx";
import type { SearchTarget } from "../../features/search/GlobalSearch.tsx";
import { useShortcuts } from "../../lib/shortcuts.ts";
import { ErrorBoundary } from "../ErrorBoundary.tsx";
import { LoadingRows } from "../LoadingRows.tsx";

// The diff viewer and the PR discussion load when their tab is first opened.
const ChangesTab = lazy(() =>
  import("../../features/changes/ChangesTab.tsx").then((m) => ({ default: m.ChangesTab })),
);
const CommentsTab = lazy(() =>
  import("../../features/github/CommentsTab.tsx").then((m) => ({ default: m.CommentsTab })),
);

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
  posted: { flexBasis: "100%" },
  count: { marginInlineStart: tokens.spacingHorizontalXS },
  path: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalM,
    textAlign: "center",
    maxWidth: "420px",
  },
  body: {
    display: "grid",
    placeItems: "center",
    overflowY: "auto",
    color: tokens.colorNeutralForeground3,
  },
});

/** The Conversation tab: transcript plus composer. Keyed by review, so drafts and scroll reset. */
function ConversationTab({
  review,
  autoFocus,
  onFocused,
}: {
  review: Review;
  autoFocus: boolean;
  onFocused: () => void;
}) {
  const status = useReviewStatus(review);
  const { entries, live, error, isLoading } = useConversation(review.id);
  const approvals = usePendingApprovals(review.id);
  return (
    <>
      {error ? (
        <Text role="alert">Could not load the conversation: {error.message}</Text>
      ) : (
        <Conversation
          entries={entries}
          live={live}
          status={status}
          loading={isLoading}
          approvals={approvals}
        />
      )}
      <Composer review={review} status={status} autoFocus={autoFocus} onFocused={onFocused} />
    </>
  );
}

interface Props {
  review: Review | undefined;
  /** A search result to show in this review (a new object each time one is chosen). */
  focus?: SearchTarget | undefined;
  onClosed: (note: string | null) => void;
  /** Starts a review; undefined while there is no project to review. */
  onNewReview?: (() => void) | undefined;
}

export function MainPane({ review, focus, onClosed, onNewReview }: Props) {
  const styles = useStyles();
  const [tab, setTab] = useState<ReviewTab>("conversation");
  const [closing, setClosing] = useState(false);
  // The review of an "Ask about #N": its composer takes focus once, then this is cleared.
  const [asking, setAsking] = useState<string>();
  // The finding to select when the Findings tab opens from the Changes tab.
  const [shownFinding, setShownFinding] = useState<number>();
  // The file to select when the Changes tab opens from search.
  const [shownFile, setShownFile] = useState<string>();
  // A new search result: switch tabs while rendering (no effect, so no flash of the old tab).
  const [shownFocus, setShownFocus] = useState<SearchTarget>();
  if (focus !== shownFocus && focus?.reviewId === review?.id) {
    setShownFocus(focus);
    setAsking(undefined);
    setShownFinding(focus?.kind === "finding" ? focus.number : undefined);
    setShownFile(focus?.kind === "file" ? focus.path : undefined);
    setTab(
      focus?.kind === "finding"
        ? "findings"
        : focus?.kind === "file"
          ? "changes"
          : focus?.kind === "tab"
            ? focus.tab
            : "conversation",
    );
  }
  const projects = useProjects();
  // The "post to GitHub" preview, and the link of the review just posted.
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<{ reviewId: string; url: string }>();
  const openGitHub = useOpenGitHub();
  const setDraft = useDrafts((state) => state.setDraft);
  const counts = useFindingCounts();

  const selectTab = (value: ReviewTab) => {
    setAsking(undefined);
    setShownFinding(undefined);
    setShownFile(undefined);
    setTab(value);
  };
  const reviewShortcuts = review
    ? {
        ...Object.fromEntries(TABS.map((value, index) => [`${index + 1}`, () => selectTab(value)])),
        r: () => {
          selectTab("conversation");
          setAsking(review.id);
        },
      }
    : {};
  useShortcuts(reviewShortcuts);

  if (!review) {
    return (
      <main className={styles.root}>
        <div />
        <div />
        <div className={styles.body}>
          <div className={styles.welcome}>
            <Subtitle1 as="h2">No review selected</Subtitle1>
            <Text>
              {onNewReview
                ? "Pick a review on the left, or start one for a branch or a pull request."
                : "Add a project first: a Git repository on this machine."}
            </Text>
            {onNewReview && (
              <Button appearance="primary" icon={<ComposeRegular />} onClick={onNewReview}>
                New review
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  const openCount = counts.data?.[review.id]?.open ?? 0;
  const project = projects.data?.find((p) => p.id === review.projectId);
  const ask = (finding: Finding, request?: string) => {
    const prefix = request ?? `About #${finding.number} (${finding.title}): `;
    // A full request keeps what the user had typed, on its own paragraph below.
    const join = request !== undefined ? "\n\n" : "";
    setDraft(review.id, (current) =>
      current.startsWith(prefix)
        ? current
        : current.trim() === ""
          ? prefix
          : `${prefix}${join}${current}`,
    );
    setAsking(review.id);
    setTab("conversation");
  };

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
            if (isReviewTab(data.value)) selectTab(data.value);
          }}
        >
          <Tab value="conversation">Conversation</Tab>
          <Tab value="findings">
            Findings
            {openCount > 0 && (
              <Badge className={styles.count} size="small" appearance="tint" color="brand">
                {openCount}
              </Badge>
            )}
          </Tab>
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
        {posted?.reviewId === review.id && (
          <MessageBar intent="success" className={styles.posted}>
            <MessageBarBody>Posted to GitHub.</MessageBarBody>
            <MessageBarActions
              containerAction={
                <Button
                  aria-label="Dismiss"
                  appearance="transparent"
                  icon={<DismissRegular />}
                  onClick={() => setPosted(undefined)}
                />
              }
            >
              <Button size="small" onClick={() => openGitHub.mutate(posted.url)}>
                Open on GitHub
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}
      </div>
      {/* One tab failing leaves the header, the other tabs and the review list working. */}
      <ErrorBoundary resetKey={`${review.id}:${tab}`} what="This tab">
        <Suspense fallback={<LoadingRows label="Loading" />}>
          {tab === "conversation" ? (
            <ConversationTab
              key={review.id}
              review={review}
              autoFocus={asking === review.id}
              onFocused={() => setAsking(undefined)}
            />
          ) : tab === "findings" ? (
            <>
              <FindingsTab
                key={`${review.id}:${shownFinding ?? ""}`}
                reviewId={review.id}
                onAsk={ask}
                initialSelected={shownFinding}
                onPost={() => setPosting(true)}
              />
              {/* The last grid row holds the composer on the Conversation tab. */}
              <div />
            </>
          ) : tab === "changes" ? (
            <>
              <ChangesTab
                key={`${review.id}:${shownFile ?? ""}`}
                review={review}
                initialFile={shownFile}
                project={project}
                onShowFinding={(finding) => {
                  setShownFinding(finding.number);
                  setTab("findings");
                }}
              />
              <div />
            </>
          ) : (
            <>
              <CommentsTab key={review.id} reviewId={review.id} onPost={() => setPosting(true)} />
              <div />
            </>
          )}
        </Suspense>
      </ErrorBoundary>
      {posting && (
        <PostReviewDialog
          reviewId={review.id}
          open
          onOpenChange={setPosting}
          onPosted={(url) => setPosted({ reviewId: review.id, url })}
        />
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
