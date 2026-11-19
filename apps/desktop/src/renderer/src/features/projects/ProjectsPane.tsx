import {
  Button,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Subtitle2,
  Text,
  Tooltip,
  tokens,
  useArrowNavigationGroup,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import type { Project } from "@problem/shared";
import { useState } from "react";
import { LoadingRows } from "../../app/LoadingRows.tsx";
import { useListItemStyles } from "../../app/layout/listItemStyles.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { useProjects } from "./queries.ts";

const useStyles = makeStyles({
  root: {
    gridArea: "list",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalS,
  },
  row: { display: "flex", flexDirection: "column" },
  status: { padding: tokens.spacingHorizontalL },
});

interface Props {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

/** List pane of the Projects section: every registered repository, plus "Add project". */
export function ProjectsPane({ selectedId, onSelect }: Props) {
  const styles = useStyles();
  const item = useListItemStyles();
  const projects = useProjects();
  const [adding, setAdding] = useState(false);
  const arrowNavigation = useArrowNavigationGroup({ axis: "vertical", memorizeCurrent: true });

  const onCreated = (project: Project) => {
    setAdding(false);
    onSelect(project.id);
  };

  return (
    <aside className={styles.root} aria-label="Projects">
      <div className={styles.header}>
        <Subtitle2 as="h2">Projects</Subtitle2>
        <Tooltip content="Add project" relationship="label">
          <Button appearance="subtle" icon={<AddRegular />} onClick={() => setAdding(true)} />
        </Tooltip>
      </div>
      {projects.isPending && <LoadingRows label="Loading projects" />}
      {projects.isError && (
        <MessageBar intent="error" className={styles.status}>
          <MessageBarBody>Could not load projects: {projects.error.message}</MessageBarBody>
        </MessageBar>
      )}
      {projects.isSuccess && projects.data.length === 0 && (
        <Text className={mergeClasses(styles.status, item.muted)}>
          No projects yet. Add a git repository to start reviewing.
        </Text>
      )}
      {projects.isSuccess && projects.data.length > 0 && (
        <div className={styles.list} {...arrowNavigation}>
          {projects.data.map((project) => (
            <button
              key={project.id}
              type="button"
              aria-current={project.id === selectedId ? "true" : undefined}
              className={mergeClasses(
                item.item,
                styles.row,
                project.id === selectedId && item.selected,
              )}
              onClick={() => onSelect(project.id)}
            >
              <Text weight="semibold" className={item.ellipsis}>
                {project.name}
              </Text>
              <Text size={200} className={mergeClasses(item.ellipsis, item.muted)}>
                {project.path}
              </Text>
            </button>
          ))}
        </div>
      )}
      <AddProjectDialog open={adding} onClose={() => setAdding(false)} onCreated={onCreated} />
    </aside>
  );
}
