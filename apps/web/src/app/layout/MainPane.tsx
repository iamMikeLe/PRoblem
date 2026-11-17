import {
  Button,
  makeStyles,
  Subtitle1,
  Tab,
  TabList,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { SendRegular, StopRegular } from "@fluentui/react-icons";
import { useState } from "react";
import type { ReviewListItem } from "../../features/reviews/placeholder.ts";
import { StatusDot } from "../../features/reviews/StatusDot.tsx";

type ReviewTab = "conversation" | "findings" | "changes" | "comments";

const useStyles = makeStyles({
  root: {
    gridArea: "main",
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  title: { whiteSpace: "nowrap" },
  tabs: { flexGrow: 1 },
  body: {
    display: "grid",
    placeItems: "center",
    overflowY: "auto",
    color: tokens.colorNeutralForeground3,
  },
  composer: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "flex-end",
    padding: tokens.spacingHorizontalL,
  },
  input: { flexGrow: 1 },
  empty: { color: tokens.colorNeutralForeground3 },
});

export function MainPane({ review }: { review: ReviewListItem | undefined }) {
  const styles = useStyles();
  const [tab, setTab] = useState<ReviewTab>("conversation");

  if (!review) {
    return (
      <main className={styles.root}>
        <div />
        <div className={styles.body}>
          <Text className={styles.empty}>Select a review or start a new one.</Text>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.header}>
        <StatusDot status={review.status} />
        <Subtitle1 as="h2" className={styles.title}>
          {review.title}
        </Subtitle1>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, data) => setTab(data.value as ReviewTab)}
        >
          <Tab value="conversation">Conversation</Tab>
          <Tab value="findings">Findings</Tab>
          <Tab value="changes">Changes</Tab>
          <Tab value="comments">PR comments</Tab>
        </TabList>
        <Button icon={<StopRegular />} appearance="subtle">
          Stop
        </Button>
      </div>
      <div className={styles.body}>
        <Text>
          {tab} view arrives in a later phase — see <code>docs/ROADMAP.md</code>.
        </Text>
      </div>
      <div className={styles.composer}>
        <Textarea
          className={styles.input}
          resize="vertical"
          placeholder="Ask Claude about this review, or type / for skills"
        />
        <Button appearance="primary" icon={<SendRegular />} aria-label="Send" />
      </div>
    </main>
  );
}
