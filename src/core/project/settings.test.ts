import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_SETTINGS,
  normalizeProjectSettings,
  proofMergeWindowSeconds,
} from "./settings";

describe("project settings", () => {
  it("fills older projects with conservative local defaults", () => {
    expect(normalizeProjectSettings(undefined)).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it("clamps user-editable numeric boundaries", () => {
    expect(normalizeProjectSettings({
      pause_threshold_seconds: 100,
      acx_target_rms_dbfs: -40,
      teleprompter_font_size: 4,
    })).toMatchObject({
      pause_threshold_seconds: 12,
      acx_target_rms_dbfs: -23,
      teleprompter_font_size: 20,
    });
  });

  it("migrates the former teleprompter defaults once while preserving later choices", () => {
    expect(normalizeProjectSettings({ teleprompter_theme: "dark", teleprompter_font_size: 48 })).toMatchObject({
      teleprompter_theme: "cream",
      teleprompter_font_size: 28,
      teleprompter_preset_version: 2,
    });
    expect(normalizeProjectSettings({
      teleprompter_theme: "dark",
      teleprompter_font_size: 48,
      teleprompter_preset_version: 2,
    })).toMatchObject({
      teleprompter_theme: "dark",
      teleprompter_font_size: 48,
      teleprompter_preset_version: 2,
    });
  });

  it("defaults highlight granularity to line and keeps a valid choice", () => {
    expect(normalizeProjectSettings({})).toMatchObject({ teleprompter_highlight: "line" });
    expect(normalizeProjectSettings({ teleprompter_highlight: "word" }))
      .toMatchObject({ teleprompter_highlight: "word" });
    expect(normalizeProjectSettings({ teleprompter_highlight: "line" }))
      .toMatchObject({ teleprompter_highlight: "line" });
    expect(normalizeProjectSettings({ teleprompter_highlight: "paragraph" }))
      .toMatchObject({ teleprompter_highlight: "paragraph" });
    expect(normalizeProjectSettings({ teleprompter_highlight: "sentence" }))
      .toMatchObject({ teleprompter_highlight: "line" });
  });

  it("keeps one row per cleared word, however it was typed", () => {
    // Matching ignores case, so two spellings would be two rows that behave
    // as one and cannot be told apart in the settings list.
    expect(normalizeProjectSettings({
      suppressed_words: ["  Leominster ", "leominster", "LEOMINSTER", "", "   ", "Siobhan"],
    }).suppressed_words).toEqual(["Leominster", "Siobhan"]);
  });

  it("drops filter words nobody could have typed", () => {
    expect(normalizeProjectSettings({
      suppressed_words: [42, null, "x".repeat(81), "keep"],
    }).suppressed_words).toEqual(["keep"]);
  });

  it("keeps proof sensitivity separate from the live precision path", () => {
    expect(proofMergeWindowSeconds({ ...DEFAULT_PROJECT_SETTINGS, proof_sensitivity: "conservative" })).toBe(0.25);
    expect(proofMergeWindowSeconds({ ...DEFAULT_PROJECT_SETTINGS, proof_sensitivity: "aggressive" })).toBe(0.6);
  });
});
