import { describe, expect, it } from "vitest";
import {
  createInputQuality,
  describeInputQuality,
  microphoneConstraints,
  observeInputQuality,
} from "./input-quality";

describe("booth microphone input", () => {
  it("requests an unprocessed mono studio signal from the selected device", () => {
    expect(microphoneConstraints("mic-2")).toEqual({
      deviceId: { exact: "mic-2" },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    });
    expect(microphoneConstraints("").deviceId).toBeUndefined();
  });

  it("reports useful headroom after hearing a healthy voice", () => {
    let quality = createInputQuality();
    for (let index = 0; index < 12; index += 1) {
      quality = observeInputQuality(quality, { rms: 0.003, peak: 0.012, atSeconds: index * 0.16 });
    }
    quality = observeInputQuality(quality, { rms: 0.09, peak: 0.5, atSeconds: 2 });
    expect(describeInputQuality(quality, 2)).toMatchObject({
      kind: "good",
      label: "Good level",
      headroomDb: expect.closeTo(6.02, 1),
    });
  });

  it("holds a clipping warning long enough for the narrator to notice", () => {
    let quality = createInputQuality();
    quality = observeInputQuality(quality, { rms: 0.4, peak: 0.999, atSeconds: 4 });
    expect(describeInputQuality(quality, 6).kind).toBe("clipping");
    expect(describeInputQuality(quality, 9).kind).not.toBe("clipping");
  });

  it("warns about a noisy pause and a consistently low voice", () => {
    let noisy = createInputQuality();
    for (let index = 0; index < 16; index += 1) {
      noisy = observeInputQuality(noisy, { rms: 0.012, peak: 0.025, atSeconds: index * 0.16 });
    }
    noisy = observeInputQuality(noisy, { rms: 0.08, peak: 0.4, atSeconds: 3 });
    expect(describeInputQuality(noisy, 3).kind).toBe("noisy");

    let low = createInputQuality();
    for (let index = 0; index < 10; index += 1) {
      low = observeInputQuality(low, { rms: 0.015, peak: 0.06, atSeconds: index * 0.16 });
    }
    expect(describeInputQuality(low, 2).kind).toBe("low");
  });
});
