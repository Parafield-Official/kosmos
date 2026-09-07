import type { AcxReport } from "./measure";
import type { SpecPreset } from "./presets";

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

export interface NoiseProfileSelection {
  startSample: number;
  sampleCount: number;
  rmsDbfs: number;
}

/**
 * Treat the quiet-window meter as a candidate, never proof of silence. Require
 * sustained, nonzero, steady audio well below the programme's active frames.
 * No samples are trimmed and no speech/noise label is promised to the user.
 */
export function selectNoiseProfile(
  samples: Float32Array, sampleRate: number,
  report: Pick<AcxReport, "noise_floor_start_seconds" | "noise_floor_duration_seconds">,
): NoiseProfileSelection | null {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || samples.length < sampleRate) return null;
  const startSample = Math.round(report.noise_floor_start_seconds * sampleRate);
  const sampleCount = Math.min(Math.round(report.noise_floor_duration_seconds * sampleRate), sampleRate * 2);
  if (!Number.isInteger(startSample) || !Number.isInteger(sampleCount) || startSample < 0 ||
      sampleCount < sampleRate * 0.2 || startSample + sampleCount > samples.length) return null;
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  const levels: number[] = [];
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) levels.push(frameLevel(samples, i, frameSize));
  if (levels.some(x => Number.isNaN(x))) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  const activeLevel = sorted[Math.floor((sorted.length - 1) * 0.9)];
  const quietLevels: number[] = [];
  for (let i = startSample; i + frameSize <= startSample + sampleCount; i += frameSize) {
    quietLevels.push(frameLevel(samples, i, frameSize));
  }
  const rmsDbfs = frameLevel(samples, startSample, sampleCount);
  const quietSorted = [...quietLevels].sort((a, b) => a - b);
  // Noise fluctuates between short frames. Use the central spread so a single
  // quieter frame does not disqualify a steady pause; still reject loud spikes.
  const quietQuantile = (p: number) => quietSorted[Math.floor((quietSorted.length - 1) * p)];
  if (!Number.isFinite(rmsDbfs) || rmsDbfs < -100 ||
      quietLevels.some(x => !Number.isFinite(x)) ||
      quietQuantile(0.9) - quietQuantile(0.1) > 6 ||
      Math.max(...quietLevels) > quietQuantile(0.5) + 6 ||
      Math.max(...quietLevels) > activeLevel - 20) return null;
  return { startSample, sampleCount, rmsDbfs };
}

/** Keep encoding/measurement margin; never move an RMS target upward or alter LUFS. */
export function quieterRmsTarget(preset: SpecPreset, requested: number): number | undefined {
  const range = preset.rms_dbfs;
  if (!range || preset.lufs || !Number.isFinite(requested) || range.max <= range.min) return undefined;
  const target = range.min + Math.min(1, (range.max - range.min) / 4);
  return target < requested - 0.1 ? target : undefined;
}

/** Bundled afftdn uses three 12.5 ms hops; two hops precede the first real sample. */
export function denoiseDelaySamples(sampleRate: number): number {
  if (!Number.isInteger(sampleRate) || sampleRate < 80) throw new Error("Invalid denoiser sample rate");
  return 2 * Math.floor(sampleRate / 80);
}

export function profiledAfftdnFilter(noiseFloorDbfs: number, reductionDb: number): string {
  // Learn before the original recording starts; no narration is fed to the
  // learning command. Keep the learned spectrum instead of replacing it with
  // a continuously tracked white-noise estimate.
  return `asendcmd=c='0.0 afftdn sn start; 0.8 afftdn sn stop',${afftdnFilter(noiseFloorDbfs, reductionDb).replace("tn=1", "tn=0")}`;
}

/**
 * A bounded signal-preservation check, not perceptual certification. Reject
 * shifted, truncated, invalid or substantially altered active/soft frames.
 * Inspect before normalization so makeup gain cannot conceal deleted speech.
 */
export function assessDenoiseCandidate(source: Float32Array, candidate: Float32Array, sampleRate: number, floor: number): { safe: boolean; reason?: string } {
  const reject = () => ({ safe: false, reason: "Noise cleanup changed voice-like audio beyond the automatic preservation limits." });
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isFinite(floor) ||
      source.length === 0 || source.length !== candidate.length) return reject();
  const size = Math.max(1, Math.round(sampleRate * 0.02));
  let active = 0, altered = 0, consecutive = 0;
  for (let start = 0; start < source.length; start += size) {
    let before = 0, after = 0, dot = 0;
    const length = Math.min(size, source.length - start);
    for (let i = start; i < start + length; i++) {
      const a = source[i], b = candidate[i];
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 1.0001) return reject();
      before += a * a; after += b * b; dot += a * b;
    }
    const level = 10 * Math.log10(Math.max(before / length, 1e-20));
    if (level < floor + 10) { consecutive = 0; continue; }
    active++;
    const change = 10 * Math.log10(Math.max(after, 1e-20) / Math.max(before, 1e-20));
    const correlation = dot / Math.sqrt(Math.max(before * after, 1e-30));
    const strong = level >= floor + 18;
    const bad = change < (strong ? -3 : -6) || change > 0.5 || correlation < (strong ? 0.98 : 0.9);
    altered += Number(bad);
    consecutive = bad ? consecutive + 1 : 0;
    if (consecutive >= 5) return reject();
  }
  return active > 0 && altered / active <= 0.02 ? { safe: true } : reject();
}

function frameLevel(samples: Float32Array, start: number, count: number): number {
  let power = 0;
  for (let i = start; i < start + count; i++) power += samples[i] * samples[i];
  return 10 * Math.log10(power / count);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
