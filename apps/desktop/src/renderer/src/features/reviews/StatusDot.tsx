import { Badge, type BadgeProps } from "@fluentui/react-components";
import type { Review, ReviewStatus } from "@problem/shared";
import { useReviewStatus } from "../conversation/store.ts";

const statusAppearance: Record<
  ReviewStatus,
  { color: NonNullable<BadgeProps["color"]>; label: string }
> = {
  queued: { color: "subtle", label: "Queued" },
  running: { color: "warning", label: "Claude is working" },
  "needs-input": { color: "brand", label: "Needs your input" },
  idle: { color: "success", label: "Idle" },
  failed: { color: "danger", label: "Failed" },
};

/** The review's live status (from events), shown as a colored dot. */
export function StatusDot({ review }: { review: Pick<Review, "id" | "status"> }) {
  const status = useReviewStatus(review);
  const { color, label } = statusAppearance[status];
  return (
    <Badge size="extra-small" shape="circular" color={color} aria-label={label} title={label} />
  );
}
