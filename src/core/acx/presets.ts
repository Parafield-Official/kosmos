import { ACX_SPEC } from "./spec";

export interface Range {
  min: number;
  max: number;
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
