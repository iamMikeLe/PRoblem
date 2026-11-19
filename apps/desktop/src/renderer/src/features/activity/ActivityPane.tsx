import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  Subtitle2,
  Tab,
  TabList,
  Text,
  Tooltip,
  tokens,
  useArrowNavigationGroup,
} from "@fluentui/react-components";
import {
  BranchRegular,
  CheckmarkCircleRegular,
  CheckmarkUnderlineCircleRegular,
  CommentMultipleRegular,
  ErrorCircleRegular,
  type FluentIcon,
  HandRightRegular,
  SendRegular,
} from "@fluentui/react-icons";
import type { ActivityItem, ActivityKind } from "@problem/shared";
import { useState } from "react";
import { LoadingRows } from "../../app/LoadingRows.tsx";
import { useListItemStyles } from "../../app/layout/listItemStyles.ts";
import { formatAge } from "../reviews/describe.ts";
import { describeActivity } from "./describe.ts";
import { useActivity, useMarkActivityRead } from "./queries.ts";

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
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`,
  },
  heading: { flexGrow: 1 },
  filters: { paddingInline: tokens.spacingHorizontalS },
  list: {
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalS,
    paddingBlock: tokens.spacingVerticalXS,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "start",
    columnGap: tokens.spacingHorizontalM,
  },
  icon: { fontSize: "20px", marginTop: tokens.spacingVerticalXXS },
  approval: { color: tokens.colorStatusWarningForeground1 },
  finished: { color: tokens.colorStatusSuccessForeground1 },
  failed: { color: tokens.colorStatusDangerForeground1 },
  neutral: { color: tokens.colorBrandForeground1 },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  side: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: tokens.spacingVerticalSNudge,
  },
  empty: { padding: tokens.spacingHorizontalL },
  status: { margin: tokens.spacingHorizontalL },
});

const ICONS: Record<ActivityKind, FluentIcon> = {
  approval: HandRightRegular,
  finished: CheckmarkCircleRegular,
  failed: ErrorCircleRegular,
  commits: BranchRegular,
  comments: CommentMultipleRegular,
  posted: SendRegular,
};

/** The icon's color: approvals warn, results succeed or fail, the rest are news. */
const TONE: Record<ActivityKind, "approval" | "finished" | "failed" | "neutral"> = {
  approval: "approval",
  finished: "finished",
  failed: "failed",
  commits: "neutral",
  comments: "neutral",
  posted: "neutral",
};

type Filter = "all" | "unread";

interface Props {
  selectedId: string | undefined;
  /** The user opened a row (it is marked as read here). */
  onOpen: (item: ActivityItem) => void;
}

/** The Activity feed (ADR 0015): what happened in open reviews, newest first. */
export function ActivityPane({ selectedId, onOpen }: Props) {
  const styles = useStyles();
  const item = useListItemStyles();
  const arrowNavigation = useArrowNavigationGroup({ axis: "vertical", memorizeCurrent: true });
  const activity = useActivity();
  const markRead = useMarkActivityRead();
  const [filter, setFilter] = useState<Filter>("all");

  const all = activity.data ?? [];
  const unread = all.filter((row) => !row.read).length;
  // A row read just now stays in the Unread filter until the filter changes, so it never jumps away.
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const shown = filter === "unread" ? all.filter((row) => !row.read || keep.has(row.id)) : all;

  const open = (row: ActivityItem) => {
    if (!row.read) {
      markRead.mutate([row.id]);
      setKeep((current) => new Set(current).add(row.id));
    }
    onOpen(row);
  };

  return (
    <aside className={styles.root} aria-label="Activity">
      <div className={styles.header}>
        <Subtitle2 as="h2" className={styles.heading}>
          Activity
        </Subtitle2>
        <Tooltip content="Mark all as read" relationship="label">
          <Button
            appearance="subtle"
            icon={<CheckmarkUnderlineCircleRegular />}
            disabledFocusable={unread === 0}
            // The rows on screen only: one that arrived meanwhile was never seen.
            onClick={() => markRead.mutate(all.filter((row) => !row.read).map((row) => row.id))}
          />
        </Tooltip>
      </div>
      <TabList
        size="small"
        aria-label="Filter activity"
        className={styles.filters}
        selectedValue={filter}
        onTabSelect={(_event, data) => {
          if (data.value === "all" || data.value === "unread") {
            setFilter(data.value);
            setKeep(new Set());
          }
        }}
      >
        <Tab value="all">All</Tab>
        <Tab value="unread">{unread > 0 ? `Unread (${unread})` : "Unread"}</Tab>
      </TabList>
      {activity.isError && (
        <MessageBar intent="error" className={styles.status}>
          <MessageBarBody>Could not load activity: {activity.error.message}</MessageBarBody>
        </MessageBar>
      )}
      {activity.isPending && <LoadingRows label="Loading activity" />}
      {activity.isSuccess && shown.length === 0 && (
        <Text className={mergeClasses(styles.empty, item.muted)}>
          {filter === "unread"
            ? "You're all caught up."
            : "Nothing yet. When Claude finishes, fails or needs you, it shows up here."}
        </Text>
      )}
      <div className={styles.list} {...arrowNavigation}>
        {shown.map((row) => {
          const Icon = ICONS[row.detail.kind];
          const { title, summary } = describeActivity(row.detail);
          return (
            <button
              key={row.id}
              type="button"
              aria-current={row.id === selectedId ? "true" : undefined}
              // The unread dot and bold headline, in words; plus everything the row shows.
              aria-label={`${row.read ? "" : "Unread: "}${title}, ${summary}. ${row.reviewTitle} · ${row.projectName}, ${formatAge(row.at)}`}
              className={mergeClasses(
                item.item,
                styles.row,
                row.id === selectedId && item.selected,
              )}
              onClick={() => open(row)}
            >
              <Icon className={mergeClasses(styles.icon, styles[TONE[row.detail.kind]])} />
              <span className={styles.text}>
                <Text weight={row.read ? "regular" : "semibold"} className={item.ellipsis}>
                  {title}
                </Text>
                <Text size={200} className={item.ellipsis}>
                  {summary}
                </Text>
                <Text size={200} className={mergeClasses(item.ellipsis, item.muted)}>
                  {row.reviewTitle} · {row.projectName}
                </Text>
              </span>
              <span className={styles.side}>
                <Text size={200} className={item.muted}>
                  {formatAge(row.at)}
                </Text>
                {!row.read && (
                  <Badge size="extra-small" shape="circular" color="brand" aria-hidden />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
