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

export interface MeasureOptions {
  /** Retail samples begin on narration and intentionally have no room-tone pad. */
  requireRoomTone?: boolean;
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
 * -3 dB ceiling applies to inter-sample peaks too. The phase coefficients are
 * cached per call so a feature-length chapter does not repeatedly evaluate
 * trigonometric functions for the same FIR taps.
 */
export function truePeakDbfs(
  samples: Float32Array | number[],
  channels = 1,
  oversampleFactor = 4,
): number {
  if (samples.length === 0) {
    return -Infinity;
  }

  const channelCount = positiveIntegerOrZero(channels) || 1;
  const frameCount = Math.floor(samples.length / channelCount);
  let peak = 0;
  const factor = Number.isInteger(oversampleFactor) && oversampleFactor > 0 ? oversampleFactor : 4;
  for (let channel = 0; channel < channelCount; channel += 1) {
    peak = Math.max(peak, oversampledPeak(samples, frameCount, channelCount, channel, factor));
  }
  return dbfs(peak);
}

export function measurePcm(audio: PcmAudio, options: MeasureOptions = {}): AcxReport {
  const samples = audio.samples;
  // Keep malformed metadata from reaching frame loops (a NaN frame size would
  // never advance the loop) while still reporting the invalid value as a
  // failed sample-rate/channel check.
  const sampleRate = positiveIntegerOrZero(audio.sampleRate);
  const channels = positiveIntegerOrZero(audio.channels);
  const durationSeconds = sampleRate > 0 && channels > 0
    ? samples.length / channels / sampleRate
    : 0;
  const frameRms = frameRmsDbfs(samples, sampleRate, channels);
  const noiseFloor = detectNoiseFloor(samples, sampleRate, channels, frameRms);
  const roomTone = measureRoomTone(samples, sampleRate, channels, frameRms, noiseFloor);
  const samplePeak = samplePeakDbfs(samples);
  const truePeak = truePeakDbfs(samples, channels > 0 ? channels : 1);
  const format = audio.format ?? "unknown";
  const requireRoomTone = options.requireRoomTone !== false;

  const checks = {
    rms: rangeStatus(
      rmsDbfs(samples),
      ACX_SPEC.rms_dbfs.min,
      ACX_SPEC.rms_dbfs.max,
      0.5,
    ),
    true_peak: upperBoundStatus(truePeak, ACX_SPEC.true_peak_dbfs_max, 0.5),
    noise_floor: upperBoundStatus(noiseFloor, ACX_SPEC.noise_floor_dbfs_max, 0.5, true),
    sample_rate: sampleRate === ACX_SPEC.sample_rate ? "pass" : "fail",
    channels: (channels === 1 || channels === 2) && samples.length % channels === 0 ? "pass" : "fail",
    duration: durationSeconds <= ACX_SPEC.max_file_seconds ? "pass" : "fail",
    format: formatStatus(audio),
    head_room_tone: !requireRoomTone || (roomTone.head.seconds >= ACX_SPEC.room_tone_head_s.min &&
      roomTone.head.seconds <= ACX_SPEC.room_tone_head_s.max &&
      !roomTone.head.digitalSilence)
      ? "pass"
      : "fail",
    tail_room_tone: !requireRoomTone || (roomTone.tail.seconds >= ACX_SPEC.room_tone_tail_s.min &&
      roomTone.tail.seconds <= ACX_SPEC.room_tone_tail_s.max &&
      !roomTone.tail.digitalSilence)
      ? "pass"
      : "fail",
  } satisfies AcxReport["checks"];

  return {
    rms_dbfs: rmsDbfs(samples),
    true_peak_dbfs: truePeak,
    sample_peak_dbfs: samplePeak,
    noise_floor_dbfs: noiseFloor,
    sample_rate: sampleRate,
    channels,
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
  if (audio.format === undefined || audio.format === "unknown") {
    return "warn";
  }
  if (!("wav" === audio.format || "mp3" === audio.format || "flac" === audio.format || "m4a" === audio.format || "aiff" === audio.format)) {
    return "fail";
  }
  if (audio.format === "mp3" && (audio.bitrate_kbps === undefined || audio.vbr === undefined)) {
    return "warn";
  }
  if (audio.format === "mp3" && (audio.vbr === true || (audio.bitrate_kbps ?? Infinity) < ACX_SPEC.min_bitrate_cbr)) {
    return "fail";
  }
  // Bitrate and VBR rules are submission rules for MP3. A source WAV/FLAC
  // may have a low or absent codec bitrate and is still a known, measurable
  // input for the meter/master workflow.
  return "pass";
}

function rangeStatus(value: number, min: number, max: number, edge: number): CheckStatus {
  if (Number.isNaN(value)) {
    return "fail";
  }
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
  if (Number.isNaN(value)) {
    return "fail";
  }
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

function oversampledPeak(
  samples: Float32Array | number[],
  frameCount: number,
  stride: number,
  channel: number,
  factor: number,
): number {
  if (frameCount === 0) {
    return 0;
  }
  if (frameCount === 1) {
    return Math.abs(samples[channel]);
  }

  const radius = 16;
  const safeFactor = Math.min(16, Math.max(1, factor));
  const phaseFilters = Array.from({ length: safeFactor }, (_unused, phase) => {
    if (phase === 0) {
      return null;
    }
    const coefficients: number[] = [];
    let weight = 0;
    for (let sourceOffset = -radius + 1; sourceOffset <= radius; sourceOffset += 1) {
      const distance = phase / safeFactor - sourceOffset;
      const absoluteDistance = Math.abs(distance);
      const coefficient = absoluteDistance < radius
        ? sinc(distance) * raisedCosine(absoluteDistance / radius)
        : 0;
      coefficients.push(coefficient);
      weight += coefficient;
    }
    return { coefficients, weight };
  });

  let peak = 0;

  // Phase zero is exactly the stored sample; scanning it once also handles
  // the final sample without a special output-index branch.
  for (let frame = 0; frame < frameCount; frame += 1) {
    peak = Math.max(peak, Math.abs(samples[frame * stride + channel]));
  }

  for (let interval = 0; interval < frameCount - 1; interval += 1) {
    const edgeInterval = interval < radius - 1 || interval >= frameCount - radius - 1;
    for (let phase = 1; phase < safeFactor; phase += 1) {
      const filter = phaseFilters[phase];
      if (!filter) {
        continue;
      }
      let value = 0;
      if (edgeInterval) {
        // At the two short edges the window is clipped, so retain the exact
        // normalized calculation used by the reference implementation.
        const position = interval + phase / safeFactor;
        const center = Math.floor(position);
        let weight = 0;
        const first = Math.max(0, center - radius + 1);
        const last = Math.min(frameCount - 1, center + radius);
        for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
          const distance = position - sourceIndex;
          const absoluteDistance = Math.abs(distance);
          if (absoluteDistance >= radius) {
            continue;
          }
          const coefficient = sinc(distance) * raisedCosine(absoluteDistance / radius);
          value += samples[sourceIndex * stride + channel] * coefficient;
          weight += coefficient;
        }
        if (Math.abs(weight) > 1e-12) {
          value /= weight;
        }
      } else {
        const first = interval - radius + 1;
        const coefficients = filter.coefficients;
        for (let offset = 0; offset < coefficients.length; offset += 1) {
          value += samples[(first + offset) * stride + channel] * coefficients[offset];
        }
        if (Math.abs(filter.weight) > 1e-12) {
          value /= filter.weight;
        }
      }
      peak = Math.max(peak, Math.abs(value));
    }
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
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) {
    return [];
  }
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
    let quietest = Infinity;
    for (const [from, to] of candidates) {
      quietest = Math.min(quietest, rmsDbfs(sliceFrames(samples, sampleRate, channels, from, to)));
    }
    return quietest === Infinity ? rmsDbfs(samples) : quietest;
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
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) {
    return [];
  }
  const samplesPerFrame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS * Math.max(1, channels)));
  return Array.prototype.slice.call(samples, fromFrame * samplesPerFrame, toFrame * samplesPerFrame);
}

function isDigitalSilence(sample: number): boolean {
  return Math.abs(sample) <= DIGITAL_SILENCE_EPSILON;
}

function positiveIntegerOrZero(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}
