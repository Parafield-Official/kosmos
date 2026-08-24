import { describe, expect, it } from "vitest";
import { manuscriptBlocks } from "../core/manuscript/paper";
import { manuscriptBlockTokenOffsets, selectionActionPosition } from "./paper-prose";

describe("manuscript proof token offsets", () => {
  it("assigns deterministic offsets before React renders separate blocks", () => {
    const blocks = manuscriptBlocks("# Leaflets\n\nThe moon is gibbous.\n\n# Bombers\n\nThey cross at midnight.");

    expect(manuscriptBlockTokenOffsets(blocks)).toEqual([0, 1, 5, 6]);
  });

  it("places the microphone beside the selection and keeps it inside the viewport", () => {
    expect(selectionActionPosition(
      { left: 300, top: 220, right: 480, bottom: 244 },
      { width: 1200, height: 760 },
    )).toEqual({ left: 300, top: 254, placement: "below" });

    expect(selectionActionPosition(
      { left: 1100, top: 700, right: 1180, bottom: 730 },
      { width: 1200, height: 760 },
    )).toEqual({ left: 996, top: 644, placement: "above" });
  });
});
