/**
 * Conservative one-click cleanup for a steady audiobook noise floor.
 *
 * FFmpeg's `afftdn` filter can track a changing FFT noise profile without an
 * external model. Twelve decibels is its documented default and our unattended
 * ceiling: if that cannot satisfy the target, the app stops rather than trading
 * a technical pass for metallic, phasey narration.
 */
export const AUTOMATIC_DENOISE_CAP_DB = 12;
export const AUTOMATIC_DENOISE_MIN_DB = 4;

export function noiseReductionAttempts(
  predictedFloorDbfs: number,
  maximumFloorDbfs: number,
): number[] {
  const needed = Number.isFinite(predictedFloorDbfs)
    ? predictedFloorDbfs - maximumFloorDbfs + 2
    : AUTOMATIC_DENOISE_CAP_DB;
  const first = Math.max(
    AUTOMATIC_DENOISE_MIN_DB,
    Math.min(AUTOMATIC_DENOISE_CAP_DB, Math.ceil(needed)),
  );
  return first < AUTOMATIC_DENOISE_CAP_DB
    ? [first, AUTOMATIC_DENOISE_CAP_DB]
    : [AUTOMATIC_DENOISE_CAP_DB];
}

export function afftdnFilter(noiseFloorDbfs: number, reductionDb: number): string {
  const floor = Math.max(-80, Math.min(-20, finiteOr(noiseFloorDbfs, -50)));
  const reduction = Math.max(
    AUTOMATIC_DENOISE_MIN_DB,
    Math.min(AUTOMATIC_DENOISE_CAP_DB, finiteOr(reductionDb, AUTOMATIC_DENOISE_CAP_DB)),
  );
  // tn follows a changing floor; gain smoothing suppresses isolated FFT-bin
  // "musical noise" without applying an EQ curve to the narrator.
  return `afftdn=nr=${reduction}:nf=${floor}:tn=1:gs=8`;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
