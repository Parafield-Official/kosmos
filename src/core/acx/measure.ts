import { ACX_SPEC, type CheckStatus, trafficLight, type TrafficLight } from "./spec";

export type AudioFormat = "wav" | "mp3" | "flac" | "m4a" | "aiff" | "unknown";

export interface PcmAudio {
  samples: Float32Array | number[];
  sampleRate: number;
  channels: number;
  format?: AudioFormat;
  bitrate_kbps?: number;
  vbr?: boolean;
}

export interface AcxReport {
  rms_dbfs: number;
  true_peak_dbfs: number;
  sample_peak_dbfs: number;
  noise_floor_dbfs: number;
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  format: AudioFormat;
  bitrate_kbps?: number;
  vbr?: boolean;
  head_room_tone_s: number;
  tail_room_tone_s: number;
  head_room_tone_is_digital_silence: boolean;
  tail_room_tone_is_digital_silence: boolean;
  checks: {
    rms: CheckStatus;
    true_peak: CheckStatus;
    noise_floor: CheckStatus;
    sample_rate: CheckStatus;
    channels: CheckStatus;
    duration: CheckStatus;
    format: CheckStatus;
    head_room_tone: CheckStatus;
    tail_room_tone: CheckStatus;
  };
  traffic_light: TrafficLight;
}

const FRAME_SECONDS = 0.02;
const MIN_ROOM_TONE_SECONDS = 0.2;
const DIGITAL_SILENCE_EPSILON = 1e-9;

export function dbfs(amplitude: number): number {
  return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude);
}

export function samplePeakDbfs(samples: Float32Array | number[]): number {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return dbfs(peak);
}

export function rmsDbfs(samples: Float32Array | number[]): number {
  if (samples.length === 0) {
    return -Infinity;
  }
  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }
  return dbfs(Math.sqrt(sumSquares / samples.length));
}

/**
 * Estimate reconstructed peaks with a 4x windowed-sinc interpolator. This is
 * deliberately a meter primitive rather than a sample-peak shortcut: ACX's
 * -3 dB ceiling applies to inter-sample peaks too.
 */
export function truePeakDbfs(
  samples: Float32Array | number[],
  channels = 1,
  oversampleFactor = 4,
): number {
  if (samples.length === 0) {
    return -Infinity;
  }

  const channelSignals = splitChannels(samples, channels);
  let peak = 0;
  for (const signal of channelSignals) {
    peak = Math.max(peak, oversampledPeak(signal, oversampleFactor));
  }
  return dbfs(peak);
}

export function measurePcm(audio: PcmAudio): AcxReport {
  const samples = audio.samples;
  const durationSeconds = audio.sampleRate > 0 && audio.channels > 0
    ? samples.length / audio.channels / audio.sampleRate
    : 0;
  const frameRms = frameRmsDbfs(samples, audio.sampleRate, audio.channels);
  const noiseFloor = detectNoiseFloor(samples, audio.sampleRate, audio.channels, frameRms);
  const roomTone = measureRoomTone(samples, audio.sampleRate, audio.channels, frameRms, noiseFloor);
  const samplePeak = samplePeakDbfs(samples);
  const truePeak = truePeakDbfs(samples, audio.channels);
  const format = audio.format ?? "unknown";

  const checks = {
    rms: rangeStatus(
      rmsDbfs(samples),
      ACX_SPEC.rms_dbfs.min,
      ACX_SPEC.rms_dbfs.max,
      0.5,
    ),
    true_peak: upperBoundStatus(truePeak, ACX_SPEC.true_peak_dbfs_max, 0.5),
    noise_floor: upperBoundStatus(noiseFloor, ACX_SPEC.noise_floor_dbfs_max, 0.5, true),
    sample_rate: audio.sampleRate === ACX_SPEC.sample_rate ? "pass" : "fail",
    channels: audio.channels === 1 || audio.channels === 2 ? "pass" : "fail",
    duration: durationSeconds <= ACX_SPEC.max_file_seconds ? "pass" : "fail",
    format: formatStatus(audio),
    head_room_tone: roomTone.head.seconds >= ACX_SPEC.room_tone_head_s.min &&
      roomTone.head.seconds <= ACX_SPEC.room_tone_head_s.max &&
      !roomTone.head.digitalSilence
      ? "pass"
      : "fail",
    tail_room_tone: roomTone.tail.seconds >= ACX_SPEC.room_tone_tail_s.min &&
      roomTone.tail.seconds <= ACX_SPEC.room_tone_tail_s.max &&
      !roomTone.tail.digitalSilence
      ? "pass"
      : "fail",
  } satisfies AcxReport["checks"];

  return {
    rms_dbfs: rmsDbfs(samples),
    true_peak_dbfs: truePeak,
    sample_peak_dbfs: samplePeak,
    noise_floor_dbfs: noiseFloor,
    sample_rate: audio.sampleRate,
    channels: audio.channels,
    duration_seconds: durationSeconds,
    format,
    bitrate_kbps: audio.bitrate_kbps,
    vbr: audio.vbr,
    head_room_tone_s: roomTone.head.seconds,
    tail_room_tone_s: roomTone.tail.seconds,
    head_room_tone_is_digital_silence: roomTone.head.digitalSilence,
    tail_room_tone_is_digital_silence: roomTone.tail.digitalSilence,
    checks,
    traffic_light: trafficLight(checks),
  };
}

