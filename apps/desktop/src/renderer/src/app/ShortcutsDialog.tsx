import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { MOD_LABEL } from "../lib/shortcuts.ts";

const SHORTCUTS: readonly { keys: readonly string[]; what: string }[] = [
  { keys: [`${MOD_LABEL}K`], what: "Search reviews, findings and files" },
  { keys: ["Alt+↓", "Alt+↑"], what: "Next or previous review" },
  { keys: ["1", "2", "3", "4"], what: "Conversation, Findings, Changes, PR comments" },
  { keys: ["J", "K"], what: "Next or previous finding (Findings tab)" },
  { keys: ["R"], what: "Reply: focus the message box" },
  { keys: [`${MOD_LABEL}B`], what: "Show or hide the reviews list" },
  { keys: ["?"], what: "This list" },
];

const useStyles = makeStyles({
  list: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: tokens.spacingHorizontalXL,
    rowGap: tokens.spacingVerticalS,
    alignItems: "center",
    margin: 0,
  },
  keys: { display: "flex", gap: tokens.spacingHorizontalXS, margin: 0 },
  key: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  // Keeps each <dt>/<dd> pair in one wrapper while they sit in the grid.
  pair: { display: "contents" },
  what: { margin: 0 },
});

/** The keyboard shortcuts, opened with "?" or from the title bar. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const styles = useStyles();
  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogContent>
            <dl className={styles.list}>
              {SHORTCUTS.map(({ keys, what }) => (
                <div key={what} className={styles.pair}>
                  <dt className={styles.keys}>
                    {keys.map((key) => (
                      <kbd key={key} className={styles.key}>
                        {key}
                      </kbd>
                    ))}
                  </dt>
                  <dd className={styles.what}>{what}</dd>
                </div>
              ))}
            </dl>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
