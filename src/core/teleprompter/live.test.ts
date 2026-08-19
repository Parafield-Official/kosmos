import { describe, expect, it } from "vitest";
import { dropUnstableLiveTail, liveBackFlag, liveFlagChipCopy, liveFlagRequiresClick, liveVoiceStatusCopy, liveWordMark, matchLiveWindow, mergeLivePickup, parseParakeetLiveLine, pcmHasSpeech, pickupFromLiveFlag, LIVE_STREAM_HOP_SECONDS, type LiveExpectedWord, type LiveMismatch } from "./live";

const expected: LiveExpectedWord[] = [
  { index: 0, lineIndex: 0, text: "The" },
  { index: 1, lineIndex: 0, text: "fox" },
  { index: 2, lineIndex: 0, text: "jumped" },
  { index: 3, lineIndex: 0, text: "in" },
  { index: 4, lineIndex: 0, text: "the" },
];

describe("teleprompter live matching", () => {
  it("advances only forward and ignores repeated rolling-window words", () => {
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    const second = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
        { text: "jumped", start: 0.6, end: 0.9, confidence: 0.98 },
      ],
      state: first.state,
      flagsEnabled: true,
    });

    expect(first.state).toMatchObject({ cursor: 2, lastHeardEnd: 0.5 });
    expect(second.state).toMatchObject({ cursor: 3, lastHeardEnd: 0.9 });
    expect(second.flag).toBeUndefined();
  });

  it("emits a high-confidence full-word mismatch but hides low-confidence guesses", () => {
    const low = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hop", start: 0, end: 0.3, confidence: 0.89 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(low.flag).toBeUndefined();
    expect(low.state.cursor).toBe(2);

    const high = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: low.state,
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(high.flag).toMatchObject({ expected: "jumped", heard: "hopped", expectedIndex: 2 });
    expect(high.state.cursor).toBe(3);
  });

  it("keeps following a close mispronunciation without pinning the narrator", () => {
    const ramparts: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "The" },
      { index: 1, lineIndex: 0, text: "ramparts" },
      { index: 2, lineIndex: 0, text: "were" },
    ];
    const result = matchLiveWindow({
      chapterId: "ch01",
      expected: ramparts,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "rampars", start: 0.3, end: 0.7, confidence: 0.96 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    expect(result.state.cursor).toBe(2);
    expect(result.flag).toBeUndefined();
  });

  it("never emits a dismissed line again", () => {
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    const repeated = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "hopped", start: 0.1, end: 0.4, confidence: 0.96 }],
      state: { cursor: 2, lastHeardEnd: 0 },
      flagsEnabled: true,
      dismissedIds: [first.flag!.id],
    });
    expect(repeated.flag).toBeUndefined();
  });

  it("resynchronizes when narration starts after a skipped heading", () => {
    const headingAndBody: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "Leaflets" },
      { index: 1, lineIndex: 1, text: "At" },
      { index: 2, lineIndex: 1, text: "dusk" },
      { index: 3, lineIndex: 1, text: "they" },
      { index: 4, lineIndex: 1, text: "pour" },
    ];

    const result = matchLiveWindow({
      chapterId: "ch01",
      expected: headingAndBody,
      transcript: [
        { text: "At", start: 0, end: 0.2, confidence: 0.97 },
        { text: "dusk", start: 0.2, end: 0.5, confidence: 0.98 },
        { text: "they", start: 0.5, end: 0.8, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });

    expect(result.state.cursor).toBe(4);
    expect(result.flag).toBeUndefined();
  });

  it("rejoins after Whisper misses a word in the middle of a line", () => {
    const result = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "jumped", start: 0.3, end: 0.6, confidence: 0.98 },
        { text: "in", start: 0.7, end: 0.9, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });

    expect(result.state.cursor).toBe(4);
    expect(result.flag).toBeUndefined();
  });

  it("does not walk the script when Whisper hallucinates Music or BLANK AUDIO", () => {
    const music = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "Music", start: 0, end: 0.4, confidence: 0.99 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    expect(music.state.cursor).toBe(0);
    expect(music.flag).toBeUndefined();

    const blank = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "BL", start: 0, end: 0.1, confidence: 0.99 },
        { text: "ANK", start: 0.1, end: 0.2, confidence: 0.99 },
        { text: "AUD", start: 0.2, end: 0.3, confidence: 0.99 },
        { text: "IO", start: 0.3, end: 0.4, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    expect(blank.state.cursor).toBe(0);
    expect(blank.flag).toBeUndefined();
  });

  it("does not resync on a lone common or 4-letter word from a one-word window", () => {
    const lonelyThe = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "the", start: 0.2, end: 0.4, confidence: 0.97 }],
      state: { cursor: 1, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    expect(lonelyThe.state.cursor).toBe(1);

    const headingAndBody: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "Leaflets" },
      { index: 1, lineIndex: 1, text: "At" },
      { index: 2, lineIndex: 1, text: "dusk" },
      { index: 3, lineIndex: 1, text: "they" },
    ];
    const lonelyDusk = matchLiveWindow({
      chapterId: "ch01",
      expected: headingAndBody,
      transcript: [{ text: "dusk", start: 0.2, end: 0.5, confidence: 0.98 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    expect(lonelyDusk.state.cursor).toBe(0);
  });

  it("does not rematch an overlapped copy of a word already consumed", () => {
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "The", start: 0, end: 0.2, confidence: 0.98 },
        { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
    });
    const overlapped = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [
        { text: "fox", start: 0.55, end: 0.8, confidence: 0.98 },
        { text: "jumped", start: 0.9, end: 1.2, confidence: 0.98 },
      ],
      state: first.state,
      flagsEnabled: true,
    });
    expect(overlapped.state.cursor).toBe(3);
  });
});