function formatStatus(audio: PcmAudio): CheckStatus {
  if (audio.format === "mp3" && (audio.vbr === true || (audio.bitrate_kbps ?? Infinity) < ACX_SPEC.min_bitrate_cbr)) {
    return "fail";
  }
  if (audio.vbr === true || (audio.bitrate_kbps !== undefined && audio.bitrate_kbps < ACX_SPEC.min_bitrate_cbr)) {
    return "fail";
  }
  return "pass";
}

function rangeStatus(value: number, min: number, max: number, edge: number): CheckStatus {
  if (value < min || value > max) {
    return "fail";
  }
  if (value - min <= edge || max - value <= edge) {
    return "warn";
  }
  return "pass";
}

function upperBoundStatus(
  value: number,
  max: number,
  edge: number,
  digitalSilenceIsWarning = false,
): CheckStatus {
  if (digitalSilenceIsWarning && value === -Infinity) {
    return "warn";
  }
  if (value > max) {
    return "fail";
  }
  if (max - value <= edge) {
    return "warn";
  }
  return "pass";
}

function splitChannels(samples: Float32Array | number[], channels: number): number[][] {
  const count = Math.max(1, Math.floor(channels));
  const output = Array.from({ length: count }, () => [] as number[]);
  for (let index = 0; index < samples.length; index += 1) {
    output[index % count].push(samples[index]);
  }
  return output;
}

function oversampledPeak(signal: number[], factor: number): number {
  if (signal.length === 0) {
    return 0;
  }
  if (signal.length === 1) {
    return Math.abs(signal[0]);
  }

  const radius = 16;
  const outputLength = (signal.length - 1) * factor + 1;
  let peak = 0;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const position = outputIndex / factor;
    const center = Math.floor(position);
    let value = 0;
    let weight = 0;
    const first = Math.max(0, center - radius + 1);
    const last = Math.min(signal.length - 1, center + radius);

    for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
      const distance = position - sourceIndex;
      const absoluteDistance = Math.abs(distance);
      if (absoluteDistance >= radius) {
        continue;
      }
      const coefficient = sinc(distance) * raisedCosine(absoluteDistance / radius);
      value += signal[sourceIndex] * coefficient;
      weight += coefficient;
    }

    if (Math.abs(weight) > 1e-12) {
      value /= weight;
    }
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}

function sinc(value: number): number {
  if (Math.abs(value) < 1e-12) {
    return 1;
  }
  const piValue = Math.PI * value;
  return Math.sin(piValue) / piValue;
}

function raisedCosine(value: number): number {
  return 0.5 + 0.5 * Math.cos(Math.PI * value);
}

function frameRmsDbfs(
  samples: Float32Array | number[],
  sampleRate: number,
  channels: number,
): number[] {
  const samplesPerFrame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS * Math.max(1, channels)));
  const frames: number[] = [];
  for (let start = 0; start < samples.length; start += samplesPerFrame) {
    frames.push(rmsDbfs(Array.prototype.slice.call(samples, start, start + samplesPerFrame)));
  }
  return frames;
}

