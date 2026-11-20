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
  tokens,
} from "@fluentui/react-components";
import {
  HOST_LABELS,
  PostFindingSchema,
  type PostItem,
  PostReviewRequestSchema,
  type ReviewEvent,
  ReviewEventSchema,
} from "@problem/shared";
import { useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
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
    maxHeight: "50vh",
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
  editor: { marginTop: tokens.spacingVerticalXS },
  error: { color: tokens.colorPaletteRedForeground1 },
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
 * The only way anything is written to GitHub or Bitbucket (ADR 0014, 0019): the user sees exactly what is posted —
 * the summary, each finding's text and where it goes — and clicks Post. Each finding's text can be
 * edited first; edits live only in this dialog (ADR 0017).
 */
export function PostReviewDialog({ reviewId, open, onOpenChange, onPosted }: Props) {
  const styles = useStyles();
  const preview = usePostPreview(reviewId, open);
  const post = usePostReview();
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [chosen, setChosen] = useState<Set<number>>();
  /** The user's text per finding number, when they edited it. */
  const [edits, setEdits] = useState<ReadonlyMap<number, string>>(new Map());

  const data = preview.data?.status === "ok" ? preview.data : undefined;
  const selected = chosen ?? new Set(data?.items.filter((i) => i.selected).map((i) => i.number));
  const textOf = (item: PostItem) => edits.get(item.number) ?? item.text;
  const request = {
    id: reviewId,
    event,
    body,
    findings: (data?.items ?? [])
      .filter((item) => selected.has(item.number))
      .sort((a, b) => a.number - b.number)
      .map((item) => ({ number: item.number, text: textOf(item) })),
  };
  const check = PostReviewRequestSchema.safeParse(request);
  // A finding's own text problem is shown under that finding.
  const problem = check.error?.issues.find(
    (issue) => !(issue.path[0] === "findings" && issue.path.length > 1),
  )?.message;
  const canPost = data?.upToDate === true && check.success && !post.isPending;

  const toggle = (number: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(number);
    else next.delete(number);
    setChosen(next);
  };

  const edit = (item: PostItem, text: string) => {
    const next = new Map(edits);
    if (text === item.text) next.delete(item.number);
    else next.set(item.number, text);
    setEdits(next);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            Post a review to {data ? HOST_LABELS[data.pullRequest.host] : "the pull request"}
          </DialogTitle>
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
                {data.pullRequest.host === "bitbucket" && (
                  <Caption1 className={styles.muted}>
                    Bitbucket takes each finding as its own comment, then the summary, then your
                    verdict. If one fails, what was posted stays and the rest can be posted again.
                  </Caption1>
                )}
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
                <Field label="Summary" hint="Posted as the review's comment, as you write it.">
                  <MarkdownEditor
                    label="Summary"
                    value={body}
                    onChange={setBody}
                    placeholder="Optional for a comment, needed to request changes."
                    maxRows={8}
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
                  {data.items.map((item) => {
                    const text = textOf(item);
                    const edited = text !== item.text;
                    const invalid = selected.has(item.number)
                      ? PostFindingSchema.safeParse({ number: item.number, text }).error
                      : undefined;
                    return (
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
                          {edited && (
                            <Badge appearance="tint" color="brand">
                              edited
                            </Badge>
                          )}
                        </div>
                        <div className={styles.editor}>
                          <MarkdownEditor
                            label={`Text of finding #${item.number}`}
                            value={text}
                            original={item.text}
                            onChange={(value) => edit(item, value)}
                            readOnly={item.postedUrl !== null}
                            maxRows={10}
                          />
                        </div>
                        {invalid && (
                          <Caption1 className={styles.error} role="alert">
                            {invalid.issues[0]?.message}
                          </Caption1>
                        )}
                        {edited && !invalid && (
                          <Caption1 className={styles.muted}>
                            Posted as you wrote it: an @name you type notifies that person.
                          </Caption1>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Caption1 className={styles.muted}>
                  Mentions in Claude's text (@name) are posted without notifying anyone.
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
