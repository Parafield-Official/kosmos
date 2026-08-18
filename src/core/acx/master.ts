import { measurePcm, rmsDbfs, truePeakDbfs, type AcxReport } from "./measure";

export { measurePcm } from "./measure";

export interface MasterPcmInput {
  samples: Float32Array | number[];
  sampleRate: number;
  channels: number;
}

export interface MasterOptions {
  targetRmsDbfs?: number;
  limiterCeilingDbfs?: number;
  noiseFloorMaxDbfs?: number;
  headSeconds?: number;
  tailSeconds?: number;
}

export interface MasterResult {
  status: "ok" | "aborted";
  samples: Float32Array;
  sampleRate: 44100;
  channels: 1;
  before: AcxReport;
  after?: AcxReport;
  gain_db?: number;
  speech_rms_before_dbfs?: number;
  speech_rms_after_dbfs?: number;
  predicted_floor_dbfs?: number;
  processing_order: readonly [
    "decode",
    "resample",
    "mix_mono",
    "gate_non_speech",
    "compress",
    "normalize_rms",
    "true_peak_limit",
    "room_tone_pad",
  ];
  warnings: string[];
  abort_reason?: string;
}

const ORDER: MasterResult["processing_order"] = [
  "decode",
  "resample",
  "mix_mono",
  "gate_non_speech",
  "compress",
  "normalize_rms",
  "true_peak_limit",
  "room_tone_pad",
];

/**
 * Checks that must pass for a mastered file to be considered deliverable.
 * Format is intentionally excluded: the in-memory master has no container
 * yet, so its format check is expected to be a warning until encoding.
 */
export function masteringStructuralFailure(report: Pick<AcxReport, "checks">): string | undefined {
  const failed = ([
    ["sample rate", report.checks.sample_rate],
    ["channel count", report.checks.channels],
    ["duration", report.checks.duration],
    ["head room tone", report.checks.head_room_tone],
    ["tail room tone", report.checks.tail_room_tone],
  ] as const)
    .filter(([, status]) => status === "fail")
    .map(([label]) => label);
  return failed.length > 0
    ? `Mastered output failed required ACX checks: ${failed.join(", ")}.`
    : undefined;
}

const FRAME_SECONDS = 0.02;
const GATE_ATTACK_SECONDS = 0.005;
const GATE_RELEASE_SECONDS = 0.5;
const GATE_TARGET_DBFS = -70;

