const {
  buildPunchPreview,
  canonicalEditedPath,
  normalizePunchBounds,
  rebuildPunchTimeline,
} = require("./punch.cjs");

describe("punch boundary validation", () => {
  it("clamps tiny decoder-duration overshoot without creating an append", () => {
    expect(normalizePunchBounds(1, 2.005, 2)).toEqual({ start: 1, end: 2 });
  });

  it("rejects a range that starts at or beyond the take end", () => {
    expect(() => normalizePunchBounds(2.001, 2.005, 2)).toThrow(/inside/i);
    expect(() => normalizePunchBounds(1.5, 1.4, 2)).toThrow(/inside/i);
  });
});

describe("canonical edited chapter", () => {
  it("uses one stable full-length edited file per chapter", () => {
    expect(canonicalEditedPath({ index: 3 })).toBe("audio/03_edited.wav");
    expect(canonicalEditedPath({ index: 27 })).toBe("audio/27_edited.wav");
  });

  it("replays every accepted pickup in manifest order from the untouched original", async () => {
    const original = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const before = new Float32Array(original);
    const replacements = new Map([
      ["first", Float32Array.from([20])],
      ["second", Float32Array.from([50, 51, 52])],
    ]);
    const observedLengths = [];

    const edited = await rebuildPunchTimeline({
      original,
      sampleRate: 1,
      punches: [
        { id: "first", t_start: 2, t_end: 4 },
        // These seconds belong to the timeline after the first pickup.
        { id: "second", t_start: 5, t_end: 7 },
      ],
      loadReplacement: async (punch) => replacements.get(punch.id),
      splicePunch: ({ original: current, replacement, startSeconds, endSeconds }) => {
        observedLengths.push(current.length);
        return Float32Array.from([
          ...current.slice(0, startSeconds),
          ...replacement,
          ...current.slice(endSeconds),
        ]);
      },
    });

    expect(original).toEqual(before);
    expect(observedLengths).toEqual([10, 9]);
    expect(Array.from(edited)).toEqual([0, 1, 20, 4, 5, 50, 51, 52, 8, 9]);
  });

  it("rejects a manifest entry outside the timeline produced so far", async () => {
    await expect(rebuildPunchTimeline({
      original: new Float32Array(4),
      sampleRate: 1,
      punches: [{ id: "bad", t_start: 4, t_end: 5 }],
      loadReplacement: async () => new Float32Array([1]),
      splicePunch: () => new Float32Array(),
    })).rejects.toThrow(/inside/i);
  });
});

describe("staged pickup preview", () => {
  it("compares the current and patched takes with the same surrounding context", () => {
    const current = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const before = new Float32Array(current);

    const preview = buildPunchPreview({
      current,
      replacement: Float32Array.from([40, 41, 42]),
      sampleRate: 1,
      startSeconds: 4,
      endSeconds: 6,
      contextSeconds: 2,
      splicePunch: ({ original, replacement, startSeconds, endSeconds }) => Float32Array.from([
        ...original.slice(0, startSeconds),
        ...replacement,
        ...original.slice(endSeconds),
      ]),
    });

    expect(current).toEqual(before);
    expect(Array.from(preview.currentContext)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(Array.from(preview.patchedContext)).toEqual([2, 3, 40, 41, 42, 6, 7]);
  });
});
