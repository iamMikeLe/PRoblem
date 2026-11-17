import { createFocusOutlineStyle, makeStyles, tokens } from "@fluentui/react-components";

/**
 * Rows of the list pane (reviews, projects). Hand-rolled buttons, so they get Fluent's focus
 * outline explicitly, and selection is shown by a brand bar as well as the background, which
 * keeps it visible in high contrast.
 */
export const useListItemStyles = makeStyles({
  item: {
    position: "relative",
    width: "100%",
    minWidth: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "none",
    textAlign: "start",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
    ":active": { backgroundColor: tokens.colorNeutralBackground2Pressed },
    ...createFocusOutlineStyle(),
  },
  selected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Selected },
    "::before": {
      content: '""',
      position: "absolute",
      left: 0,
      top: "20%",
      bottom: "20%",
      width: "3px",
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  ellipsis: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
});
