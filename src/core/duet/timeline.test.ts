import { describe, expect, it } from "vitest";
import { buildDuetTimeline } from "./timeline";

describe("duet script timeline", () => {
  it("maps styled seat spans onto the nearest word timestamps", () => {
    const segments = buildDuetTimeline(
      [
        { text: "one ", seat: "N1", style: [] },
        { text: "two three", seat: "N2", style: ["bold"] },
      ],
      [
        { text: "one", start: 0.1, end: 0.4 },
        { text: "two", start: 0.5, end: 0.8 },
        { text: "three", start: 0.9, end: 1.2 },
      ],
      1.5,
    );

    expect(segments).toEqual([
      { start: 0.1, end: 0.4, seat: "N1" },
      { start: 0.5, end: 1.2, seat: "N2" },
    ]);
  });

  it("falls back to a deterministic duration split when alignment is absent", () => {
    const segments = buildDuetTimeline(
      [
        { text: "one ", seat: "N1", style: [] },
        { text: "two", seat: "N2", style: [] },
      ],
      [],
      4,
    );

    expect(segments).toEqual([
      { start: 0, end: 2, seat: "N1" },
      { start: 2, end: 4, seat: "N2" },
    ]);
  });

  it("uses proportional timing when Whisper words have no usable duration", () => {
    expect(buildDuetTimeline(
      [
        { text: "one ", seat: "N1", style: [] },
        { text: "two", seat: "N2", style: [] },
      ],
      [
        { text: "one", start: 0, end: 0 },
        { text: "two", start: 0, end: 0 },
      ],
      4,
    )).toEqual([
      { start: 0, end: 2, seat: "N1" },
      { start: 2, end: 4, seat: "N2" },
    ]);
  });

  it("returns no timeline for a non-finite chapter duration", () => {
    expect(buildDuetTimeline(
      [{ text: "one", seat: "N1", style: [] }],
      [],
      Number.NaN,
    )).toEqual([]);
  });
});
