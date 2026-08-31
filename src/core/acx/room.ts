import { dbfs, rmsDbfs } from "./measure";

export interface RoomTestInput {
  samples: Float32Array | number[];
  sampleRate: number;
  channels: number;
  speechRmsDbfs?: number;
  targetRmsDbfs?: number;
  noiseFloorMaxDbfs?: number;
}

export interface RoomTestReport {
  durationSeconds: number;
  noiseFloorDbfs: number;
  speechRmsDbfs: number;
  targetRmsDbfs: number;
  neededBoostDb: number;
  predictedFloorDbfs: number;
  status: "pass" | "warn" | "fail";
  warning: string;
}

/** Measure intended silence and show the ACX gain-budget consequence. */
export function analyzeRoomTest(input: RoomTestInput): RoomTestReport {
  const target = input.targetRmsDbfs ?? -20;
  const floorMax = input.noiseFloorMaxDbfs ?? -60;
  const durationSeconds = input.sampleRate > 0 && input.channels > 0
    ? input.samples.length / input.sampleRate / input.channels
    : 0;
  if (
    !Number.isFinite(input.sampleRate)
    || !Number.isInteger(input.sampleRate)
    || input.sampleRate <= 0
    || !Number.isFinite(input.channels)
    || !Number.isInteger(input.channels)
    || input.channels <= 0
    || input.samples.length === 0
    || input.samples.length % input.channels !== 0
    || input.samples.some((sample) => !Number.isFinite(sample))
  ) {
    return {
      durationSeconds: 0,
      noiseFloorDbfs: Number.NaN,
      speechRmsDbfs: Number.isFinite(input.speechRmsDbfs) ? input.speechRmsDbfs as number : target,
      targetRmsDbfs: target,
      neededBoostDb: 0,
      predictedFloorDbfs: Number.NaN,
      status: "fail",
      warning: "The room test contains invalid audio metadata or non-finite samples; record it again.",
    };
  }
  const mono = mixToMono(input.samples, input.channels);
  const noiseFloor = silenceFloorDbfs(mono, input.sampleRate);
  const speechRms = Number.isFinite(input.speechRmsDbfs) ? input.speechRmsDbfs as number : target;
  const neededBoost = Math.max(0, target - speechRms);
  const predictedFloor = Number.isFinite(noiseFloor) ? noiseFloor + neededBoost : -Infinity;

  if (durationSeconds < 10 || durationSeconds > 20) {
    return {
      durationSeconds,
      noiseFloorDbfs: noiseFloor,
      speechRmsDbfs: speechRms,
      targetRmsDbfs: target,
      neededBoostDb: neededBoost,
      predictedFloorDbfs: predictedFloor,
      status: "warn",
      warning: "Sit still and don't talk for 10–20 seconds so we can measure how noisy the room is.",
    };
  }
  if (noiseFloor === -Infinity) {
    return {
      durationSeconds,
      noiseFloorDbfs: noiseFloor,
      speechRmsDbfs: speechRms,
      targetRmsDbfs: target,
      neededBoostDb: neededBoost,
      predictedFloorDbfs: predictedFloor,
      status: "warn",
      warning: "The mic picked up nothing — computer silence, not the room. Choose a real microphone and make sure it isn't muted.",
    };
  }
  if (predictedFloor > floorMax) {
    return {
      durationSeconds,
      noiseFloorDbfs: noiseFloor,
      speechRmsDbfs: speechRms,
      targetRmsDbfs: target,
      neededBoostDb: neededBoost,
      predictedFloorDbfs: predictedFloor,
      status: "fail",
      warning: `This room is too noisy for Audible. After raising the voice to level, background noise would sit at ${formatDb(predictedFloor)} (Audible needs ≤ ${floorMax} dBFS). Fans, HVAC, traffic, and a loud computer all count — record somewhere quieter.`,
    };
  }
  const status = floorMax - predictedFloor <= 0.5 ? "warn" : "pass";
  return {
    durationSeconds,
    noiseFloorDbfs: noiseFloor,
    speechRmsDbfs: speechRms,
    targetRmsDbfs: target,
    neededBoostDb: neededBoost,
    predictedFloorDbfs: predictedFloor,
    status,
    warning: status === "warn"
      ? "A bit noisy — close to Audible's limit. You can record, but listen to a take before you do the whole book."
      : "Quiet enough for Audible. Background noise stays below the limit after the voice is brought up to level.",
  };
}

/**
 * 20th-percentile of 50 ms RMS frames after subtracting each frame's mean.
 * A click, a DC mic bias, or the first buffer of the take does not become
 * the room's noise floor.
 */
function silenceFloorDbfs(samples: number[], sampleRate: number): number {
  const frameSize = Math.max(1, Math.round(Math.max(1, sampleRate) * 0.05));
  const levels: number[] = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += frameSize) {
    let sum = 0;
    for (let index = 0; index < frameSize; index += 1) {
      sum += samples[offset + index];
    }
    const mean = sum / frameSize;
    let sumSquares = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const centered = samples[offset + index] - mean;
      sumSquares += centered * centered;
    }
    levels.push(Math.sqrt(sumSquares / frameSize));
  }
  const audible = levels.filter((rms) => rms > 1e-9);
  if (audible.length === 0) {
    return rmsDbfs(samples);
  }
  audible.sort((a, b) => a - b);
  const pick = Math.min(audible.length - 1, Math.floor((audible.length - 1) * 0.2));
  return dbfs(audible[pick] ?? 0);
}

function mixToMono(samples: Float32Array | number[], channels: number): number[] {
  const count = Math.max(1, Math.floor(channels || 1));
  if (count === 1) {
    return Array.from(samples);
  }
  const frames = Math.floor(samples.length / count);
  const output = new Array<number>(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < count; channel += 1) {
      sum += samples[frame * count + channel];
    }
    output[frame] = sum / count;
  }
  return output;
}

function formatDb(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "−∞ dBFS";
}

export { dbfs };
