import { Avatar, Badge, makeStyles, SearchBox, Text, tokens } from "@fluentui/react-components";
import { useServerHealth } from "../../lib/useServerHealth.ts";

const useStyles = makeStyles({
  root: {
    gridArea: "title",
    display: "grid",
    gridTemplateColumns: "1fr minmax(240px, 560px) 1fr",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  brand: { fontWeight: tokens.fontWeightSemibold },
  search: { width: "100%" },
  end: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
});

export function TitleBar() {
  const styles = useStyles();
  const health = useServerHealth();
  const online = health.isSuccess;

  return (
    <header className={styles.root}>
      <Text className={styles.brand}>ReviewRoom</Text>
      <SearchBox
        className={styles.search}
        placeholder="Search reviews, findings, files"
        size="small"
      />
      <div className={styles.end}>
        <Badge appearance="tint" color={online ? "success" : "danger"}>
          {online ? `Server ${health.data.version}` : "Server offline"}
        </Badge>
        <Avatar name="Reviewer" size={28} />
      </div>
    </header>
  );
}