export function masterPcm(input: MasterPcmInput, options: MasterOptions = {}): MasterResult {
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error("Master sample rate must be a positive integer");
  }
  if (!Number.isInteger(input.channels) || input.channels <= 0) {
    throw new Error("Master channels must be a positive integer");
  }
  if (!input.samples || typeof input.samples.length !== "number") {
    throw new Error("Master input must contain PCM samples");
  }
  if (input.samples.length % input.channels !== 0) {
    throw new Error("Master PCM sample count must be divisible by the channel count");
  }
  for (const sample of input.samples) {
    if (!Number.isFinite(sample)) {
      throw new Error("Master PCM samples must be finite numbers");
    }
  }
  const targetRms = finiteOr(options.targetRmsDbfs, -20);
  const limiterCeiling = finiteOr(options.limiterCeilingDbfs, -3.2);
  const noiseFloorMax = finiteOr(options.noiseFloorMaxDbfs, -60);
  const headSeconds = clamp(finiteOr(options.headSeconds, 1.5), 0.5, 5);
  const tailSeconds = clamp(finiteOr(options.tailSeconds, 1.5), 0.5, 5);

  const mono = mixToMono(input.samples, input.channels);
  const resampled = resampleLinear(mono, input.sampleRate, 44100);
  const before = measurePcm({ samples: resampled, sampleRate: 44100, channels: 1 });
  const analysis = analyzeSpeech(resampled, 44100, before.noise_floor_dbfs);
  const speechBefore = rmsOfMaskedSamples(resampled, analysis.speechFrames, 44100);
  const neededGain = targetRms - speechBefore;
  const predictedFloor = before.noise_floor_dbfs + neededGain;
  const warnings: string[] = [];

  if (!Number.isFinite(speechBefore)) {
    return aborted(before, warnings, "No speech-like region was found; the master will not manufacture a voice.", predictedFloor, speechBefore);
  }

  if (Number.isFinite(before.noise_floor_dbfs) &&
      predictedFloor > noiseFloorMax &&
      (analysis.quietSegments.length === 0 || analysis.speechFraction > 0.9)) {
    return aborted(
      before,
      warnings,
      `The measured floor would rise to ${formatDb(predictedFloor)} after the required gain. Treat the room before recording; Booth Desk will not melt the voice with noise reduction.`,
      predictedFloor,
      speechBefore,
    );
  }

  let processed = applyGate(resampled, analysis, 44100, before.noise_floor_dbfs);
  processed = compressLightly(processed, -28, 2);
  const projected = padRoomTone(processed, analysis, 44100, headSeconds, tailSeconds);
  const gainDb = targetRms - rmsDbfs(projected);
  processed = applyGain(processed, gainDb);
  processed = limitTruePeak(processed, limiterCeiling);
  const speechAfterMaster = rmsOfMaskedSamples(processed, analysis.speechFrames, 44100);
  let padded = padRoomTone(processed, analysis, 44100, headSeconds, tailSeconds);

  // Limiting can shave a little off the target. One bounded correction keeps
  // the whole-file RMS in the ACX window without changing processing order.
  const firstPassRms = rmsDbfs(padded);
  if (firstPassRms < -23 || firstPassRms > -18) {
    processed = limitTruePeak(applyGain(processed, targetRms - firstPassRms), limiterCeiling);
    padded = padRoomTone(processed, analysis, 44100, headSeconds, tailSeconds);
  }

  const after = measurePcm({ samples: padded, sampleRate: 44100, channels: 1 });
  if (after.checks.rms === "fail") {
    return aborted(
      before,
      [...warnings, `The mastered take measures ${formatDb(after.rms_dbfs)} RMS, outside ACX's -23 to -18 dBFS window after true-peak limiting.`],
      "The take could not reach the ACX loudness window without exceeding the true-peak ceiling.",
      predictedFloor,
      speechBefore,
    );
  }
  if (after.checks.noise_floor === "fail") {
    return aborted(
      before,
      [
        ...warnings,
        `The gated result still measures ${formatDb(after.noise_floor_dbfs)}. The voice was left intact; treat the room or use a clean take.`,
      ],
      "The non-speech gate could not bring the noise floor under ACX's limit safely.",
      predictedFloor,
      speechBefore,
    );
  }

  if (after.checks.true_peak === "fail") {
    return aborted(
      before,
      [...warnings, "The true-peak limiter could not reach its ceiling without another decode pass."],
      "True-peak limiting did not converge.",
      predictedFloor,
      speechBefore,
    );
  }

  const structuralFailure = masteringStructuralFailure(after);
  if (structuralFailure) {
    return aborted(
      before,
      [...warnings, structuralFailure],
      structuralFailure,
      predictedFloor,
      speechBefore,
    );
  }

  return {
    status: "ok",
    samples: Float32Array.from(padded),
    sampleRate: 44100,
    channels: 1,
    before,
    after,
    gain_db: gainDb,
    speech_rms_before_dbfs: speechBefore,
    speech_rms_after_dbfs: speechAfterMaster,
    predicted_floor_dbfs: predictedFloor,
    processing_order: ORDER,
    warnings,
  };
}

function aborted(
  before: AcxReport,
  warnings: string[],
  reason: string,
  predictedFloor: number,
  speechBefore: number,
): MasterResult {
  return {
    status: "aborted",
    samples: new Float32Array(),
    sampleRate: 44100,
    channels: 1,
    before,
    predicted_floor_dbfs: predictedFloor,
    speech_rms_before_dbfs: speechBefore,
    processing_order: ORDER,
    warnings,
    abort_reason: reason,
  };
}

