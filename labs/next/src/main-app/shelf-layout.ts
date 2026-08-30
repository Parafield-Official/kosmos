import type { BayPlan, RibbonSpec } from "./shelf-geometry";
import { capRadii } from "./shelf-geometry";
import { hashString } from "./shelf-art";
import type { ShelfColumns } from "./shelf-prefs";

/**
 * The wall's dimensions. One world unit is 10 cm, so a book is roughly four
 * units tall and the recess three units deep.
 *
 * Every vertical number below is transcribed from the golden reference
 * (`design-research/golden-reference-shelf-wall.png`) by probing luminance down
 * columns that fall between books, then scaled by VIEW_HEIGHT. Frame-height
 * proportions carry across to the app's much wider box unchanged; frame-width
 * ones do not, so the horizontal figures are re-derived rather than copied.
 */
export const UNIT_CM = 10;

/** World height of the visible frame; y runs up with 0 at the frame centre. */
export const VIEW_HEIGHT = 29;

/**
 * Cross-section of the plaster. Everything is measured in the plane of the wall
 * except `PROUD` and `RECESS_DEPTH`, which travel in z.
 *
 * The photograph shows one continuous rolled bead around each opening, not a
 * flat lip with a rim: from the base wall the plaster swells forward over a
 * long gentle roll, crests, and turns straight back down into the recess. An
 * earlier build gave the lip a flat plateau, which put a dark band between the
 * cove line and the crest and made every row read as a glowing tube laid on
 * the wall. `LIP_WIDTH` is therefore only the hair of flat at the crest.
 *
 * `MERGE_RADIUS` is how softly two neighbouring beads run together, and so how
 * sharply the crease between them reads.
 */
export const LIP_WIDTH = 0.25;
export const OUTER_ROLL = 2.9;
export const PROUD = 1.05;
export const INNER_FILLET = 0.85;
export const RECESS_DEPTH = 2.9;
export const MERGE_RADIUS = 0.18;

/** Where each ribbon's opening starts and ends, as a fraction of frame width. */
export interface RibbonPlacement {
  left: number;
  right: number;
}

/**
 * The three ribbons, as world y.
 *
 * Row 1's ceiling arcs *up* through the middle (15.5% of frame height at the
 * caps, 12.9% at x≈0.55) while rows 2 and 3 sag. That opposition is the whole
 * trick: it leaves the plaster between two rows as a lens, thick in the middle
 * and pinched at the ends, and the crease where two lozenges merge follows it.
 */
export const RIBBONS: ReadonlyArray<RibbonSpec> = [
  {
    // Ceiling 15.5% h at the caps rising to 12.9%; floor 31.8% → 31.3%.
    x0: 0,
    x1: 0,
    top: { start: 10.14, end: 9.99, bow: 0.7, skew: 0.55 },
    bottom: { start: 5.33, end: 5.22, bow: 0.15, skew: 0.46 },
  },
  {
    // Ceiling 42.4% h at the caps sagging to 45.6%; floor 62.3% → 63.7%.
    x0: 0,
    x1: 0,
    top: { start: 2.26, end: 2.15, bow: -0.92, skew: 0.5 },
    bottom: { start: -3.5, end: -3.63, bow: -0.41, skew: 0.58 },
  },
  {
    // Ceiling 69.5% h at the caps sagging to 72.8%; floor 87.5% → 88.6%.
    x0: 0,
    x1: 0,
    top: { start: -5.58, end: -5.73, bow: -0.95, skew: 0.48 },
    bottom: { start: -10.81, end: -10.94, bow: -0.32, skew: 0.42 },
  },
];

/**
 * Where each ribbon's opening reaches, as a fraction of frame width. The left
 * ends are staggered and the right ends step outwards down the wall, exactly as
 * the reference has them — nothing on this wall lines up with anything else.
 */
export const PLACEMENTS: ReadonlyArray<RibbonPlacement> = [
  { left: 0.101, right: 0.874 },
  { left: 0.122, right: 0.894 },
  { left: 0.11, right: 0.921 },
];

