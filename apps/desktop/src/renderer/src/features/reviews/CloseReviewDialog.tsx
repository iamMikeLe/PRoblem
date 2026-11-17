import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { Review } from "@reviewroom/shared";
import { useCloseReview } from "./queries.ts";

const useStyles = makeStyles({
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
});

interface Props {
  review: Review;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after closing, with what happened to the project folder (in-place reviews). */
  onClosed: (note: string | null) => void;
}

export function CloseReviewDialog({ review, open, onOpenChange: setOpen, onClosed }: Props) {
  const styles = useStyles();
  const close = useCloseReview();
  // Closing the dialog forgets a failed attempt, so it never shows up for another review.
  const onOpenChange = (next: boolean) => {
    if (!next) close.reset();
    setOpen(next);
  };

  const confirm = () =>
    close.mutate(review.id, {
      onSuccess: (result) => {
        onOpenChange(false);
        onClosed(result.note);
      },
    });

  return (
    <Dialog
      modalType="alert"
      open={open}
      onOpenChange={(_, data) => {
        if (!close.isPending) onOpenChange(data.open);
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Close “{review.title}”?</DialogTitle>
          <DialogContent className={styles.content}>
            <Text>
              {review.isolated
                ? "The review's worktree folder is deleted. The review is archived."
                : "The project folder switches back to the branch it was on, if it has no uncommitted changes. The review is archived."}
            </Text>
            {close.isError && (
              <MessageBar intent="error">
                <MessageBarBody>{close.error.message}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => onOpenChange(false)}
              disabled={close.isPending}
            >
              Cancel
            </Button>
            <Button appearance="primary" onClick={confirm} disabled={close.isPending}>
              {close.isPending ? "Closing…" : "Close review"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
