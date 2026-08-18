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

  it("keeps proof sensitivity separate from the live precision path", () => {
    expect(proofMergeWindowSeconds({ ...DEFAULT_PROJECT_SETTINGS, proof_sensitivity: "conservative" })).toBe(0.25);
    expect(proofMergeWindowSeconds({ ...DEFAULT_PROJECT_SETTINGS, proof_sensitivity: "aggressive" })).toBe(0.6);
  });
});
