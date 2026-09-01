import { describe, expect, it } from "vitest";
import { decodeWavPcm16, encodeWavPcm16 } from "./wav";

describe("local WAV recorder codec", () => {
  it("round-trips mono PCM16 with a valid RIFF header", () => {
    const source = Float32Array.from([0, 0.25, -0.5, 1, -1]);
    const bytes = encodeWavPcm16(source, 44_100, 1);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    const decoded = decodeWavPcm16(bytes);
    expect(decoded.sampleRate).toBe(44_100);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.samples)).toEqual([
      0,
      expect.closeTo(0.25, 1 / 32_768),
      expect.closeTo(-0.5, 1 / 32_768),
      expect.closeTo(1, 1 / 32_768),
      expect.closeTo(-1, 1 / 32_768),
    ]);
  });

  it("rejects unsupported WAV encodings instead of guessing", () => {
    const bytes = encodeWavPcm16(Float32Array.from([0, 0]), 44_100, 1);
    bytes[34] = 24;
    expect(() => decodeWavPcm16(bytes)).toThrow(/16-bit PCM/i);
  });

  it("rejects empty recordings instead of treating them as valid takes", () => {
    expect(() => encodeWavPcm16(new Float32Array(0), 44_100, 1)).toThrow(/empty/i);
    const bytes = new Uint8Array(44);
    const view = new DataView(bytes.buffer);
    new TextEncoder().encodeInto("RIFF", bytes);
    new TextEncoder().encodeInto("WAVE", bytes.subarray(8));
    new TextEncoder().encodeInto("fmt ", bytes.subarray(12));
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44_100, true);
    view.setUint32(28, 88_200, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    new TextEncoder().encodeInto("data", bytes.subarray(36));
    expect(() => decodeWavPcm16(bytes)).toThrow(/empty/i);
  });

  it("rejects a data chunk whose length is not a complete PCM frame", () => {
    const bytes = encodeWavPcm16(Float32Array.from([0, 0]), 44_100, 1);
    new DataView(bytes.buffer).setUint32(40, 3, true);

    expect(() => decodeWavPcm16(bytes)).toThrow(/truncated|frame|aligned|data/i);
  });

  it("rejects truncated chunks instead of silently decoding the available prefix", () => {
    const bytes = encodeWavPcm16(Float32Array.from([0, 0]), 44_100, 1);
    new DataView(bytes.buffer).setUint32(40, 1000, true);

    expect(() => decodeWavPcm16(bytes)).toThrow(/truncated|data/i);
  });
});
