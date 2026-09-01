import { measurePcm, rmsDbfs, truePeakDbfs, type AcxReport, type AudioFormat } from "./measure";
import {
  ACX_PRESET,
  deliveryProfile,
  type DeliveryProfile,
  type SpecPreset,
} from "./presets";

export { measurePcm } from "./measure";
export { integratedLufs } from "./loudness";
export {
  AUTOMATIC_DENOISE_CAP_DB,
  afftdnFilter,
  noiseReductionAttempts,
} from "./denoise";
export {
  AUTOMATIC_REPAIR_FILTER,
  AUTOMATIC_REPAIR_MAX_CHANGED_RATIO,
  AUTOMATIC_REPAIR_MAX_LEVEL_SHIFT_DB,
  assessRepairCandidate,
} from "./repair";
export {
  ACX_PRESET,
  BUILTIN_PRESETS,
  deliveryProfile,
  normalizeCustomPresets,
  presetTargets,
  resolvePreset,
  type SpecPreset,
} from "./presets";

export interface MasterPcmInput {
  samples: Float32Array | number[];
  sampleRate: number;
  channels: number;
  /** Container facts about the take, carried so the source report can judge it. */
  format?: AudioFormat;
  bitrate_kbps?: number;
  vbr?: boolean;
}

export interface MasterOptions {
  preset?: SpecPreset;
  profile?: DeliveryProfile;
  targetRmsDbfs?: number;
  limiterCeilingDbfs?: number;
  noiseFloorMaxDbfs?: number;
  headSeconds?: number;
  tailSeconds?: number;
}

