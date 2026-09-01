import { describe, expect, it } from "vitest";
import { proofTimingPipeline } from "./pipeline";

describe("hybrid proof timing pipeline", () => {
  it("never reruns speech alignment for a Kosmos booth recording", () => {
    expect(proofTimingPipeline("live")).toBe("manuscript-clock");
  });

  it("uses forced word alignment for brought-in audio", () => {
    expect(proofTimingPipeline("take")).toBe("forced-alignment");
  });
});
