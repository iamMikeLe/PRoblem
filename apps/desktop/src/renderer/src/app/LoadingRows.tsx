import { makeStyles, Skeleton, SkeletonItem, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
  },
  lines: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  short: { width: "60%" },
});

/** Placeholder rows shaped like the list that is loading (announced by `label`). */
export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  const styles = useStyles();
  return (
    <Skeleton aria-label={label} className={styles.root}>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders that never reorder
        <div key={index} className={styles.row}>
          <SkeletonItem shape="circle" size={24} />
          <div className={styles.lines}>
            <SkeletonItem size={12} />
            <SkeletonItem size={12} className={styles.short} />
          </div>
        </div>
      ))}
    </Skeleton>
  );
}