interface SpeechAnalysis {
  speechFrames: boolean[];
  frameRms: number[];
  quietSegments: Array<{ from: number; to: number }>;
  speechFraction: number;
}

function analyzeSpeech(samples: number[], sampleRate: number, noiseFloorDbfs: number): SpeechAnalysis {
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frameRms: number[] = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    frameRms.push(rmsDbfs(samples.slice(start, start + frameSize)));
  }

  const sorted = [...frameRms].sort((a, b) => a - b);
  const quietReference = sorted[Math.floor(Math.max(0, sorted.length - 1) * 0.1)] ?? -Infinity;
  const threshold = Number.isFinite(noiseFloorDbfs)
    ? noiseFloorDbfs + 10
    : quietReference + 10;
  let speechFrames = frameRms.map((value) => value > threshold);
  if (!speechFrames.some(Boolean) && frameRms.length > 0) {
    let loudest = -Infinity;
    for (const value of frameRms) {
      loudest = Math.max(loudest, value);
    }
    speechFrames = frameRms.map((value) => value >= loudest - 6);
  }

  const quietSegments: Array<{ from: number; to: number }> = [];
  let quietStart = -1;
  for (let index = 0; index <= speechFrames.length; index += 1) {
    const quiet = index < speechFrames.length && !speechFrames[index];
    if (quiet && quietStart < 0) {
      quietStart = index;
    }
    if ((!quiet || index === speechFrames.length) && quietStart >= 0) {
      if (index - quietStart >= Math.ceil(0.2 / FRAME_SECONDS)) {
        quietSegments.push({ from: quietStart, to: index });
      }
      quietStart = -1;
    }
  }

  return {
    speechFrames,
    frameRms,
    quietSegments,
    speechFraction: speechFrames.length === 0 ? 0 : speechFrames.filter(Boolean).length / speechFrames.length,
  };
}

function applyGate(samples: number[], analysis: SpeechAnalysis, sampleRate: number, noiseFloorDbfs: number): number[] {
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const attackSamples = Math.max(1, Math.round(sampleRate * GATE_ATTACK_SECONDS));
  const releaseSamples = Math.max(1, Math.round(sampleRate * GATE_RELEASE_SECONDS));
  const neededReduction = Number.isFinite(noiseFloorDbfs)
    ? Math.max(0, noiseFloorDbfs - GATE_TARGET_DBFS)
    : 18;
  const reductionDb = neededReduction === 0 ? 0 : clamp(neededReduction + 3, 6, 30);
  const gateAmplitude = 10 ** (-reductionDb / 20);
  const output = new Array<number>(samples.length);
  let envelope = gateAmplitude;

  for (let index = 0; index < samples.length; index += 1) {
    const frame = Math.min(analysis.speechFrames.length - 1, Math.floor(index / frameSize));
    const target = analysis.speechFrames[frame] ? 1 : gateAmplitude;
    const duration = target > envelope ? attackSamples : releaseSamples;
    envelope += (target - envelope) / duration;
    output[index] = samples[index] * envelope;
  }
  return output;
}

function compressLightly(samples: number[], thresholdDbfs: number, ratio: number): number[] {
  const threshold = 10 ** (thresholdDbfs / 20);
  return samples.map((sample) => {
    const sign = sample < 0 ? -1 : 1;
    const amplitude = Math.abs(sample);
    if (amplitude <= threshold) {
      return sample;
    }
    const inputDb = 20 * Math.log10(amplitude);
    const outputDb = thresholdDbfs + (inputDb - thresholdDbfs) / ratio;
    return sign * (10 ** (outputDb / 20));
  });
}

function applyGain(samples: number[], gainDb: number): number[] {
  const multiplier = 10 ** (gainDb / 20);
  return samples.map((sample) => sample * multiplier);
}

function limitTruePeak(samples: number[], ceilingDbfs: number): number[] {
  let output = samples;
  for (let pass = 0; pass < 2; pass += 1) {
    const peakDbfs = truePeakDbfs(output, 1);
    if (peakDbfs <= ceilingDbfs) {
      break;
    }
    output = applyGain(output, ceilingDbfs - peakDbfs);
  }
  const ceiling = 10 ** (ceilingDbfs / 20);
  return output.map((sample) => Math.max(-ceiling, Math.min(ceiling, sample)));
}

