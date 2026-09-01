import { describe, expect, it } from "vitest";
import { analyzeRoomTest } from "./room";

/** Zero-mean square wave at a given RMS so DC stripping does not wipe the fixture. */
function level(dbfs: number, seconds: number, sampleRate = 1000, dc = 0): Float32Array {
  const amplitude = 10 ** (dbfs / 20);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = dc + (index % 2 === 0 ? amplitude : -amplitude);
  }
  return samples;
}

describe("room test gain budget", () => {
  it("shows the boost arithmetic and passes a quiet room", () => {
    const result = analyzeRoomTest({
      samples: level(-65, 10),
      sampleRate: 1000,
      channels: 1,
      speechRmsDbfs: -24,
    });

    expect(result.durationSeconds).toBeCloseTo(10);
    expect(result.neededBoostDb).toBeCloseTo(4);
    expect(result.predictedFloorDbfs).toBeCloseTo(-61);
    expect(result.status).toBe("pass");
  });

  it("hard-fails a room whose floor would rise above ACX after gain", () => {
    const result = analyzeRoomTest({
      samples: level(-50, 12),
      sampleRate: 1000,
      channels: 1,
      speechRmsDbfs: -24,
    });

    expect(result.status).toBe("fail");
    expect(result.warning).toMatch(/too noisy/i);
  });

  it("warns when the recording is outside the intended 10–20 second window", () => {
    const result = analyzeRoomTest({
      samples: level(-70, 3),
      sampleRate: 1000,
      channels: 1,
    });

    expect(result.status).toBe("warn");
    expect(result.warning).toMatch(/10.*20/);
  });

  it("fails malformed room audio instead of treating NaN as a quiet floor", () => {
    const result = analyzeRoomTest({
      samples: Float32Array.from([0, Number.NaN, 0]),
      sampleRate: 1000,
      channels: 1,
    });
    expect(result.status).toBe("fail");
    expect(result.warning).toMatch(/invalid audio/i);
  });

  it("fails an empty or truncated multichannel recording", () => {
    expect(analyzeRoomTest({ samples: new Float32Array(0), sampleRate: 1000, channels: 1 }).status).toBe("fail");
    expect(analyzeRoomTest({ samples: new Float32Array([0, 0, 0]), sampleRate: 1000, channels: 2 }).status).toBe("fail");
  });

  it("ignores a DC bias that would otherwise pin the floor around −48 dBFS", () => {
    const result = analyzeRoomTest({
      samples: level(-70, 12, 1000, 0.004),
      sampleRate: 1000,
      channels: 1,
      speechRmsDbfs: -20,
    });
    expect(result.noiseFloorDbfs).toBeLessThan(-60);
    expect(result.status).toBe("pass");
  });

  it("does not let a click at the start become the noise floor", () => {
    const samples = level(-65, 12);
    for (let index = 0; index < 80; index += 1) {
      samples[index] = 0.4;
    }
    const result = analyzeRoomTest({
      samples,
      sampleRate: 1000,
      channels: 1,
      speechRmsDbfs: -20,
    });
    expect(result.status).toBe("pass");
    expect(result.noiseFloorDbfs).toBeCloseTo(-65, 0);
  });
});
