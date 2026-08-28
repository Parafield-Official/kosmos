import { describe, expect, it } from "vitest";
import { analyzeRoomTest } from "./room";

describe("room test gain budget", () => {
  it("shows the boost arithmetic and passes a quiet room", () => {
    const result = analyzeRoomTest({
      samples: new Float32Array(10 * 1000).fill(10 ** (-65 / 20)),
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
      samples: new Float32Array(12 * 1000).fill(10 ** (-50 / 20)),
      sampleRate: 1000,
      channels: 1,
      speechRmsDbfs: -24,
    });

    expect(result.status).toBe("fail");
    expect(result.warning).toMatch(/too noisy/i);
  });

  it("warns when the recording is outside the intended 10–20 second window", () => {
    const result = analyzeRoomTest({
      samples: new Float32Array(3 * 1000).fill(10 ** (-70 / 20)),
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
});
