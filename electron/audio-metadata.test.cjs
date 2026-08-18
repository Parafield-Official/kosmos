const {
  audioDurationFromPcm,
  finitePositive,
  inferMp3Vbr,
  normalizeAudioFormat,
  normalizeProbeMetadata,
} = require("./audio-metadata.cjs");

describe("audio metadata boundary", () => {
  it("distinguishes padded CBR frames from varying VBR frames", () => {
    expect(inferMp3Vbr([626, 627, 627, 626], 192)).toBe(false);
    expect(inferMp3Vbr([104, 130, 313, 626, 104], 191)).toBe(true);
    expect(inferMp3Vbr([], 191.8)).toBe(false);
    expect(inferMp3Vbr([], 173)).toBe(true);
  });

  it("derives a fallback duration from decoded float PCM", () => {
    expect(audioDurationFromPcm(44_100 * 4 * 2, 2, 44_100)).toBe(1);
    expect(audioDurationFromPcm(100, Number.NaN, 44_100)).toBe(0);
    expect(finitePositive(Number.POSITIVE_INFINITY, 7)).toBe(7);
  });

  it("uses codec metadata and normalizes the .aif alias", () => {
    expect(normalizeAudioFormat(".aif")).toBe("aiff");
    expect(normalizeAudioFormat(".mp3", "pcm_s16le", "wav")).toBe("wav");
    expect(normalizeAudioFormat(".bin", "mp3", "data")).toBe("mp3");
  });

  it("requires finite, supported decoder metadata instead of inventing defaults", () => {
    expect(normalizeProbeMetadata(
      { channels: "2", sample_rate: "48000" },
      { duration: "12.5" },
    )).toEqual({ channels: 2, sampleRate: 48_000, duration: 12.5 });
    expect(normalizeProbeMetadata(
      { channels: "1", sample_rate: "44100", duration: null },
      { duration: "2" },
    ).duration).toBe(2);
    expect(normalizeProbeMetadata(
      { channels: "1", sample_rate: "44100", duration: "0" },
      { duration: "2" },
    ).duration).toBe(2);
    expect(() => normalizeProbeMetadata(
      { sample_rate: "44100" },
      { duration: "1" },
    )).toThrow(/channel/i);
    expect(() => normalizeProbeMetadata(
      { channels: "1", sample_rate: "not available" },
      { duration: "1" },
    )).toThrow(/sample rate/i);
    expect(() => normalizeProbeMetadata(
      { channels: "1", sample_rate: "44100" },
      {},
    )).toThrow(/duration/i);
    expect(() => normalizeProbeMetadata(
      { channels: "1", sample_rate: "44100", duration: "0" },
      {},
    )).toThrow(/positive duration/i);
    expect(() => normalizeProbeMetadata(
      { channels: "9", sample_rate: "44100" },
      { duration: "1" },
    )).toThrow(/channel/i);
  });
});
