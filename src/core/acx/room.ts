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
  const mono = mixToMono(input.samples, input.channels);
  const noiseFloor = rmsDbfs(mono);
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
      warning: "Record 10–20 seconds of intended silence for a reliable room estimate.",
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
      warning: "This is digital silence, not room tone. Measure a real microphone signal.",
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
      warning: `Treat the room before recording a whole book. After a ${neededBoost.toFixed(1)} dB boost, the predicted floor is ${formatDb(predictedFloor)} (ACX needs ≤ ${floorMax} dBFS).`,
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
      ? "The predicted floor is close to the ACX limit. Leave headroom and listen to a finished take."
      : "Room estimate is below the ACX floor after the expected gain.",
  };
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
