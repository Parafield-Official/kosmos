import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "./flow";

const KNOB = 42;
const PAD = 4;
const COMMIT = 0.82;

function project(velocity: number, deceleration = 0.998) {
  return (velocity / 1000) * (deceleration / (1 - deceleration));
}

export function StartSlider({ onComplete }: { onComplete: () => void }) {
  const reduced = prefersReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [offset, setOffset] = useState(0);
  const [max, setMax] = useState(220);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const live = useRef({
    offset: 0,
    origin: 0,
    startX: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    pointer: -1,
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const measure = () => {
      setMax(Math.max(1, track.clientWidth - KNOB - PAD * 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  function finish() {
    if (done) {
      return;
    }
    setDone(true);
    live.current.offset = max;
    setOffset(max);
    window.setTimeout(() => completeRef.current(), 180);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (done || reduced || event.button !== 0) {
      return;
    }
    const track = trackRef.current;
    if (!track) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    live.current = {
      offset: live.current.offset,
      origin: live.current.offset,
      startX: event.clientX,
      lastX: event.clientX,
      lastT: now,
      velocity: 0,
      pointer: event.pointerId,
    };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (done || event.pointerId !== live.current.pointer) {
      return;
    }
    const now = performance.now();
    const dt = Math.max(1, now - live.current.lastT);
    const next = Math.min(max, Math.max(0, live.current.origin + event.clientX - live.current.startX));
    live.current.velocity = ((event.clientX - live.current.lastX) / dt) * 1000;
    live.current.lastX = event.clientX;
    live.current.lastT = now;
    live.current.offset = next;
    setOffset(next);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== live.current.pointer) {
      return;
    }
    live.current.pointer = -1;
    setDragging(false);
    if (done) {
      return;
    }
    const projected = live.current.offset + project(live.current.velocity);
    if (live.current.offset / max >= COMMIT || projected >= max * 0.72) {
      finish();
      return;
    }
    live.current.offset = 0;
    setOffset(0);
  }

  const progress = Math.min(1, offset / Math.max(1, max));
  const fill = `${KNOB + offset}px`;
  const fillEdge = `${PAD + KNOB + offset}px`;
  const darkMask = `linear-gradient(to right, #000 ${fillEdge}, transparent ${fillEdge})`;
  const lightMask = `linear-gradient(to right, transparent ${fillEdge}, #000 ${fillEdge})`;

  if (reduced) {
    return (
      <button type="button" className="start-slide reduced" onClick={() => completeRef.current()}>
        <span className="start-knob" aria-hidden="true">
          <span className="start-knob-face">
            <Chevron />
          </span>
        </span>
        <span className="start-label">Get started</span>
      </button>
    );
  }

  return (
    <div
      ref={trackRef}
      className={dragging ? "start-slide dragging" : done ? "start-slide done" : "start-slide"}
      role="slider"
      aria-label="Get started"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      style={{ "--start-fill": fill } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="start-fill" aria-hidden="true" />
      <span className="start-label start-label-light" style={{ WebkitMaskImage: lightMask, maskImage: lightMask }}>
        Get started
      </span>
      <span className="start-label start-label-dark" aria-hidden="true" style={{ WebkitMaskImage: darkMask, maskImage: darkMask }}>
        Get started
      </span>
      <span className="start-knob" style={{ transform: `translateX(${offset}px)` }}>
        <span className="start-knob-face">
          <Chevron />
        </span>
      </span>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.2 2.8 11 8l-4.8 5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
