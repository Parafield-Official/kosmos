import type { ProjectSettings } from "./types";

export const DEFAULT_PROJECT_SETTINGS: Readonly<ProjectSettings> = Object.freeze({
  proof_sensitivity: "default",
  pause_threshold_seconds: 4,
  acx_target_rms_dbfs: -20,
  spec_preset_id: "acx",
  proof_confidence_floor: 0.35,
  suppressed_words: [],
  teleprompter_theme: "cream",
  teleprompter_font_size: 28,
  teleprompter_highlight: "word",
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
    spec_preset_id: typeof candidate.spec_preset_id === "string" && candidate.spec_preset_id.trim() !== ""
      ? candidate.spec_preset_id.trim()
      : "acx",
    proof_confidence_floor: clampNumber(candidate.proof_confidence_floor, 0, 0.9, 0.35),
    suppressed_words: normalizeWordList(candidate.suppressed_words),
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
    teleprompter_highlight: candidate.teleprompter_highlight === "line"
      || candidate.teleprompter_highlight === "paragraph"
      ? candidate.teleprompter_highlight
      : "word",
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

/** A filter list has to survive a hand-edited project.json. */
/**
 * The words a narrator has cleared for the whole book. Matching ignores case,
 * so two spellings of one word would be two rows that behave as one; keep the
 * first spelling a person typed and drop the rest.
 */
function normalizeWordList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of value) {
    const word = typeof entry === "string" ? entry.trim() : "";
    const key = word.toLocaleLowerCase("en-US");
    if (word !== "" && word.length <= 80 && !seen.has(key)) {
      seen.set(key, word);
    }
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
