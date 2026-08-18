import { describe, expect, it } from "vitest";
import { assignPickupSeats, assignSpanSeat, filterSpansForSeat } from "./seats";

describe("duet seat script filtering", () => {
  const spans = [
    { text: "Narration", seat: "narration" as const, style: [] },
    { text: " her line", seat: "N1" as const, style: ["italic" as const] },
    { text: " his line", seat: "N2" as const, style: ["bold" as const] },
  ];

  it("keeps narration with the configured primary seat and preserves styles", () => {
    expect(filterSpansForSeat(spans, "N1")).toEqual([
      { text: "Narration", seat: "narration", style: [] },
      { text: " her line", seat: "N1", style: ["italic"] },
    ]);
    expect(filterSpansForSeat(spans, "N2")).toEqual([
      { text: " his line", seat: "N2", style: ["bold"] },
    ]);
  });

  it("assigns one span without mutating the source styles", () => {
    const next = assignSpanSeat(spans, 2, "N1");
    expect(next[2]).toMatchObject({ text: " his line", seat: "N1" });
    expect(spans[2].seat).toBe("N2");
    expect(next[2].style).not.toBe(spans[2].style);
  });

  it("attributes pickups to the speaking seat by timestamp", () => {
    const pickup = {
      id: "p1",
      chapter_id: "ch01",
      t_start: 2.1,
      t_end: 2.3,
      expected: "line",
      heard: "",
      kind: "skip" as const,
      seat: "narration" as const,
      status: "open" as const,
      confidence: 0.8,
    };
    expect(assignPickupSeats([pickup], [
      { start: 0, end: 2, seat: "N1" },
      { start: 2, end: 4, seat: "N2" },
    ])[0].seat).toBe("N2");
  });
});
