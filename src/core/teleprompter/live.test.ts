import { describe, expect, it } from "vitest";
import { appendLiveQcSamples, createLiveQcBuffer, drainLiveQcBuffer, dropUnstableLiveTail, liveBackFlag, liveFlagChipCopy, liveFlagRequiresClick, liveRequestStatus, liveVoiceStatusCopy, liveWordMark, matchLiveWindow, mergeLivePickup, parseParakeetLiveLine, pcmHasSpeech, pickupFromLiveFlag, LIVE_STREAM_HOP_SECONDS, type LiveExpectedWord, type LiveMismatch } from "./live";

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

  it("resynchronizes a skipped heading when Parakeet delivers one word per hop", () => {
    const headingAndBody: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "Leaflets" },
      { index: 1, lineIndex: 1, text: "At" },
      { index: 2, lineIndex: 1, text: "dusk" },
      { index: 3, lineIndex: 1, text: "they" },
      { index: 4, lineIndex: 1, text: "pour" },
    ];
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected: headingAndBody,
      transcript: [{ text: "At", start: 0.1, end: 0.2, confidence: 0.98 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    const second = matchLiveWindow({
      chapterId: "ch01",
      expected: headingAndBody,
      transcript: [{ text: "dusk", start: 0.25, end: 0.45, confidence: 0.98 }],
      state: first.state,
      flagsEnabled: false,
    });

    expect(first.state.cursor).toBe(2);
    expect(second.state.cursor).toBe(3);
  });

  it("moves gold on a one-word stream hop that lands 1-3 words ahead", () => {
    const next = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "fox", start: 0.3, end: 0.5, confidence: 0.97 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    const twoAhead = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "jumped", start: 0.6, end: 0.9, confidence: 0.97 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: false,
    });

    expect(next.state.cursor).toBe(2);
    expect(twoAhead.state.cursor).toBe(3);
    expect(next.flag).toBeUndefined();
    expect(twoAhead.flag).toBeUndefined();
  });

  it("does not jump a lonely the three words ahead", () => {
    const result = matchLiveWindow({
      chapterId: "ch01",
      expected,
      transcript: [{ text: "the", start: 0.8, end: 1.0, confidence: 0.99 }],
      state: { cursor: 1, lastHeardEnd: 0 },
      flagsEnabled: false,
    });

    expect(result.state.cursor).toBe(1);
    expect(result.flag).toBeUndefined();
  });

  it("resynchronizes when the narrator repeats the next manuscript word", () => {
    const passage: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "rampars" },
      { index: 1, lineIndex: 0, text: "turn" },
      { index: 2, lineIndex: 0, text: "cartwheels" },
    ];
    const first = matchLiveWindow({
      chapterId: "ch01",
      expected: passage,
      transcript: [{ text: "turn", start: 0.1, end: 0.3, confidence: 0.98 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    const repeated = matchLiveWindow({
      chapterId: "ch01",
      expected: passage,
      transcript: [{ text: "turn", start: 0.6, end: 0.8, confidence: 0.98 }],
      state: first.state,
      flagsEnabled: false,
    });

    expect(first.state.cursor).toBe(2);
    expect(repeated.state.cursor).toBe(2);
  });

  it("rejoins immediately on a distinctive word after Parakeet hears a mistake", () => {
    const passage: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "houses" },
      { index: 1, lineIndex: 0, text: "Entire" },
      { index: 2, lineIndex: 0, text: "streets" },
      { index: 3, lineIndex: 0, text: "swirl" },
      { index: 4, lineIndex: 0, text: "with" },
      { index: 5, lineIndex: 0, text: "them" },
      { index: 6, lineIndex: 0, text: "flashing" },
      { index: 7, lineIndex: 0, text: "white" },
      { index: 8, lineIndex: 0, text: "against" },
    ];
    const mistaken = matchLiveWindow({
      chapterId: "ch01",
      expected: passage,
      transcript: [{ text: "ashing", start: 0.1, end: 0.35, confidence: 0.98 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    const rejoined = matchLiveWindow({
      chapterId: "ch01",
      expected: passage,
      transcript: [{ text: "white", start: 0.4, end: 0.62, confidence: 0.98 }],
      state: mistaken.state,
      flagsEnabled: false,
    });

    expect(rejoined.state.cursor).toBe(8);
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
  it("keeps the visible status stable during streaming hops", () => {
    expect(liveRequestStatus(true)).toBe("listening");
    expect(liveRequestStatus(false)).toBe("processing");
  });

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

    const followOnly = liveVoiceStatusCopy({
      status: "listening",
      enabled: true,
      dimmed: true,
      error: "Word checks paused after false alarms.",
      heardText: "",
    });
    expect(followOnly.title).toBe("Following");
    expect(followOnly.detail).toMatch(/voice follow is still running/i);
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
    const state = { cursor: 2, lastHeardEnd: 12.4 };
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
    expect(state.lastHeardEnd).toBe(12.4);
  });

  it("anchors a delayed Whisper result to the nearby manuscript word", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "Depart" },
        { index: 1, lineIndex: 0, text: "immediately" },
        { index: 2, lineIndex: 0, text: "to" },
        { index: 3, lineIndex: 0, text: "open" },
        { index: 4, lineIndex: 0, text: "country" },
        { index: 5, lineIndex: 0, text: "The" },
        { index: 6, lineIndex: 0, text: "tide" },
      ],
      transcript: [
        { text: "countries", start: 0.1, end: 0.34, confidence: 0.99 },
        { text: "the", start: 0.4, end: 0.52, confidence: 0.98 },
        { text: "tide", start: 0.55, end: 0.72, confidence: 0.98 },
      ],
      state: { cursor: 1, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "country",
      heard: "countries",
      expectedIndex: 4,
    });
  });

  it("aligns the screenshot mistake to flashing instead of the stale houses checkpoint", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "houses" },
        { index: 1, lineIndex: 0, text: "Entire" },
        { index: 2, lineIndex: 0, text: "streets" },
        { index: 3, lineIndex: 0, text: "swirl" },
        { index: 4, lineIndex: 0, text: "with" },
        { index: 5, lineIndex: 0, text: "them" },
        { index: 6, lineIndex: 0, text: "flashing" },
        { index: 7, lineIndex: 0, text: "white" },
        { index: 8, lineIndex: 0, text: "against" },
        { index: 9, lineIndex: 0, text: "the" },
        { index: 10, lineIndex: 0, text: "cob" },
        { index: 11, lineIndex: 0, text: "bles" },
      ],
      transcript: [
        { text: "ashing", start: 0.1, end: 0.35, confidence: 0.99 },
        { text: "white", start: 0.4, end: 0.62, confidence: 0.99 },
        { text: "against", start: 0.66, end: 0.96, confidence: 0.99 },
        { text: "the", start: 1, end: 1.1, confidence: 0.99 },
        { text: "cob", start: 1.14, end: 1.35, confidence: 0.99 },
        { text: "bles", start: 1.36, end: 1.58, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "flashing",
      heard: "ashing",
      expectedIndex: 6,
    });
  });

  it("uses phrase alignment when Whisper omits words before a substitution", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "houses" },
        { index: 1, lineIndex: 0, text: "Entire" },
        { index: 2, lineIndex: 0, text: "streets" },
        { index: 3, lineIndex: 0, text: "swirl" },
        { index: 4, lineIndex: 0, text: "with" },
        { index: 5, lineIndex: 0, text: "them" },
        { index: 6, lineIndex: 0, text: "flashing" },
        { index: 7, lineIndex: 0, text: "white" },
        { index: 8, lineIndex: 0, text: "against" },
      ],
      transcript: [
        { text: "houses", start: 0.1, end: 0.3, confidence: 0.99 },
        { text: "Entire", start: 0.32, end: 0.56, confidence: 0.99 },
        { text: "streets", start: 0.58, end: 0.8, confidence: 0.99 },
        { text: "ashing", start: 0.84, end: 1.08, confidence: 0.99 },
        { text: "white", start: 1.1, end: 1.3, confidence: 0.99 },
        { text: "against", start: 1.34, end: 1.6, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "flashing",
      heard: "ashing",
      expectedIndex: 6,
    });
  });

  it("flags an anchored short-word change outside the small homophone list", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "The" },
        { index: 1, lineIndex: 0, text: "narrator" },
        { index: 2, lineIndex: 0, text: "was" },
        { index: 3, lineIndex: 0, text: "ready" },
      ],
      transcript: [
        { text: "narrator", start: 0.1, end: 0.44, confidence: 0.99 },
        { text: "is", start: 0.46, end: 0.55, confidence: 0.99 },
        { text: "ready", start: 0.58, end: 0.82, confidence: 0.99 },
      ],
      state: { cursor: 1, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "was",
      heard: "is",
      expectedIndex: 2,
    });
  });

  it("lets Whisper flag a high-confidence function-word swap such as on to in", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "The" },
        { index: 1, lineIndex: 0, text: "fox" },
        { index: 2, lineIndex: 0, text: "jumped" },
        { index: 3, lineIndex: 0, text: "on" },
        { index: 4, lineIndex: 0, text: "the" },
        { index: 5, lineIndex: 0, text: "mat" },
      ],
      transcript: [
        { text: "the", start: 0.01, end: 0.08, confidence: 0.57 },
        { text: "fox", start: 0.18, end: 0.32, confidence: 0.77 },
        { text: "jumped", start: 0.32, end: 0.65, confidence: 0.998 },
        { text: "in", start: 0.65, end: 0.68, confidence: 0.995 },
        { text: "the", start: 0.78, end: 0.92, confidence: 0.997 },
        { text: "mat", start: 0.92, end: 1.08, confidence: 0.996 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "on",
      heard: "in",
      expectedIndex: 3,
    });
  });

  it("flags a to → on swap in a real manuscript phrase", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "Urgent" },
        { index: 1, lineIndex: 0, text: "message" },
        { index: 2, lineIndex: 0, text: "to" },
        { index: 3, lineIndex: 0, text: "the" },
        { index: 4, lineIndex: 0, text: "inhabitants" },
        { index: 5, lineIndex: 0, text: "of" },
        { index: 6, lineIndex: 0, text: "this" },
        { index: 7, lineIndex: 0, text: "town" },
      ],
      transcript: [
        { text: "Urgent", start: 0.0, end: 0.3, confidence: 0.99 },
        { text: "message", start: 0.3, end: 0.6, confidence: 0.99 },
        { text: "on", start: 0.6, end: 0.75, confidence: 0.91 },
        { text: "the", start: 0.75, end: 0.85, confidence: 0.99 },
        { text: "inhabitants", start: 0.85, end: 1.4, confidence: 0.99 },
        { text: "of", start: 1.4, end: 1.5, confidence: 0.99 },
        { text: "this", start: 1.5, end: 1.7, confidence: 0.99 },
        { text: "town", start: 1.7, end: 2.0, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({
      expected: "to",
      heard: "on",
      expectedIndex: 2,
    });
  });

  it("does not flag a Whisper word-piece as a narrator swap", () => {
    const fragment = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "them" },
        { index: 1, lineIndex: 0, text: "flashing" },
        { index: 2, lineIndex: 0, text: "white" },
      ],
      transcript: [
        { text: "them", start: 0, end: 0.2, confidence: 0.99 },
        { text: "hing", start: 0.2, end: 0.5, confidence: 0.99 },
        { text: "white", start: 0.5, end: 0.8, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(fragment).toBeUndefined();

    const suffix = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "turn" },
        { index: 1, lineIndex: 0, text: "cartwheels" },
        { index: 2, lineIndex: 0, text: "over" },
      ],
      transcript: [
        { text: "turn", start: 0, end: 0.2, confidence: 0.99 },
        { text: "els", start: 0.2, end: 0.45, confidence: 0.99 },
        { text: "over", start: 0.45, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(suffix).toBeUndefined();
  });

  it("still flags a clipped or misspelled content word", () => {
    const clipped = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "turn" },
        { index: 1, lineIndex: 0, text: "cartwheels" },
        { index: 2, lineIndex: 0, text: "over" },
      ],
      transcript: [
        { text: "turn", start: 0, end: 0.2, confidence: 0.99 },
        { text: "cartwheel", start: 0.2, end: 0.7, confidence: 0.99 },
        { text: "over", start: 0.7, end: 0.9, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(clipped).toMatchObject({ expected: "cartwheels", heard: "cartwheel", expectedIndex: 1 });

    const misspelled = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "the" },
        { index: 1, lineIndex: 0, text: "inhabitants" },
        { index: 2, lineIndex: 0, text: "of" },
      ],
      transcript: [
        { text: "the", start: 0, end: 0.15, confidence: 0.99 },
        { text: "inhibitants", start: 0.15, end: 0.8, confidence: 0.99 },
        { text: "of", start: 0.8, end: 0.95, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(misspelled).toMatchObject({ expected: "inhabitants", heard: "inhibitants", expectedIndex: 1 });
  });

  it("does not let a near-spelling manuscript variant hide a later pickup", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "rampars" },
        { index: 1, lineIndex: 0, text: "turn" },
        { index: 2, lineIndex: 0, text: "cartwheels" },
        { index: 3, lineIndex: 0, text: "over" },
      ],
      transcript: [
        { text: "rampers", start: 0, end: 0.3, confidence: 0.99 },
        { text: "turn", start: 0.3, end: 0.5, confidence: 0.99 },
        { text: "cartwheel", start: 0.5, end: 0.9, confidence: 0.99 },
        { text: "over", start: 0.9, end: 1.1, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 4,
      confidenceThreshold: 0.9,
    });

    expect(flag).toMatchObject({ expected: "cartwheels", heard: "cartwheel", expectedIndex: 2 });
  });

  it("flags the narrator slips people actually make mid-sentence", () => {
    const thisTown = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "of" },
        { index: 1, lineIndex: 0, text: "this" },
        { index: 2, lineIndex: 0, text: "town" },
      ],
      transcript: [
        { text: "of", start: 0, end: 0.15, confidence: 0.99 },
        { text: "the", start: 0.15, end: 0.28, confidence: 0.94 },
        { text: "town", start: 0.28, end: 0.55, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(thisTown).toMatchObject({ expected: "this", heard: "the", expectedIndex: 1 });

    const climb = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "The" },
        { index: 1, lineIndex: 0, text: "tide" },
        { index: 2, lineIndex: 0, text: "climbs" },
      ],
      transcript: [
        { text: "The", start: 0, end: 0.15, confidence: 0.99 },
        { text: "tide", start: 0.15, end: 0.4, confidence: 0.99 },
        { text: "climb", start: 0.4, end: 0.7, confidence: 0.97 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(climb).toMatchObject({ expected: "climbs", heard: "climb", expectedIndex: 2 });

    const rooftop = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "over" },
        { index: 1, lineIndex: 0, text: "rooftops" },
      ],
      transcript: [
        { text: "over", start: 0, end: 0.2, confidence: 0.99 },
        { text: "rooftop", start: 0.2, end: 0.6, confidence: 0.98 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(rooftop).toMatchObject({ expected: "rooftops", heard: "rooftop", expectedIndex: 1 });

    const east = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "to" },
        { index: 1, lineIndex: 0, text: "the" },
        { index: 2, lineIndex: 0, text: "east" },
      ],
      transcript: [
        { text: "to", start: 0, end: 0.12, confidence: 0.99 },
        { text: "the", start: 0.12, end: 0.22, confidence: 0.99 },
        { text: "west", start: 0.22, end: 0.5, confidence: 0.96 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(east).toMatchObject({ expected: "east", heard: "west", expectedIndex: 2 });

    const hotel = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "beachfront" },
        { index: 1, lineIndex: 0, text: "hotels" },
        { index: 2, lineIndex: 0, text: "to" },
      ],
      transcript: [
        { text: "beachfront", start: 0, end: 0.45, confidence: 0.99 },
        { text: "hotel", start: 0.45, end: 0.75, confidence: 0.97 },
        { text: "to", start: 0.75, end: 0.9, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(hotel).toMatchObject({ expected: "hotels", heard: "hotel", expectedIndex: 1 });
  });

  it("flags determiner, preposition, and inflection slips on unseen book text", () => {
    const theseThe = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "open" },
        { index: 1, lineIndex: 0, text: "these" },
        { index: 2, lineIndex: 0, text: "gates" },
      ],
      transcript: [
        { text: "open", start: 0, end: 0.25, confidence: 0.99 },
        { text: "the", start: 0.25, end: 0.38, confidence: 0.93 },
        { text: "gates", start: 0.38, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(theseThe).toMatchObject({ expected: "these", heard: "the", expectedIndex: 1 });

    const atOn = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "stood" },
        { index: 1, lineIndex: 0, text: "at" },
        { index: 2, lineIndex: 0, text: "dawn" },
      ],
      transcript: [
        { text: "stood", start: 0, end: 0.3, confidence: 0.99 },
        { text: "on", start: 0.3, end: 0.42, confidence: 0.94 },
        { text: "dawn", start: 0.42, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(atOn).toMatchObject({ expected: "at", heard: "on", expectedIndex: 1 });

    const walks = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "she" },
        { index: 1, lineIndex: 0, text: "walks" },
        { index: 2, lineIndex: 0, text: "home" },
      ],
      transcript: [
        { text: "she", start: 0, end: 0.2, confidence: 0.99 },
        { text: "walk", start: 0.2, end: 0.45, confidence: 0.97 },
        { text: "home", start: 0.45, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(walks).toMatchObject({ expected: "walks", heard: "walk", expectedIndex: 1 });

    const north = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "facing" },
        { index: 1, lineIndex: 0, text: "north" },
        { index: 2, lineIndex: 0, text: "now" },
      ],
      transcript: [
        { text: "facing", start: 0, end: 0.35, confidence: 0.99 },
        { text: "south", start: 0.35, end: 0.65, confidence: 0.96 },
        { text: "now", start: 0.65, end: 0.85, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(north).toMatchObject({ expected: "north", heard: "south", expectedIndex: 1 });
  });

  it("flags any real English swap, including short pronouns and verbs", () => {
    const himHer = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "told" },
        { index: 1, lineIndex: 0, text: "him" },
        { index: 2, lineIndex: 0, text: "later" },
      ],
      transcript: [
        { text: "told", start: 0, end: 0.25, confidence: 0.99 },
        { text: "her", start: 0.25, end: 0.4, confidence: 0.94 },
        { text: "later", start: 0.4, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(himHer).toMatchObject({ expected: "him", heard: "her", expectedIndex: 1 });

    const wasIs = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "she" },
        { index: 1, lineIndex: 0, text: "was" },
        { index: 2, lineIndex: 0, text: "ready" },
      ],
      transcript: [
        { text: "she", start: 0, end: 0.2, confidence: 0.99 },
        { text: "is", start: 0.2, end: 0.32, confidence: 0.93 },
        { text: "ready", start: 0.32, end: 0.6, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(wasIs).toMatchObject({ expected: "was", heard: "is", expectedIndex: 1 });

    const thereThe = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "wait" },
        { index: 1, lineIndex: 0, text: "there" },
        { index: 2, lineIndex: 0, text: "now" },
      ],
      transcript: [
        { text: "wait", start: 0, end: 0.2, confidence: 0.99 },
        { text: "the", start: 0.2, end: 0.35, confidence: 0.94 },
        { text: "now", start: 0.35, end: 0.55, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });
    expect(thereThe).toMatchObject({ expected: "there", heard: "the", expectedIndex: 1 });
  });

  it("does not turn an uncertain short Whisper word into a pickup", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [{ index: 0, lineIndex: 0, text: "on" }],
      transcript: [{ text: "in", start: 0.1, end: 0.2, confidence: 0.94 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toBeUndefined();
  });

  it("does not turn a hallucinated you into a substitution for the manuscript", () => {
    const expected = [
      { index: 0, lineIndex: 0, text: "the" },
      { index: 1, lineIndex: 0, text: "cartwheels" },
      { index: 2, lineIndex: 0, text: "rampars" },
    ];
    for (const cursor of [0, 1, 2]) {
      const flag = liveBackFlag({
        chapterId: "ch1",
        expected,
        transcript: [{ text: "you", start: 0.1, end: 0.25, confidence: 0.99 }],
        state: { cursor, lastHeardEnd: 0 },
        flagsEnabled: true,
        confidenceThreshold: 0.9,
      });

      expect(flag).toBeUndefined();
    }
  });

  it("does not flag an unanchored first-word guess before a skipped heading resyncs", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "Leaflets" },
        { index: 1, lineIndex: 1, text: "At" },
        { index: 2, lineIndex: 1, text: "dusk" },
      ],
      transcript: [{ text: "watching", start: 0.1, end: 0.5, confidence: 0.99 }],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      confidenceThreshold: 0.9,
    });

    expect(flag).toBeUndefined();
  });

  it("does not let Whisper flag a word gold has not reached yet", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "They" },
        { index: 1, lineIndex: 0, text: "cross" },
        { index: 2, lineIndex: 0, text: "the" },
        { index: 3, lineIndex: 0, text: "Channel" },
        { index: 4, lineIndex: 0, text: "at" },
        { index: 5, lineIndex: 0, text: "midnight" },
      ],
      transcript: [
        { text: "They", start: 0, end: 0.2, confidence: 0.99 },
        { text: "cross", start: 0.2, end: 0.4, confidence: 0.99 },
        { text: "the", start: 0.4, end: 0.5, confidence: 0.99 },
        { text: "Channel", start: 0.5, end: 0.8, confidence: 0.99 },
        { text: "in", start: 0.8, end: 0.95, confidence: 0.94 },
        { text: "midnight", start: 0.95, end: 1.3, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 4,
      confidenceThreshold: 0.9,
    });
    expect(flag).toBeUndefined();
  });

  it("flags the slip only after gold has left that word", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "They" },
        { index: 1, lineIndex: 0, text: "cross" },
        { index: 2, lineIndex: 0, text: "the" },
        { index: 3, lineIndex: 0, text: "Channel" },
        { index: 4, lineIndex: 0, text: "at" },
        { index: 5, lineIndex: 0, text: "midnight" },
      ],
      transcript: [
        { text: "They", start: 0, end: 0.2, confidence: 0.99 },
        { text: "cross", start: 0.2, end: 0.4, confidence: 0.99 },
        { text: "the", start: 0.4, end: 0.5, confidence: 0.99 },
        { text: "Channel", start: 0.5, end: 0.8, confidence: 0.99 },
        { text: "in", start: 0.8, end: 0.95, confidence: 0.94 },
        { text: "midnight", start: 0.95, end: 1.3, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 6,
      confidenceThreshold: 0.9,
    });
    expect(flag).toMatchObject({ expected: "at", heard: "in", expectedIndex: 4 });
  });

  it("does not let Whisper hunt a later page word ahead of gold", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "They" },
        { index: 1, lineIndex: 0, text: "cross" },
        { index: 2, lineIndex: 0, text: "countless" },
        { index: 3, lineIndex: 0, text: "chevrons" },
        { index: 4, lineIndex: 0, text: "of" },
        { index: 5, lineIndex: 0, text: "whitecaps" },
      ],
      transcript: [
        { text: "They", start: 0, end: 0.2, confidence: 0.99 },
        { text: "cross", start: 0.2, end: 0.45, confidence: 0.99 },
        { text: "the", start: 0.45, end: 0.6, confidence: 0.99 },
        { text: "Channel", start: 0.6, end: 0.95, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 2,
      confidenceThreshold: 0.9,
    });
    expect(flag).toBeUndefined();
  });

  it("does not pair a leftover you with hotels gold already passed", () => {
    const flag = liveBackFlag({
      chapterId: "ch1",
      expected: [
        { index: 0, lineIndex: 0, text: "shops" },
        { index: 1, lineIndex: 0, text: "and" },
        { index: 2, lineIndex: 0, text: "hotels" },
        { index: 3, lineIndex: 0, text: "within" },
        { index: 4, lineIndex: 0, text: "its" },
        { index: 5, lineIndex: 0, text: "walls" },
      ],
      transcript: [
        { text: "shops", start: 0, end: 0.25, confidence: 0.99 },
        { text: "and", start: 0.25, end: 0.35, confidence: 0.99 },
        { text: "hotels", start: 0.35, end: 0.6, confidence: 0.99 },
        { text: "within", start: 0.6, end: 0.8, confidence: 0.99 },
        { text: "its", start: 0.8, end: 0.95, confidence: 0.99 },
        { text: "walls", start: 0.95, end: 1.2, confidence: 0.99 },
        { text: "you", start: 1.2, end: 1.35, confidence: 0.99 },
      ],
      state: { cursor: 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 6,
      confidenceThreshold: 0.9,
    });
    expect(flag).toBeUndefined();
  });
});

