import type { ProjectSettings } from "./types";

export const DEFAULT_PROJECT_SETTINGS: Readonly<ProjectSettings> = Object.freeze({
  proof_sensitivity: "default",
  pause_threshold_seconds: 4,
  acx_target_rms_dbfs: -20,
  teleprompter_theme: "cream",
  teleprompter_font_size: 28,
  teleprompter_preset_version: 2,
});

/** Normalize optional/older project settings without rejecting the project. */
export function normalizeProjectSettings(value: unknown): ProjectSettings {
  const candidate = value && typeof value === "object"
    ? value as Partial<ProjectSettings>
    : {};
  const legacyTeleprompterDefaults = candidate.teleprompter_preset_version !== 2
    && candidate.teleprompter_theme === "dark"
    && Number(candidate.teleprompter_font_size) === 48;
  return {
    proof_sensitivity: candidate.proof_sensitivity === "conservative"
      || candidate.proof_sensitivity === "aggressive"
      ? candidate.proof_sensitivity
      : "default",
    pause_threshold_seconds: clampNumber(candidate.pause_threshold_seconds, 2, 12, 4),
    acx_target_rms_dbfs: clampNumber(candidate.acx_target_rms_dbfs, -23, -18, -20),
    teleprompter_theme: legacyTeleprompterDefaults
      ? "cream"
      : candidate.teleprompter_theme === "dark"
      || candidate.teleprompter_theme === "sepia"
      || candidate.teleprompter_theme === "cream"
      ? candidate.teleprompter_theme
      : "cream",
    teleprompter_font_size: legacyTeleprompterDefaults
      ? 28
      : Math.round(clampNumber(candidate.teleprompter_font_size, 20, 96, 28)),
    teleprompter_preset_version: 2,
  };
}

export function proofMergeWindowSeconds(settings: ProjectSettings): number {
  if (settings.proof_sensitivity === "conservative") {
    return 0.25;
  }
  if (settings.proof_sensitivity === "aggressive") {
    return 0.6;
  }
  return 0.4;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
