import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./flow";

const KNOB = 42;
const PAD = 4;
const COMPLETE_MS = 1350;
const COMPLETE_MS_REDUCED = 480;

export function StartSlider({ onComplete }: { onComplete: () => void }) {
  const reduced = prefersReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [offset, setOffset] = useState(0);
  const [max, setMax] = useState(220);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const maxRef = useRef(220);
  const doneRef = useRef(false);
  const live = useRef({
    offset: 0,
    origin: 0,
    startX: 0,
    pointer: -1,
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const measure = () => {
      const next = Math.max(1, track.clientWidth - KNOB - PAD * 2);
      maxRef.current = next;
      setMax(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  function finish() {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    const end = maxRef.current;
    setDone(true);
    live.current.offset = end;
    live.current.pointer = -1;
    setOffset(end);
    setDragging(false);
    window.setTimeout(() => completeRef.current(), reduced ? COMPLETE_MS_REDUCED : COMPLETE_MS);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (doneRef.current || reduced || event.button !== 0) {
      return;
    }
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const nextMax = Math.max(1, track.clientWidth - KNOB - PAD * 2);
    maxRef.current = nextMax;
    setMax(nextMax);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; the track still receives moves while the pointer is down.
    }
    live.current = {
      offset: live.current.offset,
      origin: live.current.offset,
      startX: event.clientX,
      pointer: event.pointerId,
    };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (doneRef.current || event.pointerId !== live.current.pointer) {
      return;
    }
    const span = maxRef.current;
    const next = Math.min(span, Math.max(0, live.current.origin + event.clientX - live.current.startX));
    live.current.offset = next;
    setOffset(next);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== live.current.pointer) {
      return;
    }
    live.current.pointer = -1;
    setDragging(false);
    if (doneRef.current) {
      return;
    }
    const span = maxRef.current;
    if (live.current.offset >= span) {
      finish();
      return;
    }
    live.current.offset = 0;
    setOffset(0);
  }

  const progress = Math.min(1, offset / Math.max(1, max));
  const percent = Math.round(progress * 100);
  const fillWidth = KNOB + offset;

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
      aria-valuenow={percent}
      aria-valuetext={`${percent} percent`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerUp}
      onPointerUp={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <span className="start-label">Get started</span>
      <span
        className="start-fill"
        style={done ? undefined : { width: fillWidth }}
        aria-hidden="true"
      />
      {percent > 0 || done ? (
        <span className="start-percent" aria-hidden="true">
          {percent}%
        </span>
      ) : null}
      <span className="start-knob" style={{ transform: `translateX(${offset}px)` }} aria-hidden="true">
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
