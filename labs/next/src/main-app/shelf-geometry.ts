/**
 * Outline maths for the plaster wall.
 *
 * Each shelf is a pill-shaped lozenge standing proud of the wall with a second,
 * smaller pill recessed into its face. The recessed pill — the opening — is a
 * stadium blob: a top and a bottom edge, each a gentle freeform curve with a
 * horizontal tangent at either end, closed by a semicircular cap that therefore
 * meets both edges without a crease.
 *
 * An edge is written as a straight run between its two cap heights plus a
 * single off-centre swell. That is enough to reproduce the reference: row 1's
 * ceiling arcs up through the middle while rows 2 and 3 sag, and it is that
 * opposition — not a dramatic wave — that turns the plaster between two rows
 * into a lens, thick in the middle and pinched at the ends.
 *
 * Everything here is plain numbers so the shape can be reasoned about, tested,
 * and handed to a shader without a renderer being involved.
 */

/** One edge of an opening. */
export interface RibbonEdge {
  /** World y where the edge meets the left cap. */
  start: number;
  /** World y where it meets the right cap. */
  end: number;
  /** Peak displacement from the straight run. Positive lifts the middle. */
  bow: number;
  /** Where along the span the swell peaks, 0 at the left cap, 1 at the right. */
  skew: number;
}

export interface RibbonSpec {
  /** Left cap centre in world x. */
  x0: number;
  /** Right cap centre. */
  x1: number;
  top: RibbonEdge;
  bottom: RibbonEdge;
}

export function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * The swell. Zero value and zero slope at both ends, one peak at `skew`, so an
 * edge carrying it still leaves and arrives horizontally and the caps stay
 * tangent.
 */
export function bowShape(u: number, skew: number): number {
  const k = Math.min(0.88, Math.max(0.12, skew));
  const v = u < k ? 0.5 * smoothstep01(u / k) : 0.5 + 0.5 * smoothstep01((u - k) / (1 - k));
  return Math.sin(Math.PI * v);
}

/** Height of one edge at a normalised position along the ribbon. */
export function edgeYAt(edge: RibbonEdge, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return edge.start + (edge.end - edge.start) * smoothstep01(t) + edge.bow * bowShape(t, edge.skew);
}

/** Normalised position along the ribbon for a world x, clamped at the caps. */
export function uAt(spec: RibbonSpec, x: number): number {
  return Math.min(1, Math.max(0, (x - spec.x0) / (spec.x1 - spec.x0)));
}

/** Ceiling of the opening — where the cove strip hides. */
export function ceilingYAt(spec: RibbonSpec, u: number): number {
  return edgeYAt(spec.top, u);
}

/** Floor of the opening — the trough the books stand in. */
export function floorYAt(spec: RibbonSpec, u: number): number {
  return edgeYAt(spec.bottom, u);
}

export function openingHeightAt(spec: RibbonSpec, u: number): number {
  return edgeYAt(spec.top, u) - edgeYAt(spec.bottom, u);
}

/** Plaster left between two stacked ribbons, measured opening to opening. */
export function bandThicknessAt(upper: RibbonSpec, lower: RibbonSpec, u: number): number {
  return edgeYAt(upper.bottom, u) - edgeYAt(lower.top, u);
}

/** Cap radius: half the opening height where the edges meet the cap. */
export function capRadii(spec: RibbonSpec): { left: number; right: number } {
  return {
    left: (spec.top.start - spec.bottom.start) / 2,
    right: (spec.top.end - spec.bottom.end) / 2,
  };
}

/** Left and right extremes of the opening, cap radius included. */
export function openingExtent(spec: RibbonSpec): { left: number; right: number } {
  const caps = capRadii(spec);
  return { left: spec.x0 - caps.left, right: spec.x1 + caps.right };
}

export interface BookSlot {
  /** Centre of the book in world x. */
  x: number;
  width: number;
  height: number;
  /** World y of the book's base, sitting in the trough of the floor fillet. */
  baseY: number;
}

export interface BayPlan {
  /** Book height as a fraction of the local opening height. */
  heightFactor: number;
  /** Cover aspect, width over height. */
  aspect: number;
  /** Gap between neighbours as a multiple of the mean book width. */
  gap: number;
}

/**
 * Place a row of books along a ribbon.
 *
 * Sizes come from the opening height, never from the ribbon's length: the app
 * frame is far wider than the reference, and spreading five books across it
 * would multiply the gaps. The row is laid out at its own natural width and the
 * ribbon carries the surplus as longer empty runs near its caps, biased so the
 * right-hand run is the longer of the two, as the reference has it.
 */
export function layoutBays(
  spec: RibbonSpec,
  plans: ReadonlyArray<BayPlan>,
  options: { inset: number; leftShare: number; sit: number },
): BookSlot[] {
  if (plans.length === 0) {
    return [];
  }
  const extent = openingExtent(spec);
  const runLeft = extent.left + options.inset;
  const runRight = extent.right - options.inset;
  const span = runRight - runLeft;

  // First pass: size every book off the opening height where it will roughly
  // stand, spreading the guesses evenly across the run.
  const widths: number[] = [];
  const heights: number[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const guessX = runLeft + (span * (index + 0.5)) / plans.length;
    const opening = openingHeightAt(spec, uAt(spec, guessX));
    const height = opening * plans[index].heightFactor;
    heights.push(height);
    widths.push(height * plans[index].aspect);
  }

  const meanWidth = widths.reduce((sum, value) => sum + value, 0) / widths.length;
  const gaps: number[] = [];
  for (let index = 0; index < plans.length - 1; index += 1) {
    gaps.push(meanWidth * (plans[index].gap + plans[index + 1].gap) * 0.5);
  }

  const total =
    widths.reduce((sum, value) => sum + value, 0) + gaps.reduce((sum, value) => sum + value, 0);
  const slack = Math.max(0, span - total);
  let cursor = runLeft + slack * options.leftShare;

  const slots: BookSlot[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const x = cursor + widths[index] / 2;
    const u = uAt(spec, x);
    // Re-read the height off the floor the book actually stands on, so a book
    // on a dishing stretch is a touch taller than one up near a cap.
    const height = openingHeightAt(spec, u) * plans[index].heightFactor;
    slots.push({
      x,
      width: height * plans[index].aspect,
      height,
      baseY: floorYAt(spec, u) + options.sit,
    });
    cursor += widths[index] + (gaps[index] ?? 0);
  }
  return slots;
}
