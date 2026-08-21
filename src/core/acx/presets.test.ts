import { describe, expect, it } from "vitest";
import { measurePcm, rmsDbfs } from "./measure";
import {
  ACX_PRESET,
  BUILTIN_PRESETS,
  EBU_R128_PRESET,
  emptyCustomPreset,
  normalizeCustomPresets,
  presetTargets,
  resolvePreset,
} from "./presets";

/**
 * Speech-like tone plus noise, padded with room tone at both ends, then scaled
 * so the whole file measures exactly the requested RMS. Deriving the amplitude
 * from the duty cycle by hand would land a couple of dB off and put the fixture
 * on the wrong side of the target window.
 */
function narrationFixture(targetRmsDbfs: number, seconds = 6, sampleRate = 44_100): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const samples = new Float32Array(frames);
  const roomToneFrames = Math.round(1.5 * sampleRate);
  let seed = 12_345;
  for (let index = 0; index < frames; index += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const noise = (seed / 2_147_483_648) * 2 - 1;
    const speaking = index >= roomToneFrames && index < frames - roomToneFrames;
    // Shaped around 200 Hz so the K-weighting has speech-range energy to act on.
    const tone = Math.sin((2 * Math.PI * 200 * index) / sampleRate);
    samples[index] = speaking ? 0.8 * tone + 0.2 * noise : 0.0003 * noise;
  }
  const gain = Math.pow(10, (targetRmsDbfs - rmsDbfs(samples)) / 20);
  for (let index = 0; index < frames; index += 1) {
    samples[index] *= gain;
  }
  return samples;
}

function narrationAudio(targetRmsDbfs: number) {
  return {
    samples: narrationFixture(targetRmsDbfs),
    sampleRate: 44_100,
    channels: 1,
    format: "wav" as const,
  };
}

describe("delivery target presets", () => {
  it("ships only targets whose numbers trace to a primary source", () => {
    expect(BUILTIN_PRESETS.map((preset) => preset.id)).toEqual(["acx", "ebu-r128"]);
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.source).not.toBe("");
    }
  });

  it("falls back to ACX for an unknown or missing id", () => {
    expect(resolvePreset(undefined).id).toBe("acx");
    expect(resolvePreset("not-a-preset").id).toBe("acx");
    expect(resolvePreset("ebu-r128").id).toBe("ebu-r128");
  });

  it("finds a custom preset ahead of the builtins", () => {
    const custom = { ...emptyCustomPreset("house", "House standard"), true_peak_dbfs_max: -6 };
    expect(resolvePreset("house", [custom]).true_peak_dbfs_max).toBe(-6);
  });

  it("drops malformed custom presets and refuses to shadow a builtin id", () => {
    const presets = normalizeCustomPresets([
      { id: "acx", label: "Fake ACX" },
      { id: "", label: "No id" },
      "nonsense",
      { id: "house", label: "House", rms_dbfs: { min: -20, max: -30 }, sample_rate: 44_100.5 },
    ]);
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe("house");
    // An inverted range and a fractional sample rate are unusable, not defaults.
    expect(presets[0].rms_dbfs).toBeNull();
    expect(presets[0].sample_rate).toBeNull();
  });

  it("describes unspecified limits as unspecified rather than as a target", () => {
    expect(presetTargets(ACX_PRESET).rms).toBe("−23.0 to −18.0 dBFS");
    expect(presetTargets(ACX_PRESET).loudness).toBe("Not specified");
    expect(presetTargets(EBU_R128_PRESET).loudness).toBe("−23.5 to −22.5 LUFS");
    expect(presetTargets(EBU_R128_PRESET).rms).toBe("Not specified");
    expect(presetTargets(EBU_R128_PRESET).head_room_tone).toBe("Not specified");
  });
});

describe("measuring against a preset", () => {
  it("reports integrated loudness whatever the target says", () => {
    const report = measurePcm(narrationAudio(-20));
    expect(report.lufs_integrated).toBeLessThan(0);
    expect(report.lufs_integrated).toBeGreaterThan(-40);
    expect(report.checks.loudness).toBe("unspecified");
    expect(report.preset_id).toBe("acx");
  });

  it("does not judge dimensions the target is silent about", () => {
    const report = measurePcm(narrationAudio(-20), { preset: EBU_R128_PRESET });
    expect(report.checks.rms).toBe("unspecified");
    expect(report.checks.sample_rate).toBe("unspecified");
    expect(report.checks.head_room_tone).toBe("unspecified");
    expect(report.checks.duration).toBe("unspecified");
    expect(report.checks.loudness).not.toBe("unspecified");
  });

  it("reaches opposite verdicts on the same audio under different targets", () => {
    // -20 dBFS RMS sits inside the ACX window but is far louder than R 128's
    // -23 LUFS, so the same file has to pass one target and fail the other.
    const audio = narrationAudio(-20);
    expect(measurePcm(audio).checks.rms).toBe("pass");
    expect(measurePcm(audio, { preset: EBU_R128_PRESET }).checks.loudness).toBe("fail");
    expect(measurePcm(audio, { preset: EBU_R128_PRESET }).traffic_light).toBe("red");
  });

  it("keeps a target with no limits at all from reporting a green pass", () => {
    const report = measurePcm(narrationAudio(-20), { preset: emptyCustomPreset("blank", "Blank") });
    // Channel count is the one thing every target implies, so it stays judged.
    expect(report.checks.channels).toBe("pass");
    expect(report.checks.rms).toBe("unspecified");
    expect(report.traffic_light).toBe("green");
  });
});
