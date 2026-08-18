import type { ScriptSpan } from "../project/types";

/** Build the script subset a duet narrator should see in a seat pack. */
export function filterSpansForSeat(spans: ScriptSpan[], seat: "N1" | "N2"): ScriptSpan[] {
  return spans
    .filter((span) => span.seat === seat || (seat === "N1" && span.seat === "narration"))
    .map((span) => ({ ...span, style: [...span.style] }));
}
