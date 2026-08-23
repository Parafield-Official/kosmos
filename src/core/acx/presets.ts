import { ACX_SPEC } from "./spec";

export interface Range {
  min: number;
  max: number;
}

export type DeliveryContainer = "mp3" | "wav";
export type LevelStandard = "rms" | "lufs";

/**
 * The file Kosmos writes for a measurement preset.
 *
 * A spec and a container are separate facts. EBU R 128, for example, defines
 * programme loudness and true peak but deliberately does not mandate WAV,
 * sample rate, or channel count. Kosmos therefore pairs it with a documented
 * production-master default instead of quietly reusing ACX's MP3 recipe.
 */
export interface DeliveryProfile {
  targetId: string;
  targetLabel: string;
  folderName: string;
  container: DeliveryContainer;
  extension: DeliveryContainer;
  sampleRate: number;
  channels: 1;
  bitrateKbps?: number;
  pcmBitDepth?: 24;
  level: { standard: LevelStandard; target: number } | null;
  limiterCeilingDbfs: number;
  noiseFloorMaxDbfs: number | null;
  headSeconds: number;
  tailSeconds: number;
  includeCreditSlots: boolean;
  includeRetailSample: boolean;
  description: string;
}

/**
 * A delivery target. Every limit is optional: a null limit means the target says
 * nothing about that dimension, and the meter reports it without judging it.
 * That distinction matters, because a preset that silently passed an unspecified
 * dimension would read as "verified" when nothing was verified.
 */
export interface SpecPreset {
  id: string;
  label: string;
  /** Where the numbers come from, reproduced in the exported report. */
  source: string;
  builtin: boolean;
  rms_dbfs: Range | null;
  lufs: Range | null;
  true_peak_dbfs_max: number | null;
  noise_floor_dbfs_max: number | null;
  sample_rate: number | null;
  min_bitrate_cbr: number | null;
  vbr_allowed: boolean;
  max_file_seconds: number | null;
  room_tone_head_s: Range | null;
  room_tone_tail_s: Range | null;
}

export const ACX_PRESET: SpecPreset = {
  id: "acx",
  label: "ACX / Audible",
  source: `acx_spec.json (${ACX_SPEC.version}), from ACX audio submission requirements`,
  builtin: true,
  rms_dbfs: { min: ACX_SPEC.rms_dbfs.min, max: ACX_SPEC.rms_dbfs.max },
  // ACX states its loudness window in dBFS RMS and publishes no LUFS figure,
  // so we measure LUFS but do not invent a pass/fail band for it.
  lufs: null,
  true_peak_dbfs_max: ACX_SPEC.true_peak_dbfs_max,
  noise_floor_dbfs_max: ACX_SPEC.noise_floor_dbfs_max,
  sample_rate: ACX_SPEC.sample_rate,
  min_bitrate_cbr: ACX_SPEC.min_bitrate_cbr,
  vbr_allowed: ACX_SPEC.vbr_allowed,
  max_file_seconds: ACX_SPEC.max_file_seconds,
  room_tone_head_s: { min: ACX_SPEC.room_tone_head_s.min, max: ACX_SPEC.room_tone_head_s.max },
  room_tone_tail_s: { min: ACX_SPEC.room_tone_tail_s.min, max: ACX_SPEC.room_tone_tail_s.max },
};

/**
 * EBU R 128: -23.0 LUFS with a ±0.5 LU tolerance and a -1 dBTP ceiling. It
 * constrains loudness and peak only, so the room-tone, format, and sample-rate
 * rows stay unjudged under it.
 */
export const EBU_R128_PRESET: SpecPreset = {
  id: "ebu-r128",
  label: "EBU R 128",
  source: "EBU R 128: -23.0 LUFS ±0.5 LU, maximum -1 dBTP",
  builtin: true,
  rms_dbfs: null,
  lufs: { min: -23.5, max: -22.5 },
  true_peak_dbfs_max: -1,
  noise_floor_dbfs_max: null,
  sample_rate: null,
  min_bitrate_cbr: null,
  vbr_allowed: true,
  max_file_seconds: null,
  room_tone_head_s: null,
  room_tone_tail_s: null,
};

