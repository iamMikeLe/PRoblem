import {
  Button,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Spinner,
  Subtitle2,
  Text,
  Tooltip,
  tokens,
  useArrowNavigationGroup,
} from "@fluentui/react-components";
import {
  ComposeRegular,
  FolderAddRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
} from "@fluentui/react-icons";
import type { FindingCounts, Project, Review } from "@problem/shared";
import { useFindingCounts } from "../../features/findings/queries.ts";
import { describeReview, formatAge } from "../../features/reviews/describe.ts";
import { StatusDot } from "../../features/reviews/StatusDot.tsx";
import { useListItemStyles } from "./listItemStyles.ts";

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
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  heading: { flexGrow: 1 },
  // The collapsed list: buttons to show it again and to start a review.
  rail: {
    gridArea: "list",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
    paddingBlock: tokens.spacingVerticalM,
    paddingInline: tokens.spacingHorizontalXS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  list: { overflowY: "auto", paddingInline: tokens.spacingHorizontalS },
  group: {
    display: "block",
    margin: 0,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXS}`,
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
  },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  blockers: { color: tokens.colorPaletteRedForeground1 },
  status: { padding: tokens.spacingHorizontalL },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
});

interface Props {
  /** Undefined while the projects are loading. */
  projects: readonly Project[] | undefined;
  /** Set when the projects could not be loaded. */
  error: string | undefined;
  reviews: readonly Review[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAddProject: () => void;
  onNewReview: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/** Reviews grouped by project, in the order the projects API returns them. */
export function ListPane({
  projects,
  error,
  reviews,
  selectedId,
  onSelect,
  onAddProject,
  onNewReview,
  collapsed,
  onCollapsedChange,
}: Props) {
  const styles = useStyles();
  const item = useListItemStyles();
  const arrowNavigation = useArrowNavigationGroup({ axis: "vertical", memorizeCurrent: true });
  const byProject = Map.groupBy(reviews, (review) => review.projectId);
  const counts = useFindingCounts();
  const newReview = (
    <Tooltip content="New review" relationship="label">
      <Button
        appearance="subtle"
        icon={<ComposeRegular />}
        disabledFocusable={!projects?.length}
        onClick={onNewReview}
      />
    </Tooltip>
  );

  if (collapsed) {
    return (
      <aside className={styles.rail} aria-label="Reviews">
        <Tooltip content="Show reviews" relationship="label">
          <Button
            appearance="subtle"
            icon={<PanelLeftExpandRegular />}
            aria-expanded={false}
            onClick={() => onCollapsedChange(false)}
          />
        </Tooltip>
        {newReview}
      </aside>
    );
  }

  return (
    <aside className={styles.root} aria-label="Reviews">
      <div className={styles.header}>
        <Subtitle2 as="h2" className={styles.heading}>
          Reviews
        </Subtitle2>
        {newReview}
        <Tooltip content="Hide reviews" relationship="label">
          <Button
            appearance="subtle"
            icon={<PanelLeftContractRegular />}
            aria-expanded
            onClick={() => onCollapsedChange(true)}
          />
        </Tooltip>
      </div>
      {error !== undefined && (
        <MessageBar intent="error" className={styles.status}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {projects === undefined && error === undefined && (
        <Spinner className={styles.status} size="small" label="Loading" />
      )}
      {projects?.length === 0 && (
        <div className={styles.empty}>
          <Text className={item.muted}>Add a project to start reviewing.</Text>
          <Button icon={<FolderAddRegular />} onClick={onAddProject}>
            Add project
          </Button>
        </div>
      )}
      {projects !== undefined && projects.length > 0 && reviews.length === 0 && (
        <div className={styles.empty}>
          <Text className={item.muted}>No open reviews.</Text>
          <Button icon={<ComposeRegular />} onClick={onNewReview}>
            New review
          </Button>
        </div>
      )}
      <div className={styles.list} {...arrowNavigation}>
        {projects?.map((project) => {
          if (!byProject.has(project.id)) return null;
          return (
            <div key={project.id}>
              <Text as="h3" size={200} weight="semibold" className={styles.group}>
                {project.name}
              </Text>
              {(byProject.get(project.id) ?? []).map((review) => (
                <button
                  key={review.id}
                  type="button"
                  aria-current={review.id === selectedId ? "true" : undefined}
                  className={mergeClasses(
                    item.item,
                    styles.row,
                    review.id === selectedId && item.selected,
                  )}
                  onClick={() => onSelect(review.id)}
                >
                  <StatusDot review={review} />
                  <span className={styles.text}>
                    <Text weight="semibold" className={item.ellipsis}>
                      {review.title}
                    </Text>
                    <Text size={200} className={mergeClasses(item.ellipsis, item.muted)}>
                      {describeReview(review)}
                    </Text>
                    <FindingsLine counts={counts.data?.[review.id]} />
                  </span>
                  <Text size={200} className={item.muted}>
                    {formatAge(review.createdAt)}
                  </Text>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** "4 open · 1 blocker" under a review; nothing when it has no open findings. */
function FindingsLine({ counts }: { counts: FindingCounts | undefined }) {
  const styles = useStyles();
  const item = useListItemStyles();
  if (!counts || counts.open === 0) return null;
  return (
    <Text size={200} className={mergeClasses(item.ellipsis, item.muted)}>
      {counts.open} open
      {counts.blockers > 0 && (
        <span className={styles.blockers}>
          {" "}
          · {counts.blockers} {counts.blockers === 1 ? "blocker" : "blockers"}
        </span>
      )}
    </Text>
  );
}
