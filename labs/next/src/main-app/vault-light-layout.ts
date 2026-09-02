/** Geometry tokens shared by the CSS alcove and the GPU lighting pass. */

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

/** Lights sit mid-soffit: halfway from the glass lip to the inner wall. */
export const LIGHT_CEILING_T = 0.5;

/** World depth of the alcove, in units where opening width = 1. */
export const WORLD_DEPTH = 0.38;

/**
 * Opening height / width at APP_SIZE 1180×760 after the measured bezels.
 * The GPU canvas covers the opening, so this is also its world Y extent.
 */
export const OPENING_ASPECT = 0.5808;

/** Aim down the column so the cone covers all three rows. */
export const AIM_Y = 0.7;
export const AIM_Z = 0.9;
export const AIM_SPLAY = 0;

export const SPOT_INNER_DEG = 12;
export const SPOT_OUTER_DEG = 52;
export const LIGHT_RANGE = 1.72;
export const LIGHT_RADIUS = 0.12;
export const LIGHT_INTENSITY = 0.78;
export const AMBIENT = 0.16;
export const VOLUME_DENSITY = 0.28;
export const NICHE_DEPTH = 0.055;

export const LAMP_ALL = 0b11111;

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

/** Opening-UV X of a ceiling fixture — same space as the GPU canvas and the CSS cans. */
export function lightWorldX(column: number) {
  return lightOpeningU(column);
}

export function lightWorldZ() {
  return -WORLD_DEPTH * LIGHT_CEILING_T;
}

export function lightPos(column: number, height = OPENING_ASPECT) {
  return {
    x: lightWorldX(column),
    y: height - 0.008,
    z: lightWorldZ(),
  };
}

/** Axis of the gimbal: from the can, down its column, into the back wall. */
export function lightAim(column: number, height = OPENING_ASPECT) {
  return {
    x: lightOpeningU(column) + (column - 2) * Math.abs(column - 2) * AIM_SPLAY,
    y: height * AIM_Y,
    z: -WORLD_DEPTH * AIM_Z,
  };
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

function hypot3(x: number, y: number, z: number) {
  return Math.hypot(x, y, z);
}

/** Direct irradiance at a world point from the enabled spots. */
export function pointEnergy(
  x: number,
  y: number,
  z: number,
  height = OPENING_ASPECT,
  lamps = LAMP_ALL,
) {
  const inner = Math.cos(degToRad(SPOT_INNER_DEG));
  const outer = Math.cos(degToRad(SPOT_OUTER_DEG));
  let energy = 0;
  let pullX = 0;
  for (let column = 0; column < COLUMNS; column++) {
    if (((lamps >> column) & 1) === 0) continue;
    const pos = lightPos(column, height);
    const aim = lightAim(column, height);
    const travelX = aim.x - pos.x;
    const travelY = aim.y - pos.y;
    const travelZ = aim.z - pos.z;
    const travelLen = hypot3(travelX, travelY, travelZ);
    const toX = x - pos.x;
    const toY = y - pos.y;
    const toZ = z - pos.z;
    const dist = hypot3(toX, toY, toZ);
    const cosTheta = (toX * travelX + toY * travelY + toZ * travelZ) / Math.max(1e-6, dist * travelLen);
    const contribution =
      LIGHT_INTENSITY * spotFactor(cosTheta, inner, outer) * distanceAttenuation(dist, LIGHT_RANGE, LIGHT_RADIUS);
    energy += contribution;
    pullX += (pos.x - x) * contribution;
  }
  return { energy, keyX: energy > 1e-6 ? pullX / energy : 0 };
}

export function nicheCenterWorld(row: number, col: number, height = OPENING_ASPECT) {
  const backW = 1 - 2 * DEPTH_X;
  const backH = (1 - DEPTH_T - DEPTH_B) * height;
  const backAspect = backW / Math.max(backH, 1e-6);
  const padY = VERT_PAD * backAspect;
  const gapY = ROW_GAP * backAspect;
  const nicheH = (NICHE_W / NICHE_ASPECT) * backAspect;
  const backU = columnCenterBackU(col);
  const backV = padY + row * (nicheH + gapY) + nicheH * 0.42;
  return {
    x: DEPTH_X + backU * backW,
    y: height * (1 - backV),
    z: -WORLD_DEPTH,
  };
}

export function slotLight(row: number, col: number, height = OPENING_ASPECT, lamps = LAMP_ALL) {
  const center = nicheCenterWorld(row, col, height);
  const bookTop = { ...center, y: center.y + 0.045, z: center.z + 0.035 };
  const well = pointEnergy(center.x, center.y, center.z, height, lamps);
  const cover = pointEnergy(bookTop.x, bookTop.y, bookTop.z, height, lamps);
  return {
    irr: well.energy,
    cover: cover.energy,
    keyX: well.keyX,
  };
}

export function peakSlotEnergy(height = OPENING_ASPECT) {
  return slotLight(0, 2, height).irr;
}

export type VaultLightState = {
  lit: boolean;
  occupied: number;
  lamps: number;
};