/**
 * Fit the ribbons to the frame. Placements are given for the *opening*, so the
 * cap centres step in by the cap radius and the lozenge's outer edge — a lip
 * and a roll further out again — still closes with plaster to spare at both
 * ends.
 */
export function fitRibbons(aspect: number): RibbonSpec[] {
  const width = VIEW_HEIGHT * aspect;
  const halfWidth = width / 2;
  return RIBBONS.map((ribbon, index) => {
    const place = PLACEMENTS[index] ?? PLACEMENTS[0];
    const caps = capRadii(ribbon);
    return {
      ...ribbon,
      x0: -halfWidth + place.left * width + caps.left,
      x1: -halfWidth + place.right * width - caps.right,
    };
  });
}

/** Outer plaster slab, generous enough that its own edges never enter frame. */
export function wallExtent(aspect: number): { halfWidth: number; halfHeight: number } {
  return { halfWidth: (VIEW_HEIGHT * aspect) / 2 + 4, halfHeight: VIEW_HEIGHT / 2 + 3 };
}

/** Books that fit on the wall at a given column count. */
export function shelfCapacity(columns: ShelfColumns): number {
  return columns * RIBBONS.length;
}

/**
 * How a row of books is proportioned.
 *
 * `height` is the book's height as a fraction of the opening it stands in;
 * `aspect` its width over its height; `gap` the space beside it as a multiple
 * of the row's mean book width. Ranges, not values — the reference has five
 * different trim sizes side by side in every row, and a row of identical boxes
 * is the fastest way to make this look like a render.
 *
 * Three columns is not five columns with the gaps stretched. The books grow and
 * the gap ratio barely moves; the ribbon carries the surplus as longer empty
 * runs near its caps, which is what the reference does at its own ends.
 */
interface ColumnPlan {
  height: [number, number];
  aspect: [number, number];
  gap: [number, number];
  /** How far the run starts from the end of the opening. */
  inset: number;
  /** Share of the leftover ribbon that sits to the left of the books. */
  leftShare: number;
}

const COLUMN_PLANS: Record<ShelfColumns, ColumnPlan> = {
  5: { height: [0.73, 0.8], aspect: [0.68, 0.96], gap: [0.9, 1.16], inset: 2.1, leftShare: 0.43 },
  3: { height: [0.84, 0.94], aspect: [0.86, 1.08], gap: [0.94, 1.2], inset: 2.1, leftShare: 0.5 },
};

function spread(unit: number, range: [number, number]): number {
  return range[0] + (range[1] - range[0]) * unit;
}

/**
 * A book's proportions, derived from its id so a given book is always the same
 * size — reload, resize, and column changes must not reshuffle the wall.
 */
export function bayPlan(id: string, columns: ShelfColumns): BayPlan {
  const plan = COLUMN_PLANS[columns];
  const hash = hashString(id);
  const a = ((hash >>> 3) % 1000) / 999;
  const b = ((hash >>> 13) % 1000) / 999;
  const c = ((hash >>> 23) % 1000) / 999;
  return {
    heightFactor: spread(a, plan.height),
    aspect: spread(b, plan.aspect),
    gap: spread(c, plan.gap),
  };
}

/** Book thickness. Quiet variation, never enough to read as a staircase. */
export function bayDepth(id: string, width: number): number {
  const unit = ((hashString(`${id}:depth`) >>> 7) % 1000) / 999;
  return width * (0.09 + 0.045 * unit);
}

export function bayOptions(columns: ShelfColumns, row: number) {
  const plan = COLUMN_PLANS[columns];
  // A nudge per row so the three runs never start at the same place. At five
  // columns the run nearly fills the ribbon and the nudge barely shows; at
  // three it is the only thing keeping the rows from stacking up in a column.
  const nudge = (columns === 3 ? [0.012, -0.016, 0.004] : [0, 0.035, -0.03])[row % 3] ?? 0;
  return {
    inset: plan.inset,
    leftShare: plan.leftShare + nudge,
    // The base sits in the trough of the floor fillet rather than on the lip.
    sit: INNER_FILLET * 0.52,
  };
}
