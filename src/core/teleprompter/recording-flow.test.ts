import { describe, expect, it } from "vitest";
import { recordedManuscriptCoverage, stoppedReadFlow } from "./recording-flow";

describe("stopped narrator read flow", () => {
  it("offers a simple start when no booth recording exists", () => {
    expect(stoppedReadFlow(false)).toEqual({
      primary: "start",
      primaryLabel: "Start narrating",
      canCheck: false,
      canStartOver: false,
      startOverRequiresConfirmation: false,
    });
  });

  it("makes continue primary and protects replacement when a recording exists", () => {
    expect(stoppedReadFlow(true)).toEqual({
      primary: "continue",
      primaryLabel: "Continue recording",
      canCheck: true,
      canStartOver: true,
      startOverRequiresConfirmation: true,
    });
  });

  it("reports how much of the manuscript has timed recorded audio", () => {
    const manuscript = "one two three four five six seven eight nine ten";
    const transcript = "one two three four".split(" ").map((text, index) => ({
      text,
      start: index * 0.4,
      end: index * 0.4 + 0.3,
    }));
    expect(recordedManuscriptCoverage(manuscript, transcript)).toBeCloseTo(0.4, 5);
    expect(recordedManuscriptCoverage(manuscript, [])).toBe(0);
    expect(recordedManuscriptCoverage("", transcript)).toBe(0);
  });
});