describe("live follow helpers", () => {
  it("treats near-silence as no speech and a spoken window as speech", () => {
    expect(pcmHasSpeech(new Float32Array(1600))).toBe(false);
    const spoken = new Float32Array(1600);
    for (let index = 0; index < spoken.length; index += 1) {
      spoken[index] = index % 2 === 0 ? 0.08 : -0.08;
    }
    expect(pcmHasSpeech(spoken)).toBe(true);
  });

  it("keeps status copy short and off the Whisper brand", () => {
    const listening = liveVoiceStatusCopy({
      status: "listening",
      enabled: true,
      dimmed: false,
      error: null,
      heardText: "BL ANK AUD IO",
    });
    expect(listening.title).toBe("Listening");
    expect(listening.detail).toBe("");
    expect(`${listening.title} ${listening.detail}`).not.toMatch(/whisper/i);
    expect(listening.title.split(" ").length).toBeLessThanOrEqual(2);

    const checking = liveVoiceStatusCopy({
      status: "processing",
      enabled: true,
      dimmed: false,
      error: null,
      heardText: "the fox jumped in the yard today",
    });
    expect(checking.title).toBe("Checking");
    expect(checking.detail).toBe("yard today");
    expect(checking.detail.split(" ").length).toBeLessThanOrEqual(2);
  });

  it("drops only the unfinished tail of a live window", () => {
    const words = [
      { text: "The", start: 0.1, end: 0.25, confidence: 0.98 },
      { text: "fox", start: 0.3, end: 0.5, confidence: 0.98 },
      { text: "jumped", start: 1.35, end: 1.55, confidence: 0.91 },
    ];
    expect(dropUnstableLiveTail(words, 1.6).map((word) => word.text)).toEqual(["The", "fox"]);
    expect(dropUnstableLiveTail(words.slice(0, 2), 0.5).map((word) => word.text)).toEqual(["The", "fox"]);
  });
});

describe("live flag chrome", () => {
  it("marks the expected word on the page without a banner title", () => {
    expect(liveWordMark(2, 2, 2)).toEqual({ follow: true, flag: true });
    expect(liveWordMark(3, 2, 2)).toEqual({ follow: false, flag: false });
    expect(liveWordMark(2, 2, null)).toEqual({ follow: true, flag: false });
    expect(liveWordMark(2, -1, 2)).toEqual({ follow: false, flag: true });
    expect(liveFlagChipCopy({ expected: "jumped", heard: "hopped" })).toBe("jumped → hopped");
    expect(liveFlagChipCopy({ expected: "jumped", heard: "hopped" })).not.toMatch(/check this line/i);
  });

  it("files a Review pickup from a live flag without waiting for Keep", () => {
    const flag: LiveMismatch = {
      id: "live-ch1-4-hopped",
      expected: "jumped",
      heard: "hopped",
      expectedIndex: 4,
      lineIndex: 0,
      start: 12.4,
      end: 12.9,
      confidence: 0.96,
    };
    const pickup = pickupFromLiveFlag(flag, "ch1");
    expect(pickup).toMatchObject({
      id: flag.id,
      chapter_id: "ch1",
      expected: "jumped",
      heard: "hopped",
      kind: "sub",
      status: "open",
      t_start: 12.4,
      t_end: 12.9,
    });
    expect(liveFlagRequiresClick()).toBe(false);
    expect(mergeLivePickup([], pickup)).toEqual([pickup]);
    expect(mergeLivePickup([pickup], pickup)).toEqual([pickup]);
  });
});

describe("parakeet live stream lines", () => {
  it("reads finalized words from a C-API stream hop and ignores empty hops", () => {
    expect(LIVE_STREAM_HOP_SECONDS).toBe(0.16);
    expect(parseParakeetLiveLine("{\"text\":\"\",\"words\":[]}")).toEqual([]);
    expect(parseParakeetLiveLine("{\"text\":\" i don't\",\"words\":[{\"w\":\"well\",\"start\":0.8,\"end\":0.88,\"conf\":0.95},{\"w\":\"i\",\"start\":0.96,\"end\":1.04,\"conf\":0.99}]}")).toEqual([
      { text: "well", start: 0.8, end: 0.88, confidence: 0.95 },
      { text: "i", start: 0.96, end: 1.04, confidence: 0.99 },
    ]);
    expect(parseParakeetLiveLine("not-json")).toEqual([]);
  });

  it("lets Whisper flag a swap without moving the gold cursor", () => {
    const state = { cursor: 2, lastHeardEnd: 0 };
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected,
      transcript: [{ text: "hopped", start: 1, end: 1.3, confidence: 0.96 }],
      state,
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(flag).toMatchObject({ expected: "jumped", heard: "hopped", expectedIndex: 2 });
    expect(state.cursor).toBe(2);
  });
});
