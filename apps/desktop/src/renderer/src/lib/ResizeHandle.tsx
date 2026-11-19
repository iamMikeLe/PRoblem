import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import type { PanelLimits } from "./panel.ts";

const STEP = 16;

const useStyles = makeStyles({
  root: {
    position: "relative",
    zIndex: 1,
    touchAction: "none",
    ":hover": { backgroundColor: tokens.colorNeutralStroke1Hover },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      backgroundColor: tokens.colorBrandStroke1,
    },
    ":active": { backgroundColor: tokens.colorBrandStroke1 },
  },
  vertical: {
    width: "6px",
    marginInline: "-3px",
    cursor: "col-resize",
    alignSelf: "stretch",
  },
  horizontal: {
    height: "6px",
    marginBlock: "-3px",
    cursor: "row-resize",
    flexShrink: 0,
  },
});

interface Props {
  /** What it resizes, e.g. "Resize the file list". */
  label: string;
  /** The panel's width, or its height for a horizontal handle. */
  width: number;
  limits: PanelLimits;
  onWidth: (width: number) => void;
  /**
   * "vertical" (default): the right edge of a side panel. "horizontal": the top edge of a panel
   * at the bottom, which grows when dragged up (and with the up arrow).
   */
  orientation?: "vertical" | "horizontal";
}

/**
 * The edge of a resizable panel: drag it, or focus it and use the arrow keys, Home and End.
 * A double click restores the initial size.
 */
export function ResizeHandle({ label, width, limits, onWidth, orientation = "vertical" }: Props) {
  const styles = useStyles();
  const drag = useRef<{ at: number; width: number }>(undefined);
  const horizontal = orientation === "horizontal";
  // Along the axis, in the direction that grows the panel.
  const position = (event: PointerEvent<HTMLDivElement>) =>
    horizontal ? -event.clientY : event.clientX;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { at: position(event), width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(drag.current.width + position(event) - drag.current.at);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const [shrink, grow] = horizontal ? ["ArrowDown", "ArrowUp"] : ["ArrowLeft", "ArrowRight"];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === shrink
        ? width - STEP
        : event.key === grow
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
      // The separator's own orientation: a horizontal line between a list and a panel below.
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      className={mergeClasses(styles.root, horizontal ? styles.horizontal : styles.vertical)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(limits.initial)}
      onKeyDown={onKeyDown}
    />
  );
}
