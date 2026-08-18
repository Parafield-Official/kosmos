import type { Pickup, ScriptSpan } from "../project/types";
import type { DuetSegment } from "./mix";

/** Build the script subset a duet narrator should see in a seat pack. */
export function filterSpansForSeat(spans: ScriptSpan[], seat: "N1" | "N2"): ScriptSpan[] {
  return spans
    .filter((span) => span.seat === seat || (seat === "N1" && span.seat === "narration"))
    .map((span) => ({ ...span, style: [...span.style] }));
}

/** Return a cloned span list with one user-selected span assigned to a seat. */
export function assignSpanSeat(
  spans: ScriptSpan[],
  index: number,
  seat: ScriptSpan["seat"],
): ScriptSpan[] {
  if (!Number.isInteger(index) || index < 0 || index >= spans.length) {
    throw new Error("Span index is outside the chapter");
  }
  return spans.map((span, spanIndex) => spanIndex === index
    ? { ...span, seat, style: [...span.style] }
    : { ...span, style: [...span.style] });
}

/** Attribute timestamped proof pickups to the seat speaking at that time. */
export function assignPickupSeats(pickups: Pickup[], segments: DuetSegment[]): Pickup[] {
  const ordered = [...segments].sort((left, right) => left.start - right.start);
  return pickups.map((pickup) => {
    const containing = ordered.find((segment) => pickup.t_start >= segment.start && pickup.t_start <= segment.end);
    const nearest = containing ?? ordered.reduce<DuetSegment | undefined>((best, segment) => {
      if (!best) {
        return segment;
      }
      return Math.abs(segment.start - pickup.t_start) < Math.abs(best.start - pickup.t_start) ? segment : best;
    }, undefined);
    return nearest ? { ...pickup, seat: nearest.seat } : pickup;
  });
}