/**
 * Only targets whose numbers we can trace to a primary source ship as builtins.
 * Findaway/Spotify and Author's Republic publish theirs behind a login or a
 * dead link, and their figures are widely misquoted second-hand, so those go in
 * as custom presets typed from the distributor's own sheet rather than as
 * builtins we guessed at.
 */
export const BUILTIN_PRESETS: readonly SpecPreset[] = Object.freeze([ACX_PRESET, EBU_R128_PRESET]);

/**
 * Turn a judgement preset into an actual file recipe.
 *
 * Custom presets that specify a CBR bitrate produce MP3; presets without an
 * encoded-audio requirement produce a 24-bit WAV master. This gives a custom
 * target a useful export without inventing a distributor requirement.
 */
export function deliveryProfile(preset: SpecPreset): DeliveryProfile {
  if (preset.id === ACX_PRESET.id) {
    return {
      targetId: preset.id,
      targetLabel: preset.label,
      folderName: "acx",
      container: "mp3",
      extension: "mp3",
      sampleRate: ACX_SPEC.sample_rate,
      channels: 1,
      bitrateKbps: ACX_SPEC.min_bitrate_cbr,
      level: { standard: "rms", target: ACX_SPEC.rms_dbfs.target },
      limiterCeilingDbfs: ACX_SPEC.true_peak_limiter_ceiling,
      noiseFloorMaxDbfs: ACX_SPEC.noise_floor_dbfs_max,
      headSeconds: ACX_SPEC.room_tone_head_s.target,
      tailSeconds: ACX_SPEC.room_tone_tail_s.target,
      includeCreditSlots: true,
      includeRetailSample: true,
      description: "44.1 kHz mono, 192 kbps CBR MP3, with ACX room tone and retail sample.",
    };
  }

  if (preset.id === EBU_R128_PRESET.id) {
    return {
      targetId: preset.id,
      targetLabel: preset.label,
      folderName: "ebu-r128",
      container: "wav",
      extension: "wav",
      sampleRate: 48_000,
      channels: 1,
      pcmBitDepth: 24,
      level: { standard: "lufs", target: -23 },
      limiterCeilingDbfs: -1.2,
      noiseFloorMaxDbfs: null,
      headSeconds: 0,
      tailSeconds: 0,
      includeCreditSlots: false,
      includeRetailSample: false,
      description: "48 kHz, 24-bit mono WAV production master at −23 LUFS. EBU R 128 itself does not mandate a container.",
    };
  }

  const encoded = preset.min_bitrate_cbr !== null;
  const level = preset.lufs
    ? { standard: "lufs" as const, target: midpoint(preset.lufs) }
    : preset.rms_dbfs
      ? { standard: "rms" as const, target: midpoint(preset.rms_dbfs) }
      : null;
  const sampleRate = preset.sample_rate ?? (encoded ? 44_100 : 48_000);
  const bitrateKbps = encoded ? Math.max(64, preset.min_bitrate_cbr ?? 192) : undefined;
  return {
    targetId: preset.id,
    targetLabel: preset.label,
    folderName: safeFolderName(preset.id),
    container: encoded ? "mp3" : "wav",
    extension: encoded ? "mp3" : "wav",
    sampleRate,
    channels: 1,
    bitrateKbps,
    pcmBitDepth: encoded ? undefined : 24,
    level,
    limiterCeilingDbfs: preset.true_peak_dbfs_max === null
      ? -1
      : preset.true_peak_dbfs_max - 0.2,
    noiseFloorMaxDbfs: preset.noise_floor_dbfs_max,
    headSeconds: midpoint(preset.room_tone_head_s),
    tailSeconds: midpoint(preset.room_tone_tail_s),
    includeCreditSlots: false,
    includeRetailSample: false,
    description: encoded
      ? `${(sampleRate / 1000).toFixed(1)} kHz mono, ${bitrateKbps} kbps CBR MP3.`
      : `${(sampleRate / 1000).toFixed(1)} kHz, 24-bit mono WAV master.`,
  };
}

export function resolvePreset(id: string | undefined, custom: SpecPreset[] = []): SpecPreset {
  if (!id) {
    return ACX_PRESET;
  }
  return custom.find((preset) => preset.id === id)
    ?? BUILTIN_PRESETS.find((preset) => preset.id === id)
    ?? ACX_PRESET;
}

