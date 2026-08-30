/** Geometry tokens shared by the CSS alcove and the vgpu lighting pass. */

export const COLUMNS = 5;
export const VISIBLE_ROWS = 3;

/** Lip→back as a fraction of the opening (matches vault.css). */
export const DEPTH_T = 0.06411;
export const DEPTH_B = 0.04577;
export const DEPTH_X = 0.04181;

/** Niche width as a fraction of the back wall. */
export const NICHE_W = 0.1195;
export const NICHE_ASPECT = 127 / 143;
export const COL_GAP = (NICHE_W * 70) / 127;
export const ROW_GAP = (NICHE_W * 35) / 127;
export const SIDE_PAD = (NICHE_W * 74) / 127;
export const VERT_PAD = (NICHE_W * 46) / 127;

/** Lights sit this far along the ceiling, lip → back. */
export const LIGHT_CEILING_T = 15 / 42;

/** World depth of the alcove, in units where opening width = 1. */
export const WORLD_DEPTH = 0.38;

export const SPOT_INNER_DEG = 14;
export const SPOT_OUTER_DEG = 40;
export const LIGHT_RANGE = 1.7;
export const LIGHT_RADIUS = 0.22;
export const LIGHT_INTENSITY = 2.4;
export const AMBIENT = 0.52;

export function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function columnCenterBackU(column: number) {
  return SIDE_PAD + column * (NICHE_W + COL_GAP) + NICHE_W / 2;
}

/** Opening-UV X of a ceiling fixture, aligned to its niche column. */
export function lightOpeningU(column: number) {
  return DEPTH_X + columnCenterBackU(column) * (1 - 2 * DEPTH_X);
}

export function lightWorldX(column: number) {
  return columnCenterBackU(column);
}

export function lightWorldZ() {
  return -WORLD_DEPTH * LIGHT_CEILING_T;
}

/** Windowed inverse-square. `radius` keeps the singularity off the fixture. */
export function distanceAttenuation(distance: number, range: number, radius: number) {
  const d2 = distance * distance + radius * radius;
  const inv = 1 / d2;
  const nd = Math.min(1, Math.max(0, distance / range));
  const window = 1 - nd * nd;
  return inv * window * window;
}

export function spotFactor(cosTheta: number, innerCos: number, outerCos: number) {
  if (cosTheta <= outerCos) return 0;
  if (cosTheta >= innerCos) return 1;
  const t = (cosTheta - outerCos) / (innerCos - outerCos);
  return t * t * (3 - 2 * t);
}

export function occupiedMask(filled: ReadonlyArray<boolean | undefined>) {
  let mask = 0;
  for (let i = 0; i < filled.length && i < COLUMNS * VISIBLE_ROWS; i++) {
    if (filled[i]) mask |= 1 << i;
  }
  return mask;
}
