import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import {
  type PostItem,
  PostReviewRequestSchema,
  type ReviewEvent,
  ReviewEventSchema,
} from "@problem/shared";
import { useState } from "react";
import { usePostPreview, usePostReview } from "./queries.ts";

const EVENT_LABEL: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};

const useStyles = makeStyles({
  surface: { maxWidth: "820px", width: "90vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  items: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    maxHeight: "40vh",
    overflowY: "auto",
  },
  item: {
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalS,
  },
  itemHead: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  text: {
    margin: 0,
    marginTop: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    maxHeight: "200px",
    overflowY: "auto",
  },
});

/** The title line of a finding's text (`**Major: title** …`), for the checkbox label. */
function titleOf(item: PostItem): string {
  return item.text.split("\n")[0]?.replace(/\*\*/g, "") ?? `#${item.number}`;
}

interface Props {
  reviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted: (url: string) => void;
}

/**
 * The only way anything is written to GitHub (ADR 0014): the user sees exactly what is posted —
 * the summary, each finding's text and where it goes — and clicks Post.
 */
export function PostReviewDialog({ reviewId, open, onOpenChange, onPosted }: Props) {
  const styles = useStyles();
  const preview = usePostPreview(reviewId, open);
  const post = usePostReview();
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [chosen, setChosen] = useState<Set<number>>();

  const data = preview.data?.status === "ok" ? preview.data : undefined;
  const selected = chosen ?? new Set(data?.items.filter((i) => i.selected).map((i) => i.number));
  const request = { id: reviewId, event, body, findings: [...selected].sort((a, b) => a - b) };
  const check = PostReviewRequestSchema.safeParse(request);
  const problem = check.success ? undefined : check.error.issues[0]?.message;
  const canPost = data?.upToDate === true && check.success && !post.isPending;

  const toggle = (number: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(number);
    else next.delete(number);
    setChosen(next);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Post a review to GitHub</DialogTitle>
          <DialogContent className={styles.content}>
            {preview.isLoading && <Spinner size="small" label="Preparing the review" />}
            {preview.error && (
              <MessageBar intent="error">
                <MessageBarBody>{preview.error.message}</MessageBarBody>
              </MessageBar>
            )}
            {preview.data?.status === "none" && (
              <MessageBar intent="info">
                <MessageBarBody>{preview.data.reason}</MessageBarBody>
              </MessageBar>
            )}
            {data && (
              <>
                <Text>
                  To {data.pullRequest.repo}#{data.pullRequest.number}. Nothing is sent before you
                  click Post.
                </Text>
                {!data.upToDate && (
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      The pull request has new commits. Refresh the review in the Changes tab first,
                      so comments land on the right lines.
                    </MessageBarBody>
                  </MessageBar>
                )}
                <Field label="Review">
                  <RadioGroup
                    layout="horizontal"
                    value={event}
                    onChange={(_, d) => {
                      const parsed = ReviewEventSchema.safeParse(d.value);
                      if (parsed.success) setEvent(parsed.data);
                    }}
                  >
                    {ReviewEventSchema.options.map((option) => (
                      <Radio key={option} value={option} label={EVENT_LABEL[option]} />
                    ))}
                  </RadioGroup>
                </Field>
                <Field label="Summary" hint="Markdown, posted as the review's comment.">
                  <Textarea
                    value={body}
                    onChange={(_, d) => setBody(d.value)}
                    resize="vertical"
                    rows={4}
                  />
                </Field>
                <Text weight="semibold">
                  Findings ({selected.size} of {data.items.length} selected)
                </Text>
                {data.items.length === 0 && (
                  <Caption1 className={styles.muted}>
                    No findings to post (dismissed and withdrawn ones are left out).
                  </Caption1>
                )}
                <div className={styles.items}>
                  {data.items.map((item) => (
                    <div key={item.number} className={styles.item}>
                      <div className={styles.itemHead}>
                        <Checkbox
                          // Posted findings are never posted again (main refuses them too).
                          disabled={item.postedUrl !== null}
                          checked={selected.has(item.number)}
                          onChange={(_, d) => toggle(item.number, d.checked === true)}
                          label={`#${item.number} ${titleOf(item)}`}
                        />
                        <Caption1 className={styles.muted}>
                          {item.placement === "inline"
                            ? "on its line"
                            : `in the summary: ${item.reason ?? ""}`}
                        </Caption1>
                        {item.postedUrl && (
                          <Badge appearance="tint" color="informative">
                            already posted
                          </Badge>
                        )}
                      </div>
                      <details>
                        <summary>
                          <Caption1>Exact text</Caption1>
                        </summary>
                        <pre className={styles.text}>{item.text}</pre>
                      </details>
                    </div>
                  ))}
                </div>
                <Caption1 className={styles.muted}>
                  Mentions in findings (@name) are posted without notifying anyone.
                </Caption1>
              </>
            )}
            {problem && data && <Caption1 role="alert">{problem}</Caption1>}
            {post.error && (
              <MessageBar intent="error">
                <MessageBarBody>{post.error.message}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={!canPost}
              onClick={() =>
                post.mutate(request, {
                  onSuccess: (result) => {
                    onOpenChange(false);
                    onPosted(result.url);
                  },
                })
              }
            >
              {post.isPending
                ? "Posting…"
                : data
                  ? `Post to ${data.pullRequest.repo}#${data.pullRequest.number}`
                  : "Post"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