function padRoomTone(
  samples: number[],
  analysis: SpeechAnalysis,
  sampleRate: number,
  headSeconds: number,
  tailSeconds: number,
): number[] {
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const firstSpeechFrame = analysis.speechFrames.findIndex(Boolean);
  let lastSpeechFrame = -1;
  for (let index = analysis.speechFrames.length - 1; index >= 0; index -= 1) {
    if (analysis.speechFrames[index]) {
      lastSpeechFrame = index;
      break;
    }
  }

  const bodyStart = firstSpeechFrame < 0 ? 0 : firstSpeechFrame * frameSize;
  const bodyEnd = lastSpeechFrame < 0
    ? samples.length
    : Math.min(samples.length, (lastSpeechFrame + 1) * frameSize);
  const room = quietRoomTone(samples, analysis, frameSize);
  const head = repeatRoomTone(room, Math.round(headSeconds * sampleRate));
  const tail = repeatRoomTone(room, Math.round(tailSeconds * sampleRate));
  const output = new Array<number>(head.length + (bodyEnd - bodyStart) + tail.length);
  let outputIndex = 0;
  for (const sample of head) {
    output[outputIndex] = sample;
    outputIndex += 1;
  }
  for (let index = bodyStart; index < bodyEnd; index += 1) {
    output[outputIndex] = samples[index];
    outputIndex += 1;
  }
  for (const sample of tail) {
    output[outputIndex] = sample;
    outputIndex += 1;
  }
  return output;
}

function quietRoomTone(samples: number[], analysis: SpeechAnalysis, frameSize: number): number[] {
  let bestRoom: number[] | null = null;
  let bestRms = Infinity;
  if (analysis.quietSegments.length > 0) {
    for (const segment of analysis.quietSegments) {
      const candidate = samples.slice(segment.from * frameSize, segment.to * frameSize);
      // Exact zero is editing silence, not room tone. Continue looking rather
      // than falling back to the first half-second, which may contain speech.
      if (!candidate.some((sample) => Math.abs(sample) > 1e-9)) {
        continue;
      }
      const candidateRms = rmsDbfs(candidate);
      if (candidateRms < bestRms) {
        bestRoom = candidate;
        bestRms = candidateRms;
      }
    }
  }
  if (bestRoom) {
    return bestRoom;
  }
  return syntheticRoomTone(Math.max(32, frameSize * 10));
}

function repeatRoomTone(room: number[], length: number): number[] {
  const output = new Array<number>(Math.max(0, length));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = room[index % room.length];
  }
  return output;
}

/** Deterministic low-level noise is safer than padding with DC or copied speech. */
function syntheticRoomTone(length: number): number[] {
  const output = new Array<number>(length);
  const peak = (10 ** (GATE_TARGET_DBFS / 20)) * Math.sqrt(3);
  let state = 0x6d2b79f5;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    output[index] = (((state / 0x1_0000_0000) * 2) - 1) * peak;
  }
  return output;
}

function rmsOfMaskedSamples(samples: number[], speechFrames: boolean[], sampleRate: number): number {
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const speechSamples: number[] = [];
  for (let index = 0; index < speechFrames.length; index += 1) {
    if (speechFrames[index]) {
      speechSamples.push(...samples.slice(index * frameSize, (index + 1) * frameSize));
    }
  }
  return rmsDbfs(speechSamples);
}

function mixToMono(samples: Float32Array | number[], channels: number): number[] {
  const count = Math.max(1, Math.floor(channels));
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

function resampleLinear(samples: number[], fromRate: number, toRate: number): number[] {
  if (samples.length === 0 || !Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0 || fromRate === toRate) {
    return samples;
  }
  const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Array<number>(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(samples.length - 1, left)] ?? 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatDb(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "−∞ dBFS";
}
