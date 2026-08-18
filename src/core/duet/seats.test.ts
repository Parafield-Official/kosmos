import { describe, expect, it } from "vitest";
import { filterSpansForSeat } from "./seats";

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
});
