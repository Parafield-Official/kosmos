export interface LiveInputQuality {
  sessionPeak: number;
  recentPeak: number;
  speechBlocks: number;
  ambientRms: number[];
  lastClipAt: number | null;
}

export type LiveInputQualityKind = "waiting" | "good" | "hot" | "clipping" | "low" | "noisy";

export interface LiveInputQualityDescription {
  kind: LiveInputQualityKind;
  label: string;
  detail: string;
  headroomDb: number | null;
  noiseFloorDb: number | null;
}

const CLIP_PEAK = 0.985;
const HOT_PEAK = 0.85;
const LOW_SESSION_PEAK = 0.12;
const SPEECH_RMS = 0.01;
const AMBIENT_CANDIDATE_MAX_RMS = 0.02;
const NOISY_AMBIENT_RMS = 0.008;
const MIN_AMBIENT_BLOCKS = 12;
const CLIP_HOLD_SECONDS = 4;

export function microphoneConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
}

export function createInputQuality(): LiveInputQuality {
  return {
    sessionPeak: 0,
    recentPeak: 0,
    speechBlocks: 0,
    ambientRms: [],
    lastClipAt: null,
  };
}

export function observeInputQuality(
  state: LiveInputQuality,
  observation: { rms: number; peak: number; atSeconds: number },
): LiveInputQuality {
  const rms = unitLevel(observation.rms);
  const peak = unitLevel(observation.peak);
  const atSeconds = Number.isFinite(observation.atSeconds) ? Math.max(0, observation.atSeconds) : 0;
  const ambientRms = rms > 0.00001 && rms <= AMBIENT_CANDIDATE_MAX_RMS
    ? [...state.ambientRms, rms].slice(-64)
    : state.ambientRms;
  return {
    sessionPeak: Math.max(state.sessionPeak, peak),
    recentPeak: peak,
    speechBlocks: state.speechBlocks + (rms >= SPEECH_RMS ? 1 : 0),
    ambientRms,
    lastClipAt: peak >= CLIP_PEAK ? atSeconds : state.lastClipAt,
  };
}

export function describeInputQuality(state: LiveInputQuality, atSeconds: number): LiveInputQualityDescription {
  const headroomDb = state.sessionPeak > 0 ? -20 * Math.log10(state.sessionPeak) : null;
  const ambient = state.ambientRms.length >= MIN_AMBIENT_BLOCKS
    ? percentile(state.ambientRms, 0.25)
    : null;
  const noiseFloorDb = ambient && ambient > 0 ? 20 * Math.log10(ambient) : null;
  const now = Number.isFinite(atSeconds) ? Math.max(0, atSeconds) : 0;
  if (state.lastClipAt !== null && now - state.lastClipAt <= CLIP_HOLD_SECONDS) {
    return { kind: "clipping", label: "Clipping", detail: "Lower the input gain.", headroomDb, noiseFloorDb };
  }
  if (ambient !== null && ambient >= NOISY_AMBIENT_RMS) {
    return { kind: "noisy", label: "Room may be noisy", detail: "Listen for fans or outside noise.", headroomDb, noiseFloorDb };
  }
  if (state.speechBlocks >= 8 && state.sessionPeak < LOW_SESSION_PEAK) {
    return { kind: "low", label: "Voice is low", detail: "Move closer or raise input gain.", headroomDb, noiseFloorDb };
  }
  if (state.recentPeak >= HOT_PEAK) {
    return { kind: "hot", label: "Level is hot", detail: "Leave a little more headroom.", headroomDb, noiseFloorDb };
  }
  if (state.sessionPeak >= LOW_SESSION_PEAK) {
    return { kind: "good", label: "Good level", detail: "Healthy recording headroom.", headroomDb, noiseFloorDb };
  }
  return { kind: "waiting", label: "Waiting for voice", detail: "The mic is ready.", headroomDb, noiseFloorDb };
}

function unitLevel(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.floor((ordered.length - 1) * fraction)));
  return ordered[index] ?? 0;
}
