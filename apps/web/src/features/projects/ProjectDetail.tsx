import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Subtitle1,
  Text,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import type { Project } from "@reviewroom/shared";
import { useState } from "react";
import { useDeleteProject } from "./queries.ts";
import { ReviewPromptEditor } from "./ReviewPromptEditor.tsx";

const useStyles = makeStyles({
  root: {
    gridArea: "main",
    display: "grid",
    gridTemplateRows: "auto 1fr",
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  titles: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 },
  ellipsis: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dialogContent: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  body: { overflowY: "auto", padding: tokens.spacingHorizontalL },
  emptyRoot: {
    gridArea: "main",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

interface Props {
  project: Project | undefined;
  onRemoved: () => void;
}

/** Main pane of the Projects section: the selected project's settings. */
export function ProjectDetail({ project, onRemoved }: Props) {
  const styles = useStyles();
  const remove = useDeleteProject();
  const [confirming, setConfirming] = useState(false);

  if (!project) {
    return (
      <main className={styles.emptyRoot} aria-label="Project settings">
        <Text>Select a project or add one.</Text>
      </main>
    );
  }

  const confirmRemove = () => {
    remove.mutate(project.id, {
      onSuccess: () => {
        setConfirming(false);
        onRemoved();
      },
    });
  };

  return (
    <main className={styles.root} aria-label={`${project.name} settings`}>
      <div className={styles.header}>
        <div className={styles.titles}>
          <Subtitle1 as="h2" className={styles.ellipsis}>
            {project.name}
          </Subtitle1>
          <Caption1 className={mergeClasses(styles.ellipsis, styles.muted)}>
            {project.path}
          </Caption1>
        </div>
        <Button
          appearance="subtle"
          icon={<DeleteRegular />}
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
        >
          Remove
        </Button>
      </div>
      <div className={styles.body}>
        <ReviewPromptEditor key={project.id} project={project} />
      </div>
      <Dialog
        modalType="alert"
        open={confirming}
        onOpenChange={(_, data) => {
          if (!remove.isPending) setConfirming(data.open);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Remove {project.name}?</DialogTitle>
            <DialogContent className={styles.dialogContent}>
              <Text>
                ReviewRoom forgets this project and its review prompt. The repository on disk is not
                touched.
              </Text>
              {remove.isError && (
                <MessageBar intent="error">
                  <MessageBarBody>{remove.error.message}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setConfirming(false)}
                disabled={remove.isPending}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={confirmRemove} disabled={remove.isPending}>
                {remove.isPending ? "Removing…" : "Remove project"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </main>
  );
}