function detectNoiseFloor(
  samples: Float32Array | number[],
  sampleRate: number,
  channels: number,
  frameRms: number[],
): number {
  if (samples.length === 0) {
    return -Infinity;
  }
  if (samples.every((sample) => Math.abs(sample) <= DIGITAL_SILENCE_EPSILON)) {
    return -Infinity;
  }

  const sorted = [...frameRms].sort((a, b) => a - b);
  const quietReference = sorted[Math.floor(Math.max(0, sorted.length - 1) * 0.1)] ?? -Infinity;
  const loudest = sorted[sorted.length - 1] ?? quietReference;
  const threshold = Math.min(quietReference + 3, loudest - 20);
  const minimumFrames = Math.max(1, Math.ceil(MIN_ROOM_TONE_SECONDS / FRAME_SECONDS));
  const candidates: Array<[number, number]> = [];
  let start = -1;

  for (let index = 0; index <= frameRms.length; index += 1) {
    const quiet = index < frameRms.length && frameRms[index] <= threshold;
    if (quiet && start < 0) {
      start = index;
    }
    if ((!quiet || index === frameRms.length) && start >= 0) {
      if (index - start >= minimumFrames) {
        candidates.push([start, index]);
      }
      start = -1;
    }
  }

  if (candidates.length > 0) {
    return Math.min(
      ...candidates.map(([from, to]) => rmsDbfs(sliceFrames(samples, sampleRate, channels, from, to))),
    );
  }

  const fallbackFrames = Math.max(1, Math.ceil(0.5 / FRAME_SECONDS));
  let quietest = Infinity;
  for (let index = 0; index + fallbackFrames <= frameRms.length; index += 1) {
    quietest = Math.min(
      quietest,
      rmsDbfs(sliceFrames(samples, sampleRate, channels, index, index + fallbackFrames)),
    );
  }
  return quietest === Infinity ? rmsDbfs(samples) : quietest;
}

function measureRoomTone(
  samples: Float32Array | number[],
  sampleRate: number,
  channels: number,
  frameRms: number[],
  noiseFloor: number,
): {
  head: { seconds: number; digitalSilence: boolean };
  tail: { seconds: number; digitalSilence: boolean };
} {
  if (frameRms.length === 0) {
    return {
      head: { seconds: 0, digitalSilence: true },
      tail: { seconds: 0, digitalSilence: true },
    };
  }

  const speechThreshold = noiseFloor === -Infinity ? -60 : noiseFloor + 10;
  let firstSpeech = frameRms.findIndex((value) => value > speechThreshold);
  if (firstSpeech < 0) {
    firstSpeech = frameRms.length;
  }
  let lastSpeech = -1;
  for (let index = frameRms.length - 1; index >= 0; index -= 1) {
    if (frameRms[index] > speechThreshold) {
      lastSpeech = index;
      break;
    }
  }

  const headSeconds = Math.min(firstSpeech * FRAME_SECONDS, samples.length / channels / sampleRate);
  const tailSeconds = Math.min(
    (frameRms.length - 1 - lastSpeech) * FRAME_SECONDS,
    samples.length / channels / sampleRate,
  );
  const headSamples = samples.slice(0, Math.max(0, Math.round(headSeconds * sampleRate * channels)));
  const tailStart = Math.max(0, samples.length - Math.round(tailSeconds * sampleRate * channels));
  const tailSamples = samples.slice(tailStart);

  return {
    head: { seconds: headSeconds, digitalSilence: headSamples.length > 0 && headSamples.every(isDigitalSilence) },
    tail: { seconds: tailSeconds, digitalSilence: tailSamples.length > 0 && tailSamples.every(isDigitalSilence) },
  };
}

function sliceFrames(
  samples: Float32Array | number[],
  sampleRate: number,
  channels: number,
  fromFrame: number,
  toFrame: number,
): number[] {
  const samplesPerFrame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS * Math.max(1, channels)));
  return Array.prototype.slice.call(samples, fromFrame * samplesPerFrame, toFrame * samplesPerFrame);
}

function isDigitalSilence(sample: number): boolean {
  return Math.abs(sample) <= DIGITAL_SILENCE_EPSILON;
}