describe("background Whisper QC buffering", () => {
  it("holds the phrase until gold has left it, then hands Whisper that span", () => {
    let buffer = createLiveQcBuffer();
    for (let hop = 0; hop < 4; hop += 1) {
      buffer = appendLiveQcSamples(
        buffer,
        new Float32Array([hop + 0.1, hop + 0.2]),
        34 + hop,
        hop * 0.16,
      );
    }

    expect(drainLiveQcBuffer(buffer, 16_000, false, 37).window).toBeUndefined();

    const drained = drainLiveQcBuffer(buffer, 16_000, false, 42);
    expect(drained.window).toMatchObject({ cursor: 34, startSeconds: 0 });
    expect(Array.from(drained.window?.samples ?? []).map((sample) => Number(sample.toFixed(2)))).toEqual([
      0.1, 0.2, 1.1, 1.2, 2.1, 2.2, 3.1, 3.2,
    ]);
    expect(drained.buffer.sampleCount).toBe(0);
  });

  it("keeps the next phrase in the buffer after gold leaves the first", () => {
    let buffer = createLiveQcBuffer();
    buffer = appendLiveQcSamples(buffer, new Float32Array([0.1, 0.2]), 34, 0);
    buffer = appendLiveQcSamples(buffer, new Float32Array([0.3, 0.4]), 41, 1.1);
    buffer = appendLiveQcSamples(buffer, new Float32Array([0.5, 0.6]), 42, 1.3);

    const drained = drainLiveQcBuffer(buffer, 16_000, false, 42);
    expect(drained.window?.cursor).toBe(34);
    expect(Array.from(drained.window?.samples ?? []).map((sample) => Number(sample.toFixed(2)))).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(drained.buffer.cursor).toBe(42);
    expect(Array.from(drained.buffer.chunks[0]?.samples ?? []).map((sample) => Number(sample.toFixed(2)))).toEqual([0.5, 0.6]);
  });

  it("keeps a short final window until stop forces a background check", () => {
    const buffer = appendLiveQcSamples(
      createLiveQcBuffer(),
      new Float32Array([0.1, 0.2, 0.3]),
      4,
      1.25,
    );

    expect(drainLiveQcBuffer(buffer, 16_000, false, 6).window).toBeUndefined();
    const final = drainLiveQcBuffer(buffer, 16_000, true, 6);
    expect(final.window).toMatchObject({ cursor: 4, startSeconds: 1.25 });
    expect(Array.from(final.window?.samples ?? [])).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
  });

  it("does not replay a finished phrase at stop", () => {
    let buffer = createLiveQcBuffer();
    buffer = appendLiveQcSamples(buffer, new Float32Array([0.1, 0.2]), 7, 2.5);
    buffer = appendLiveQcSamples(buffer, new Float32Array([0.3, 0.4]), 9, 3.5);
    const drained = drainLiveQcBuffer(buffer, 16_000, false, 16);

    expect(drained.window).toBeDefined();
    expect(drainLiveQcBuffer(drained.buffer, 16_000, true, 16).window).toBeUndefined();
  });

  it("hands Whisper the stalled word so a last-word slip is not cut off", () => {
    let buffer = createLiveQcBuffer();
    buffer = appendLiveQcSamples(buffer, new Float32Array(8_000).fill(0.1), 68, 0);
    buffer = appendLiveQcSamples(buffer, new Float32Array(8_000).fill(0.2), 68, 0.5);

    expect(drainLiveQcBuffer(buffer, 16_000, false, 60).window).toBeUndefined();

    const stalled = drainLiveQcBuffer(buffer, 16_000, false, 68);
    expect(stalled.window?.cursor).toBe(68);
    expect(stalled.window?.samples.length).toBe(16_000);
    expect(stalled.buffer.sampleCount).toBe(0);
  });

  it("keeps the gold checkpoint attached while Whisper is still processing", () => {
    let buffer = createLiveQcBuffer();
    buffer = appendLiveQcSamples(buffer, new Float32Array(16_000).fill(0.1), 0, 0);

    const drained = drainLiveQcBuffer(buffer, 16_000, false, 8);
    expect(drained.window?.goldCursor).toBe(8);
    const jumped = drainLiveQcBuffer(buffer, 16_000, false, 20);
    expect(jumped.window?.goldCursor).toBe(8);

    const delayedExpected: LiveExpectedWord[] = [
      { index: 0, lineIndex: 0, text: "The" },
      { index: 1, lineIndex: 0, text: "fox" },
      { index: 2, lineIndex: 0, text: "jumped" },
      { index: 3, lineIndex: 0, text: "on" },
      { index: 4, lineIndex: 0, text: "the" },
      { index: 5, lineIndex: 0, text: "mat" },
      { index: 6, lineIndex: 0, text: "and" },
      { index: 7, lineIndex: 0, text: "sat" },
      { index: 8, lineIndex: 0, text: "quietly" },
      { index: 9, lineIndex: 0, text: "by" },
      { index: 10, lineIndex: 0, text: "the" },
      { index: 11, lineIndex: 0, text: "door" },
      { index: 12, lineIndex: 0, text: "until" },
      { index: 13, lineIndex: 0, text: "dawn" },
      { index: 14, lineIndex: 0, text: "arrived" },
      { index: 15, lineIndex: 0, text: "again" },
    ];
    const whisperWords = ["The", "fox", "jumped", "in", "the", "mat"].map((text, index) => ({
      text,
      start: index * 0.2,
      end: index * 0.2 + 0.15,
      confidence: 0.99,
    }));

    // A slow Whisper response may complete after Parakeet has moved gold to
    // 16. Grading against that mutable cursor would align this clip to the
    // later words and drop the real on→in pickup.
    const flag = liveBackFlag({
      chapterId: "delayed-qc",
      expected: delayedExpected,
      transcript: whisperWords,
      state: { cursor: drained.window?.cursor ?? 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: drained.window?.goldCursor,
      confidenceThreshold: 0.9,
    });
    const staleFlag = liveBackFlag({
      chapterId: "delayed-qc",
      expected: delayedExpected,
      transcript: whisperWords,
      state: { cursor: drained.window?.cursor ?? 0, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: 16,
      confidenceThreshold: 0.9,
    });
    expect(flag).toMatchObject({ expected: "on", heard: "in", expectedIndex: 3 });
    expect(staleFlag).toBeUndefined();
  });

  it("still grades the last word when gold jumps past it", () => {
    let buffer = createLiveQcBuffer();
    buffer = appendLiveQcSamples(buffer, new Float32Array(8_000).fill(0.1), 68, 0);
    buffer = appendLiveQcSamples(buffer, new Float32Array(8_000).fill(0.2), 68, 0.5);

    const jumped = drainLiveQcBuffer(buffer, 16_000, false, 70);
    expect(jumped.window?.cursor).toBe(68);
    expect(jumped.window?.samples.length).toBe(16_000);
    expect(jumped.buffer.sampleCount).toBe(0);
  });
});