/** A blank custom preset that judges nothing until the user fills it in. */
export function emptyCustomPreset(id: string, label: string): SpecPreset {
  return {
    id,
    label,
    source: "Entered by hand",
    builtin: false,
    rms_dbfs: null,
    lufs: null,
    true_peak_dbfs_max: null,
    noise_floor_dbfs_max: null,
    sample_rate: null,
    min_bitrate_cbr: null,
    vbr_allowed: true,
    max_file_seconds: null,
    room_tone_head_s: null,
    room_tone_tail_s: null,
  };
}

/** Accept custom presets out of project.json without trusting their shape. */
export function normalizeCustomPresets(value: unknown): SpecPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>(BUILTIN_PRESETS.map((preset) => preset.id));
  const presets: SpecPreset[] = [];
  for (const entry of value) {
    const preset = normalizeCustomPreset(entry);
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id);
      presets.push(preset);
    }
  }
  return presets;
}

function normalizeCustomPreset(value: unknown): SpecPreset | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (id === "") {
    return null;
  }
  const label = typeof candidate.label === "string" && candidate.label.trim() !== ""
    ? candidate.label.trim()
    : id;
  return {
    id,
    label,
    source: typeof candidate.source === "string" && candidate.source.trim() !== ""
      ? candidate.source.trim()
      : "Entered by hand",
    builtin: false,
    rms_dbfs: range(candidate.rms_dbfs),
    lufs: range(candidate.lufs),
    true_peak_dbfs_max: finiteOrNull(candidate.true_peak_dbfs_max),
    noise_floor_dbfs_max: finiteOrNull(candidate.noise_floor_dbfs_max),
    sample_rate: positiveIntegerOrNull(candidate.sample_rate),
    min_bitrate_cbr: positiveIntegerOrNull(candidate.min_bitrate_cbr),
    vbr_allowed: candidate.vbr_allowed !== false,
    max_file_seconds: positiveFiniteOrNull(candidate.max_file_seconds),
    room_tone_head_s: range(candidate.room_tone_head_s),
    room_tone_tail_s: range(candidate.room_tone_tail_s),
  };
}

/** Display text for each row of the meter, so switching presets retargets it. */
export function presetTargets(preset: SpecPreset): Record<string, string> {
  return {
    rms: preset.rms_dbfs ? `${formatDb(preset.rms_dbfs.min)} to ${formatDb(preset.rms_dbfs.max)} dBFS` : "Not specified",
    loudness: preset.lufs ? `${formatDb(preset.lufs.min)} to ${formatDb(preset.lufs.max)} LUFS` : "Not specified",
    true_peak: preset.true_peak_dbfs_max === null ? "Not specified" : `≤ ${formatDb(preset.true_peak_dbfs_max)} dBTP`,
    noise_floor: preset.noise_floor_dbfs_max === null ? "Not specified" : `≤ ${formatDb(preset.noise_floor_dbfs_max)} dBFS RMS`,
    sample_rate: preset.sample_rate === null ? "Not specified" : `${(preset.sample_rate / 1000).toFixed(1)} kHz`,
    channels: "Mono or stereo",
    format: preset.min_bitrate_cbr === null
      ? "Supported audio file"
      : `≥ ${preset.min_bitrate_cbr} kbps${preset.vbr_allowed ? "" : " CBR"}`,
    duration: preset.max_file_seconds === null ? "Not specified" : `≤ ${Math.round(preset.max_file_seconds / 60)} min`,
    head_room_tone: rangeText(preset.room_tone_head_s),
    tail_room_tone: rangeText(preset.room_tone_tail_s),
  };
}

function rangeText(value: Range | null): string {
  return value ? `${value.min.toFixed(1)}–${value.max.toFixed(1)} s` : "Not specified";
}

function midpoint(value: Range | null): number {
  return value ? (value.min + value.max) / 2 : 0;
}

function safeFolderName(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "delivery";
}

/** Minus signs, so a target reads the same as the measured value beside it. */
function formatDb(value: number): string {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
}

function range(value: unknown): Range | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const min = finiteOrNull(candidate.min);
  const max = finiteOrNull(candidate.max);
  if (min === null || max === null || min > max) {
    return null;
  }
  return { min, max };
}

function finiteOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveFiniteOrNull(value: unknown): number | null {
  const number = finiteOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = finiteOrNull(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}
