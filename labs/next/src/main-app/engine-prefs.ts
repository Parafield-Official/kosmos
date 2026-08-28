/**
 * App-wide proof and master knobs. Stored per-viewer in localStorage and
 * applied to every book — not cloned into each project.json.
 */

import type { PickupKind, ProofSensitivity } from "../../../../src/core/project/types";
import { DEFAULT_PROJECT_SETTINGS, proofMergeWindowSeconds } from "../../../../src/core/project/settings";

const PREFS_KEY = "kosmos-labs-engine-prefs";

export type ProofMarkKind = Extract<PickupKind, "sub" | "insert" | "skip" | "pause">;

export type EnginePrefs = {
  proof_sensitivity: ProofSensitivity;
  pause_threshold_seconds: number;
  proof_confidence_floor: number;
  acx_target_rms_dbfs: number;
  /** Which mismatch kinds to paint on the page and list in Review. */
  mark_kinds: ProofMarkKind[];
};

export const SENSITIVITY_OPTIONS: ReadonlyArray<{ value: ProofSensitivity; label: string; hint: string }> = [
  { value: "conservative", label: "Tight", hint: "Keep nearby mismatches as separate flags." },
  { value: "default", label: "Balanced", hint: "Group close mismatches without swallowing neighbours." },
  { value: "aggressive", label: "Merge nearby", hint: "Fold nearby mismatches into one flag." },
];

export const CONFIDENCE_OPTIONS: ReadonlyArray<{ value: number; label: string; hint: string }> = [
  { value: 0, label: "Every alert", hint: "Keep a flag even when the recogniser is guessing." },
  { value: 0.35, label: "Skip shakiest", hint: "Drop the least-certain flags. Recommended." },
  { value: 0.6, label: "Confident only", hint: "Keep flags only when the recogniser is sure." },
];

export const PAUSE_RANGE = { min: 2, max: 12, step: 0.5, fallback: 4 } as const;
export const RMS_RANGE = { min: -23, max: -18, step: 0.5, fallback: -20 } as const;

export const PROOF_MARK_OPTIONS: ReadonlyArray<{ value: ProofMarkKind; label: string; hint: string }> = [
  { value: "sub", label: "Misread", hint: "Wrong word on the tape." },
  { value: "insert", label: "Added", hint: "Extra sound that is not on the page, like um." },
  { value: "skip", label: "Missing", hint: "A word on the page that was not heard." },
  { value: "pause", label: "Long pause", hint: "A mid-sentence gap longer than the pause setting." },
];

const ALL_MARK_KINDS: ProofMarkKind[] = ["sub", "insert", "skip", "pause"];

const DEFAULT_PREFS: EnginePrefs = {
  proof_sensitivity: DEFAULT_PROJECT_SETTINGS.proof_sensitivity,
  pause_threshold_seconds: DEFAULT_PROJECT_SETTINGS.pause_threshold_seconds,
  proof_confidence_floor: DEFAULT_PROJECT_SETTINGS.proof_confidence_floor,
  acx_target_rms_dbfs: DEFAULT_PROJECT_SETTINGS.acx_target_rms_dbfs,
  mark_kinds: [...ALL_MARK_KINDS],
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function nearestStep(value: number, min: number, max: number, step: number, fallback: number): number {
  const clamped = clamp(value, min, max, fallback);
  const steps = Math.round((clamped - min) / step);
  return Number((min + steps * step).toFixed(2));
}

export function normalizeEnginePrefs(value: unknown): EnginePrefs {
  const candidate = value && typeof value === "object" ? (value as Partial<EnginePrefs>) : {};
  const sensitivity: ProofSensitivity =
    candidate.proof_sensitivity === "conservative" || candidate.proof_sensitivity === "aggressive"
      ? candidate.proof_sensitivity
      : "default";
  return {
    proof_sensitivity: sensitivity,
    pause_threshold_seconds: nearestStep(
      clamp(candidate.pause_threshold_seconds, PAUSE_RANGE.min, PAUSE_RANGE.max, PAUSE_RANGE.fallback),
      PAUSE_RANGE.min,
      PAUSE_RANGE.max,
      PAUSE_RANGE.step,
      PAUSE_RANGE.fallback,
    ),
    proof_confidence_floor: CONFIDENCE_OPTIONS.some(
      (option) => Math.abs(option.value - Number(candidate.proof_confidence_floor)) < 0.001,
    )
      ? Number(candidate.proof_confidence_floor)
      : DEFAULT_PREFS.proof_confidence_floor,
    acx_target_rms_dbfs: nearestStep(
      clamp(candidate.acx_target_rms_dbfs, RMS_RANGE.min, RMS_RANGE.max, RMS_RANGE.fallback),
      RMS_RANGE.min,
      RMS_RANGE.max,
      RMS_RANGE.step,
      RMS_RANGE.fallback,
    ),
    mark_kinds: normalizeMarkKinds(candidate.mark_kinds),
  };
}

function normalizeMarkKinds(value: unknown): ProofMarkKind[] {
  if (!Array.isArray(value)) {
    return [...ALL_MARK_KINDS];
  }
  const allowed = new Set<ProofMarkKind>(ALL_MARK_KINDS);
  const next = value.filter((item): item is ProofMarkKind => allowed.has(item as ProofMarkKind));
  return next.length > 0 ? [...new Set(next)] : [...ALL_MARK_KINDS];
}

export function markKindEnabled(kind: PickupKind): boolean {
  return readEnginePrefs().mark_kinds.includes(kind as ProofMarkKind);
}

export function readEnginePrefs(): EnginePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      return normalizeEnginePrefs(JSON.parse(raw) as unknown);
    }
  } catch {
    // Private windows or blocked storage: fall back to engine defaults.
  }
  return { ...DEFAULT_PREFS };
}

export function writeEnginePrefs(patch: Partial<EnginePrefs>): EnginePrefs {
  const next = normalizeEnginePrefs({ ...readEnginePrefs(), ...patch });
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Best effort; still return the session value.
  }
  return next;
}

/** Options `alignTranscript` actually consumes from these prefs. */
export function proofAlignOptions(): {
  mergeWindowSeconds: number;
  pauseThresholdSeconds: number;
  minConfidence: number;
} {
  const prefs = readEnginePrefs();
  return {
    mergeWindowSeconds: proofMergeWindowSeconds({
      ...DEFAULT_PROJECT_SETTINGS,
      proof_sensitivity: prefs.proof_sensitivity,
    }),
    pauseThresholdSeconds: prefs.pause_threshold_seconds,
    minConfidence: prefs.proof_confidence_floor,
  };
}
