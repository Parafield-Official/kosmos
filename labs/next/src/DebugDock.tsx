import { useEffect, useRef, useState } from "react";
import { resetAccessState } from "./access";
import { DEBUG_RESET_ACCESS, PLACES, placeLabel, type Place } from "./flow";
import { GlassButton } from "./ui/liquid";

const DEBUG_POS_KEY = "kosmos-debug-dock-v2";

function defaultPos() {
  return {
    x: Math.max(16, window.innerWidth - 148),
    y: Math.max(16, window.innerHeight - 64),
  };
}

function readDebugPos(): { x: number; y: number } {
  try {
    const raw = window.localStorage.getItem(DEBUG_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // Fall through.
  }
  return defaultPos();
}

function clampDock(x: number, y: number, el: HTMLElement) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - el.offsetWidth - pad);
  const maxY = Math.max(pad, window.innerHeight - el.offsetHeight - pad);
  return {
    x: Math.min(maxX, Math.max(pad, x)),
    y: Math.min(maxY, Math.max(pad, y)),
  };
}

export function DebugDock({
  place,
  onJump,
}: {
  place: Place;
  onJump: (next: Place) => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState(readDebugPos);
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ pointer: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  useEffect(() => {
    function onResize() {
      const el = dockRef.current;
      if (!el) {
        return;
      }
      setPos((current) => clampDock(current.x, current.y, el));
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function persist(next: { x: number; y: number }) {
    try {
      window.localStorage.setItem(DEBUG_POS_KEY, JSON.stringify(next));
    } catch {
      // Debug still works without storage.
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: pos.x,
      oy: pos.y,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointer) {
      return;
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 8) {
      return;
    }
    if (!state.moved) {
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const el = dockRef.current;
    if (!el) {
      return;
    }
    setPos(clampDock(state.ox + dx, state.oy + dy, el));
  }

  function onPointerUp() {
    const state = drag.current;
    drag.current = null;
    if (state?.moved) {
      persist(posRef.current);
    }
  }

  return (
    <div
      ref={dockRef}
      className={open ? "debug-dock open" : "debug-dock"}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <p className="debug-dock-handle">debug</p>
      <GlassButton
        type="button"
        className="debug-toggle glass-btn-compact"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "hide" : "show"}
      </GlassButton>
      {open ? (
        <>
        <div className="debug-list" role="group" aria-label="Jump">
          {PLACES.map((item) => (
            <GlassButton
              key={item}
              type="button"
              className={item === place ? "glass-btn-debug-item open" : "glass-btn-debug-item"}
              onClick={() => onJump(item)}
            >
              {placeLabel(item)}
            </GlassButton>
          ))}
        </div>
        <div className="debug-dev" role="group" aria-label="Dev tools">
          <button type="button" className="debug-dev-action" onClick={() => void resetAccessState()}>
            {DEBUG_RESET_ACCESS}
          </button>
        </div>
        </>
      ) : null}
    </div>
  );
}
