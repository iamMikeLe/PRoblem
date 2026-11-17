import {
  Button,
  makeStyles,
  mergeClasses,
  Subtitle2,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { ComposeRegular } from "@fluentui/react-icons";
import type { ReviewListItem } from "../../features/reviews/placeholder.ts";
import { StatusDot } from "../../features/reviews/StatusDot.tsx";

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
  list: { overflowY: "auto", paddingInline: tokens.spacingHorizontalS },
  group: {
    display: "block",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXS}`,
    color: tokens.colorNeutralForeground3,
  },
  item: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    width: "100%",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "none",
    textAlign: "start",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  selected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Selected },
  },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

interface Props {
  reviews: readonly ReviewListItem[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function ListPane({ reviews, selectedId, onSelect }: Props) {
  const styles = useStyles();
  const byProject = Map.groupBy(reviews, (review) => review.project);

  return (
    <aside className={styles.root} aria-label="Reviews">
      <div className={styles.header}>
        <Subtitle2>Reviews</Subtitle2>
        <Tooltip content="New review" relationship="label">
          <Button appearance="subtle" icon={<ComposeRegular />} />
        </Tooltip>
      </div>
      <div className={styles.list}>
        {[...byProject].map(([project, items]) => (
          <section key={project}>
            <Text size={200} weight="semibold" className={styles.group}>
              {project}
            </Text>
            {items.map((review) => (
              <button
                key={review.id}
                type="button"
                aria-current={review.id === selectedId ? "true" : undefined}
                className={mergeClasses(styles.item, review.id === selectedId && styles.selected)}
                onClick={() => onSelect(review.id)}
              >
                <StatusDot status={review.status} />
                <span className={styles.text}>
                  <Text weight="semibold" className={styles.ellipsis}>
                    {review.title}
                  </Text>
                  <Text size={200} className={mergeClasses(styles.ellipsis, styles.muted)}>
                    {review.subtitle}
                  </Text>
                </span>
                <Text size={200} className={styles.muted}>
                  {review.updated}
                </Text>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
