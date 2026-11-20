import {
  Badge,
  Button,
  Caption1,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowSyncRegular, SendRegular } from "@fluentui/react-icons";
import { HOST_LABELS, type PrComment, type PrConversation } from "@problem/shared";
import { Markdown } from "../conversation/Markdown.tsx";
import { useOpenPullRequestLink, usePrConversation } from "./queries.ts";

type Conversation = Extract<PrConversation, { status: "ok" }>;

const REVIEW_STATE: Record<
  Conversation["reviews"][number]["state"],
  { label: string; color: "success" | "danger" | "informative" | "subtle" }
> = {
  APPROVED: { label: "Approved", color: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", color: "danger" },
  COMMENTED: { label: "Commented", color: "informative" },
  DISMISSED: { label: "Dismissed", color: "subtle" },
  PENDING: { label: "Pending", color: "subtle" },
};

const useStyles = makeStyles({
  root: { overflowY: "auto", minHeight: 0 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    maxWidth: "900px",
    marginInline: "auto",
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  grow: { flexGrow: 1, minWidth: 0 },
  // Each review and thread is its own card, with room between them.
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  card: {
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow2,
    overflow: "hidden",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground3,
    flexWrap: "wrap",
  },
  path: { fontFamily: tokens.fontFamilyMonospace },
  comment: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    overflowWrap: "anywhere",
  },
  meta: { color: tokens.colorNeutralForeground3 },
  empty: {
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    padding: tokens.spacingVerticalXXL,
  },
});

function Comment({ comment }: { comment: PrComment }) {
  const styles = useStyles();
  return (
    <div className={styles.comment}>
      <Caption1 className={styles.meta}>
        {comment.author} · {new Date(comment.createdAt).toLocaleString()}
      </Caption1>
      <Markdown text={comment.body} />
    </div>
  );
}

interface Props {
  reviewId: string;
  onPost: () => void;
}

/** The pull request's discussion on its host: review threads, comments and reviews. */
export function CommentsTab({ reviewId, onPost }: Props) {
  const styles = useStyles();
  const conversation = usePrConversation(reviewId);
  const open = useOpenPullRequestLink();
  const data = conversation.data;

  return (
    <div className={styles.root}>
      <div className={styles.column}>
        {conversation.isLoading && <Spinner size="small" label="Reading the pull request" />}
        {conversation.error && (
          <MessageBar intent="error">
            <MessageBarBody>
              Could not read the pull request: {conversation.error.message}
            </MessageBarBody>
          </MessageBar>
        )}
        {data?.status === "none" && <Text className={styles.empty}>{data.reason}</Text>}
        {data?.status === "ok" && (
          <>
            <div className={styles.toolbar}>
              <Text className={styles.grow} truncate wrap={false}>
                <Link
                  aria-label={`Open ${data.pullRequest.repo}#${data.pullRequest.number} on ${HOST_LABELS[data.pullRequest.host]}`}
                  onClick={() => open.mutate(data.pullRequest.url)}
                >
                  {data.pullRequest.repo}#{data.pullRequest.number}
                </Link>{" "}
                {data.pullRequest.title}
              </Text>
              <Button
                size="small"
                icon={<ArrowSyncRegular />}
                disabled={conversation.isFetching}
                onClick={() => void conversation.refetch()}
              >
                Reload
              </Button>
              <Button size="small" appearance="primary" icon={<SendRegular />} onClick={onPost}>
                Post review…
              </Button>
            </div>
            {open.error && <Caption1 role="alert">{open.error.message}</Caption1>}
            {data.truncated && (
              <MessageBar intent="info">
                <MessageBarBody>
                  This discussion is long; only the first part is shown (and given to Claude).
                </MessageBarBody>
              </MessageBar>
            )}
            {data.threads.length + data.comments.length + data.reviews.length === 0 && (
              <Text className={styles.empty}>No comments on this pull request yet.</Text>
            )}
            {data.reviews.length > 0 && (
              <section className={styles.section} aria-label="Reviews">
                <Subtitle2 as="h3">Reviews</Subtitle2>
                {data.reviews.map((review) => (
                  <div key={review.id} className={styles.card}>
                    <div className={styles.cardHead}>
                      <Badge appearance="tint" color={REVIEW_STATE[review.state].color}>
                        {REVIEW_STATE[review.state].label}
                      </Badge>
                      <Caption1>
                        {review.author}
                        {review.submittedAt &&
                          ` · ${new Date(review.submittedAt).toLocaleString()}`}
                      </Caption1>
                    </div>
                    {review.body.trim() !== "" && (
                      <div className={styles.comment}>
                        <Markdown text={review.body} />
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
            {data.threads.length > 0 && (
              <section className={styles.section} aria-label="Review threads">
                <Subtitle2 as="h3">Threads on the code</Subtitle2>
                {data.threads.map((thread) => (
                  <div key={thread.id} className={styles.card}>
                    <div className={styles.cardHead}>
                      <Text className={styles.path}>
                        {thread.path}
                        {thread.line !== null && `:${thread.line}`}
                      </Text>
                      {thread.isResolved && (
                        <Badge appearance="tint" color="success">
                          Resolved
                        </Badge>
                      )}
                      {thread.isOutdated && (
                        <Badge appearance="tint" color="subtle">
                          Outdated
                        </Badge>
                      )}
                    </div>
                    {thread.comments.map((comment) => (
                      <Comment key={comment.id} comment={comment} />
                    ))}
                  </div>
                ))}
              </section>
            )}
            {data.comments.length > 0 && (
              <section className={styles.section} aria-label="Conversation">
                <Subtitle2 as="h3">Conversation</Subtitle2>
                <div className={styles.card}>
                  {data.comments.map((comment) => (
                    <Comment key={comment.id} comment={comment} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
