import { makeStyles, tokens } from "@fluentui/react-components";
import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import type { PanelLimits } from "./panel.ts";

const STEP = 16;

const useStyles = makeStyles({
  root: {
    width: "6px",
    marginInline: "-3px",
    cursor: "col-resize",
    position: "relative",
    zIndex: 1,
    touchAction: "none",
    alignSelf: "stretch",
    ":hover": { backgroundColor: tokens.colorNeutralStroke1Hover },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      backgroundColor: tokens.colorBrandStroke1,
    },
    ":active": { backgroundColor: tokens.colorBrandStroke1 },
  },
});

interface Props {
  /** What it resizes, e.g. "Resize the file list". */
  label: string;
  width: number;
  limits: PanelLimits;
  onWidth: (width: number) => void;
}

/**
 * The edge to the right of a side panel: drag it, or focus it and use the arrow keys, Home and
 * End. A double click restores the initial width.
 */
export function ResizeHandle({ label, width, limits, onWidth }: Props) {
  const styles = useStyles();
  const drag = useRef<{ x: number; width: number }>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(drag.current.width + event.clientX - drag.current.x);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? width - STEP
        : event.key === "ArrowRight"
          ? width + STEP
          : event.key === "Home"
            ? limits.min
            : event.key === "End"
              ? limits.max
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onWidth(next);
  };

  return (
    // A focusable separator is the ARIA pattern for a splitter (it has a value and is operable).
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot be focused and dragged.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      className={styles.root}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(limits.initial)}
      onKeyDown={onKeyDown}
    />
  );
}