export interface MasterResult {
  status: "ok" | "aborted";
  samples: Float32Array;
  sampleRate: number;
  channels: 1;
  /**
   * The take exactly as it arrived: its own rate, its own channel count, its own
   * container. `before` is measured after the mix-down and resample, because the
   * gain and gate maths need a mono 44.1 kHz picture, which means `before` always
   * reads 44.1 kHz mono and can never show that either was changed. Anything
   * telling the narrator what mastering fixed has to read this instead.
   */
  source: AcxReport;
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
  abort_code?: "no_speech" | "noise_floor" | "level" | "true_peak" | "structure";
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
export function masteringStructuralFailure(
  report: Pick<AcxReport, "checks">,
  targetLabel = "delivery target",
): string | undefined {
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
    ? `Mastered output failed required ${targetLabel} checks: ${failed.join(", ")}.`
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
  const preset = options.preset ?? ACX_PRESET;
  const profile = options.profile ?? deliveryProfile(preset);
  const level = profile.level?.standard === "rms" && options.targetRmsDbfs !== undefined
    ? { ...profile.level, target: options.targetRmsDbfs }
    : profile.level;
  const limiterCeiling = finiteOr(options.limiterCeilingDbfs, profile.limiterCeilingDbfs);
  const noiseFloorMax = options.noiseFloorMaxDbfs === undefined
    ? profile.noiseFloorMaxDbfs
    : finiteOr(options.noiseFloorMaxDbfs, profile.noiseFloorMaxDbfs ?? -60);
  const headSeconds = clamp(finiteOr(options.headSeconds, profile.headSeconds), 0, 5);
  const tailSeconds = clamp(finiteOr(options.tailSeconds, profile.tailSeconds), 0, 5);
  const outputSampleRate = profile.sampleRate;

  const source = measurePcm({
    samples: input.samples,
    sampleRate: input.sampleRate,
    channels: input.channels,
    format: input.format,
    bitrate_kbps: input.bitrate_kbps,
    vbr: input.vbr,
  }, { preset });
  const mono = mixToMono(input.samples, input.channels);
  const resampled = resampleLinear(mono, input.sampleRate, outputSampleRate);
  const before = measurePcm(
    { samples: resampled, sampleRate: outputSampleRate, channels: 1 },
    { preset },
  );
  const analysis = analyzeSpeech(resampled, outputSampleRate, before.noise_floor_dbfs);
  const speechBefore = rmsOfMaskedSamples(resampled, analysis.speechFrames, outputSampleRate);
  const levelBefore = level?.standard === "lufs" ? before.lufs_integrated : speechBefore;
  const neededGain = level ? level.target - levelBefore : 0;
  const predictedFloor = before.noise_floor_dbfs + neededGain;
  const warnings: string[] = [];

  if (!Number.isFinite(speechBefore)) {
    return aborted(
      source,
      before,
      warnings,
      "No speech-like region was found; the master will not manufacture a voice.",
      "no_speech",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }

  if (noiseFloorMax !== null &&
      Number.isFinite(before.noise_floor_dbfs) &&
      predictedFloor > noiseFloorMax &&
      (analysis.quietSegments.length === 0 || analysis.speechFraction > 0.9)) {
    return aborted(
      source,
      before,
      warnings,
      `The noise floor would rise to ${formatDb(predictedFloor)} after the required gain.`,
      "noise_floor",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }

  let processed = noiseFloorMax === null
    ? Array.from(resampled)
    : applyGate(resampled, analysis, outputSampleRate, before.noise_floor_dbfs);
  if (level?.standard === "rms") {
    processed = compressLightly(processed, -28, 2);
  }
  const projected = padRoomTone(processed, analysis, outputSampleRate, headSeconds, tailSeconds);
  const gainDb = level ? level.target - measuredLevel(projected, outputSampleRate, level.standard, preset) : 0;
  processed = Number.isFinite(gainDb) ? applyGain(processed, gainDb) : processed;
  processed = limitTruePeak(processed, limiterCeiling);
  const speechAfterMaster = rmsOfMaskedSamples(processed, analysis.speechFrames, outputSampleRate);
  let padded = padRoomTone(processed, analysis, outputSampleRate, headSeconds, tailSeconds);

  // Limiting can shave a little off the requested level. Two bounded
  // corrections work for both RMS audiobook targets and integrated-LUFS
  // broadcast targets without changing the processing order.
  let after = measurePcm(
    { samples: padded, sampleRate: outputSampleRate, channels: 1 },
    { preset },
  );
  for (let attempt = 0; level && attempt < 2 && levelStatus(after, level.standard) === "fail"; attempt += 1) {
    const correction = level.target - reportLevel(after, level.standard);
    processed = limitTruePeak(applyGain(processed, correction), limiterCeiling);
    padded = padRoomTone(processed, analysis, outputSampleRate, headSeconds, tailSeconds);
    after = measurePcm(
      { samples: padded, sampleRate: outputSampleRate, channels: 1 },
      { preset },
    );
  }

  if (level && levelStatus(after, level.standard) === "fail") {
    const measured = reportLevel(after, level.standard);
    const unit = level.standard === "lufs" ? "LUFS" : "dBFS RMS";
    return aborted(
      source,
      before,
      [...warnings, `The mastered take measures ${formatDb(measured)} ${unit} after true-peak limiting.`],
      `The take could not reach ${preset.label}'s ${level.standard.toUpperCase()} target without exceeding the true-peak ceiling.`,
      "level",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }
  if (noiseFloorMax !== null && after.checks.noise_floor === "fail") {
    return aborted(
      source,
      before,
      [
        ...warnings,
        `The gated result still measures ${formatDb(after.noise_floor_dbfs)}. The voice was left intact; treat the room or use a clean take.`,
      ],
      `The first mastering pass could not bring the noise floor under ${preset.label}'s limit.`,
      "noise_floor",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }

  if (after.checks.true_peak === "fail") {
    return aborted(
      source,
      before,
      [...warnings, "The true-peak limiter could not reach its ceiling without another decode pass."],
      "True-peak limiting did not converge.",
      "true_peak",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }

  const structuralFailure = masteringStructuralFailure(after, preset.label);
  if (structuralFailure) {
    return aborted(
      source,
      before,
      [...warnings, structuralFailure],
      structuralFailure,
      "structure",
      predictedFloor,
      speechBefore,
      outputSampleRate,
    );
  }

  return {
    status: "ok",
    samples: Float32Array.from(padded),
    sampleRate: outputSampleRate,
    channels: 1,
    source,
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
  source: AcxReport,
  before: AcxReport,
  warnings: string[],
  reason: string,
  code: NonNullable<MasterResult["abort_code"]>,
  predictedFloor: number,
  speechBefore: number,
  sampleRate: number,
): MasterResult {
  return {
    status: "aborted",
    samples: new Float32Array(),
    sampleRate,
    channels: 1,
    source,
    before,
    predicted_floor_dbfs: predictedFloor,
    speech_rms_before_dbfs: speechBefore,
    processing_order: ORDER,
    warnings,
    abort_code: code,
    abort_reason: reason,
  };
}

function measuredLevel(
  samples: number[],
  sampleRate: number,
  standard: "rms" | "lufs",
  preset: SpecPreset,
): number {
  if (standard === "rms") {
    return rmsDbfs(samples);
  }
  return measurePcm(
    { samples, sampleRate, channels: 1 },
    { preset, requireRoomTone: false },
  ).lufs_integrated;
}

function reportLevel(report: AcxReport, standard: "rms" | "lufs"): number {
  return standard === "rms" ? report.rms_dbfs : report.lufs_integrated;
}

function levelStatus(report: AcxReport, standard: "rms" | "lufs") {
  return standard === "rms" ? report.checks.rms : report.checks.loudness;
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
