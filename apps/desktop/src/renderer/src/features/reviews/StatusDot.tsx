import { Badge, type BadgeProps } from "@fluentui/react-components";
import type { ReviewStatus } from "@reviewroom/shared";

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

export function StatusDot({ status }: { status: ReviewStatus }) {
  const { color, label } = statusAppearance[status];
  return (
    <Badge size="extra-small" shape="circular" color={color} aria-label={label} title={label} />
  );
}
