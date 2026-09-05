import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) {
    return list;
  }
  next.splice(to, 0, item);
  return next;
}

function rubberband(value: number, min: number, max: number): number {
  if (value < min) {
    const extra = min - value;
    return min - (extra * 48) / (48 + extra);
  }
  if (value > max) {
    const extra = value - max;
    return max + (extra * 48) / (48 + extra);
  }
  return value;
}

export function useReorder<T>(items: T[], onReorder?: (next: T[]) => void) {
  const [drag, setDrag] = useState<{
    from: number;
    over: number;
    y: number;
    height: number;
    originY: number;
    armed: boolean;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const showGrip = Boolean(onReorder);
  const canDrag = showGrip && items.length > 1;

  function shiftFor(index: number): number {
    if (!drag?.armed) {
      return 0;
    }
    if (index === drag.from) {
      return drag.y;
    }
    if (drag.from < drag.over && index > drag.from && index <= drag.over) {
      return -drag.height;
    }
    if (drag.from > drag.over && index < drag.from && index >= drag.over) {
      return drag.height;
    }
    return 0;
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (!canDrag || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const row = event.currentTarget.closest("li");
    const list = row?.parentElement;
    const gap = list ? Number.parseFloat(getComputedStyle(list).rowGap || "0") : 0;
    const height = (row?.getBoundingClientRect().height ?? 44) + (Number.isFinite(gap) ? gap : 0);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: index, over: index, y: 0, height, originY: event.clientY, armed: false });
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) {
      return;
    }
    const raw = event.clientY - current.originY;
    if (!current.armed && Math.abs(raw) < 10) {
      return;
    }
    const max = (items.length - 1 - current.from) * current.height;
    const min = -current.from * current.height;
    const y = rubberband(raw, min, max);
    const over = Math.max(0, Math.min(items.length - 1, current.from + Math.round(y / current.height)));
    setDrag({ ...current, armed: true, y, over });
  }

  function endDrag() {
    const current = dragRef.current;
    if (current?.armed && onReorder && current.over !== current.from) {
      onReorder(arrayMove(items, current.from, current.over));
    }
    dragRef.current = null;
    setDrag(null);
  }

  return { drag, shiftFor, startDrag, moveDrag, endDrag, showGrip, canDrag };
}

export function ReorderGrip({
  label,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  label: string;
  disabled?: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
}) {
  return (
    <button
      type="button"
      className="sound-master-grip"
      aria-label={label}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <svg viewBox="0 0 12 16" width="10" height="14" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="3" r="1.15" />
        <circle cx="8" cy="3" r="1.15" />
        <circle cx="4" cy="8" r="1.15" />
        <circle cx="8" cy="8" r="1.15" />
        <circle cx="4" cy="13" r="1.15" />
        <circle cx="8" cy="13" r="1.15" />
      </svg>
    </button>
  );
}
