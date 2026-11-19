import {
  Avatar,
  Button,
  makeStyles,
  mergeClasses,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { KeyboardRegular } from "@fluentui/react-icons";
import { GlobalSearch, type SearchTarget } from "../../features/search/GlobalSearch.tsx";

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
    // This bar is the window's title bar: drag it to move the window.
    WebkitAppRegion: "drag",
  },
  // Room for the macOS traffic lights (positioned by the main process).
  mac: { paddingLeft: "88px" },
  // Room for the Windows/Linux caption buttons drawn over the bar.
  overlay: { paddingRight: "152px" },
  brand: { fontWeight: tokens.fontWeightSemibold },
  interactive: { WebkitAppRegion: "no-drag" },
  search: { width: "100%", minWidth: 0 },
  end: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
});

export function TitleBar({
  onOpen,
  onShortcuts,
}: {
  onOpen: (target: SearchTarget) => void;
  onShortcuts: () => void;
}) {
  const styles = useStyles();
  const platform = window.problem?.platform;

  return (
    <header
      className={mergeClasses(
        styles.root,
        platform === "darwin" && styles.mac,
        platform !== undefined && platform !== "darwin" && styles.overlay,
      )}
    >
      <Text className={styles.brand}>PRoblem</Text>
      <div className={mergeClasses(styles.search, styles.interactive)}>
        <GlobalSearch onOpen={onOpen} />
      </div>
      <div className={styles.end}>
        <Tooltip content="Keyboard shortcuts (?)" relationship="label">
          <Button
            className={styles.interactive}
            appearance="subtle"
            icon={<KeyboardRegular />}
            onClick={onShortcuts}
          />
        </Tooltip>
        <Avatar className={styles.interactive} name="Reviewer" size={28} />
      </div>
    </header>
  );
}
