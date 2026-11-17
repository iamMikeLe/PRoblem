import { makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import {
  AlertFilled,
  AlertRegular,
  bundleIcon,
  ChatMultipleFilled,
  ChatMultipleRegular,
  type FluentIcon,
  FolderFilled,
  FolderRegular,
  SettingsFilled,
  SettingsRegular,
} from "@fluentui/react-icons";

export type RailSection = "reviews" | "projects" | "activity" | "settings";

const ReviewsIcon = bundleIcon(ChatMultipleFilled, ChatMultipleRegular);
const ProjectsIcon = bundleIcon(FolderFilled, FolderRegular);
const ActivityIcon = bundleIcon(AlertFilled, AlertRegular);
const SettingsIcon = bundleIcon(SettingsFilled, SettingsRegular);

const items: { id: RailSection; label: string; icon: FluentIcon }[] = [
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "reviews", label: "Reviews", icon: ReviewsIcon },
  { id: "projects", label: "Projects", icon: ProjectsIcon },
];

const useStyles = makeStyles({
  root: {
    gridArea: "rail",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    paddingBlock: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  spacer: { flexGrow: 1 },
  item: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalS,
    border: "none",
    background: "none",
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  selected: {
    color: tokens.colorBrandForeground1,
    ":hover": { color: tokens.colorBrandForeground1 },
    "::before": {
      content: '""',
      position: "absolute",
      left: 0,
      top: "20%",
      bottom: "20%",
      width: "3px",
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorBrandForeground1,
    },
  },
  icon: { fontSize: "24px" },
  label: { fontSize: tokens.fontSizeBase100 },
});

interface Props {
  selected: RailSection;
  onSelect: (section: RailSection) => void;
}

export function AppRail({ selected, onSelect }: Props) {
  const styles = useStyles();

  const renderItem = ({ id, label, icon: Icon }: (typeof items)[number]) => (
    <button
      key={id}
      type="button"
      aria-current={selected === id ? "page" : undefined}
      className={mergeClasses(styles.item, selected === id && styles.selected)}
      onClick={() => onSelect(id)}
    >
      <Icon className={styles.icon} filled={selected === id} />
      <Text className={styles.label}>{label}</Text>
    </button>
  );

  return (
    <nav className={styles.root} aria-label="Main">
      {items.map(renderItem)}
      <div className={styles.spacer} />
      {renderItem({ id: "settings", label: "Settings", icon: SettingsIcon })}
    </nav>
  );
}
