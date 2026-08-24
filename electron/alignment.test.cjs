const { normalizeAlignment } = require("./alignment.cjs");

describe("alignment persistence boundary", () => {
  it("keeps the audio source that owns the timing map", () => {
    expect(normalizeAlignment({
      source_kind: "live",
      transcript: [],
      pickups: [],
    }, "ch01").source_kind).toBe("live");
    expect(() => normalizeAlignment({
      source_kind: "mystery",
      transcript: [],
      pickups: [],
    }, "ch01")).toThrow(/source/i);
  });

  it("persists which engine produced the word clock", () => {
    expect(normalizeAlignment({
      source_kind: "take",
      timing_engine: "whisperx",
      transcript: [],
      pickups: [],
    }, "ch01").timing_engine).toBe("whisperx");
    expect(() => normalizeAlignment({
      source_kind: "take",
      timing_engine: "unknown",
      transcript: [],
      pickups: [],
    }, "ch01")).toThrow(/timing engine/i);
  });

  it("clamps malformed confidence without changing valid workflow data", () => {
    const result = normalizeAlignment({
      schema: 1,
      transcript: [{ text: "one", start: 0, end: 0.5, confidence: Number.NaN }],
      pickups: [{
        id: "pickup-1",
        chapter_id: "ch01",
        t_start: 0,
        t_end: 0.5,
        expected: "one",
        heard: "two",
        kind: "sub",
        seat: "narration",
        status: "open",
        confidence: Number.POSITIVE_INFINITY,
      }],
    }, "ch01");
    expect(result.transcript[0].confidence).toBe(0);
    expect(result.pickups[0].confidence).toBe(0);
  });

  it("rejects a pickup assigned to another chapter or an impossible time range", () => {
    const pickup = {
      id: "pickup-1",
      chapter_id: "ch02",
      t_start: 2,
      t_end: 1,
      expected: "one",
      heard: "two",
      kind: "sub",
      seat: "narration",
      status: "open",
      confidence: 1,
    };
    expect(() => normalizeAlignment({ transcript: [], pickups: [pickup] }, "ch01"))
      .toThrow(/chapter|timing/i);
  });

  it("rejects an unknown alignment schema", () => {
    expect(() => normalizeAlignment({ schema: 9, transcript: [], pickups: [] }, "ch01"))
      .toThrow(/schema/i);
  });

  it("rejects transcript timestamps that move backward", () => {
    expect(() => normalizeAlignment({
      transcript: [
        { text: "one", start: 2, end: 3 },
        { text: "two", start: 1, end: 1.5 },
      ],
      pickups: [],
    }, "ch01")).toThrow(/out of order/i);
  });
});
