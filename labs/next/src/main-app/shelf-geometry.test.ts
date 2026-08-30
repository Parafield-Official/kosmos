import { describe, expect, it } from "vitest";
import {
  bandThicknessAt,
  capRadii,
  ceilingYAt,
  edgeYAt,
  floorYAt,
  layoutBays,
  openingExtent,
  openingHeightAt,
} from "./shelf-geometry";
import { VIEW_HEIGHT, bayPlan, bayOptions, fitRibbons, LIP_WIDTH, OUTER_ROLL } from "./shelf-layout";

/** Fraction of frame height, measured from the top, for a world y. */
const asHeight = (y: number) => 0.5 - y / VIEW_HEIGHT;

const APP_ASPECT = 1120 / 613;
const ribbons = fitRibbons(APP_ASPECT);
const halfWidth = (VIEW_HEIGHT * APP_ASPECT) / 2;
const asWidth = (x: number) => (x + halfWidth) / (halfWidth * 2);

describe("ribbon layout against the golden reference", () => {
  it("puts the three openings where the photograph has them", () => {
    // Measured off golden-reference-shelf-wall.png by probing luminance down
    // columns that fall between books. Ceilings at the caps, floors likewise.
    const expected = [
      { ceiling: 0.153, floor: 0.318 },
      { ceiling: 0.424, floor: 0.623 },
      { ceiling: 0.695, floor: 0.875 },
    ];
    ribbons.forEach((ribbon, index) => {
      expect(asHeight(edgeYAt(ribbon.top, 0))).toBeCloseTo(expected[index].ceiling, 2);
      expect(asHeight(edgeYAt(ribbon.bottom, 0))).toBeCloseTo(expected[index].floor, 2);
    });
  });

  it("bows row 1 up through the middle and rows 2 and 3 down", () => {
    expect(ceilingYAt(ribbons[0], 0.5)).toBeGreaterThan(ceilingYAt(ribbons[0], 0));
    expect(ceilingYAt(ribbons[1], 0.5)).toBeLessThan(ceilingYAt(ribbons[1], 0));
    expect(ceilingYAt(ribbons[2], 0.5)).toBeLessThan(ceilingYAt(ribbons[2], 0));
  });

  it("keeps every bow shallow — a swell, not a wave", () => {
    for (const ribbon of ribbons) {
      for (const edge of [ribbon.top, ribbon.bottom]) {
        const straight = (edge.start + edge.end) / 2;
        const peak = Math.abs(edgeYAt(edge, edge.skew) - straight);
        expect(peak / openingHeightAt(ribbon, 0.5)).toBeLessThan(0.26);
      }
    }
  });

  it("leaves the plaster between rows as a lens, fat in the middle", () => {
    for (const [upper, lower] of [
      [ribbons[0], ribbons[1]],
      [ribbons[1], ribbons[2]],
    ]) {
      const ends = bandThicknessAt(upper, lower, 0);
      const middle = bandThicknessAt(upper, lower, 0.5);
      expect(middle).toBeGreaterThan(ends);
      expect(ends / middle).toBeGreaterThan(0.6);
      expect(ends / middle).toBeLessThan(0.85);
    }
  });

  it("closes every cap inside the frame, with the lozenge's roll to spare", () => {
    for (const ribbon of ribbons) {
      const extent = openingExtent(ribbon);
      const bead = LIP_WIDTH + OUTER_ROLL;
      expect(asWidth(extent.left - bead)).toBeGreaterThan(0.01);
      expect(asWidth(extent.right + bead)).toBeLessThan(0.99);
    }
  });

  it("staggers the left ends and steps the right ends outward", () => {
    const lefts = ribbons.map((ribbon) => openingExtent(ribbon).left);
    const rights = ribbons.map((ribbon) => openingExtent(ribbon).right);
    expect(new Set(lefts.map((value) => value.toFixed(2))).size).toBe(3);
    expect(rights[0]).toBeLessThan(rights[1]);
    expect(rights[1]).toBeLessThan(rights[2]);
  });
});

describe("book bays", () => {
  const ids = ["alpha", "bravo", "charlie", "delta", "echo"];

  it("stands five books at 70–80% of the opening, no two the same size", () => {
    const ribbon = ribbons[1];
    const slots = layoutBays(
      ribbon,
      ids.map((id) => bayPlan(id, 5)),
      bayOptions(5, 1),
    );
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      const opening = openingHeightAt(ribbon, (slot.x - ribbon.x0) / (ribbon.x1 - ribbon.x0));
      expect(slot.height / opening).toBeGreaterThan(0.7);
      expect(slot.height / opening).toBeLessThan(0.82);
      expect(slot.baseY).toBeGreaterThan(floorYAt(ribbon, 0.5) - 1);
    }
    const widths = slots.map((slot) => slot.width.toFixed(3));
    expect(new Set(widths).size).toBe(5);
  });

  it("holds the book-to-gap ratio near 1:1 rather than spreading the row", () => {
    const slots = layoutBays(
      ribbons[0],
      ids.map((id) => bayPlan(id, 5)),
      bayOptions(5, 0),
    );
    const widths = slots.map((slot) => slot.width);
    const gaps = slots
      .slice(1)
      .map((slot, index) => slot.x - slot.width / 2 - (slots[index].x + widths[index] / 2));
    const meanWidth = widths.reduce((sum, value) => sum + value, 0) / widths.length;
    const meanGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    expect(meanGap / meanWidth).toBeGreaterThan(0.85);
    expect(meanGap / meanWidth).toBeLessThan(1.4);
  });

  it("grows the books at three columns instead of stretching the gaps", () => {
    const three = layoutBays(
      ribbons[1],
      ids.slice(0, 3).map((id) => bayPlan(id, 3)),
      bayOptions(3, 1),
    );
    const five = layoutBays(
      ribbons[1],
      ids.map((id) => bayPlan(id, 5)),
      bayOptions(5, 1),
    );
    const mean = (slots: Array<{ width: number }>) =>
      slots.reduce((sum, slot) => sum + slot.width, 0) / slots.length;
    expect(mean(three)).toBeGreaterThan(mean(five) * 1.08);

    const gapOf = (slots: Array<{ x: number; width: number }>) =>
      slots[1].x - slots[1].width / 2 - (slots[0].x + slots[0].width / 2);
    // The gap may grow a little with the books, but nothing like in proportion
    // to the ribbon's spare length.
    expect(gapOf(three) / gapOf(five)).toBeLessThan(1.5);
  });

  it("keeps a book's size stable across rebuilds", () => {
    expect(bayPlan("alpha", 5)).toEqual(bayPlan("alpha", 5));
    expect(capRadii(ribbons[0]).left).toBeGreaterThan(0);
  });
});
