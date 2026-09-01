import { describe, expect, it } from "vitest";
import { liveBackFlag, matchLiveWindow, isStaleLiveFlag, type LiveExpectedWord, type LiveMatchState } from "./live";
import { promptTextTokens } from "./model";

const LEAFLETS = [
  "Leaflets",
  "At dusk they pour from the sky. They blow across the rampars, turn cartwheels over rooftops, flutter into the ravines between houses.",
  "Entire streets swirl with them, flashing white against the cob-bles.",
  "Urgent message to the inhabitants of this town, they say.",
  "Depart immediately to open country.",
  "The tide climbs.",
  "The moon hangs small and yellow and gibbous.",
  "On the rooftops of beachfront hotels to the east, and in the gardens behind them, a half-dozen American artillery units drop incendiary rounds into the mouths of mortars.",
].join(" ");

function leafletsWords(): LiveExpectedWord[] {
  return promptTextTokens(LEAFLETS)
    .filter((token) => token.isWord)
    .map((token, index) => ({ index, lineIndex: 0, text: token.text }));
}

function indexOfPhrase(expected: LiveExpectedWord[], phrase: string): number {
  const needles = promptTextTokens(phrase).filter((token) => token.isWord).map((token) => token.text.toLocaleLowerCase("en-US"));
  for (let start = 0; start <= expected.length - needles.length; start += 1) {
    if (needles.every((needle, offset) => expected[start + offset]?.text.toLocaleLowerCase("en-US") === needle)) {
      return start;
    }
  }
  throw new Error(`phrase not found: ${phrase}`);
}

function followHeard(expected: LiveExpectedWord[], heard: string[]): LiveMatchState {
  let state: LiveMatchState = { cursor: 0, lastHeardEnd: 0 };
  heard.forEach((text, hop) => {
    const result = matchLiveWindow({
      chapterId: "leaflets",
      expected,
      transcript: [{ text, start: hop * 0.4, end: hop * 0.4 + 0.35, confidence: 0.97 }],
      state,
      flagsEnabled: false,
    });
    state = result.state;
  });
  return state;
}

function heardWithSwap(expected: LiveExpectedWord[], at: number, replacement: string): string[] {
  return expected.map((word, index) => (index === at ? replacement : word.text));
}

const SPLITS = [
  { name: "clean take", swap: null },
  { name: "said on instead of to", phrase: "message to the", offset: 1, heard: "on" },
  { name: "said a instead of the", phrase: "across the rampars", offset: 1, heard: "a" },
  { name: "said on instead of in", phrase: "in the gardens", offset: 0, heard: "on" },
  { name: "said on the east", phrase: "to the east", offset: 0, heard: "on" },
  { name: "clipped cartwheels to cartwheel", phrase: "turn cartwheels over", offset: 1, heard: "cartwheel" },
  { name: "tripped on inhabitants", phrase: "the inhabitants of", offset: 1, heard: "inhibitants" },
  { name: "came in late on flashing", phrase: "them flashing white", offset: 1, heard: "ashing" },
  { name: "skipped the heading and started at At dusk", phrase: "At dusk they", offset: 0, heard: "At", skipBefore: true },
  { name: "dropped immediately and kept going", phrase: "Depart immediately to", offset: 1, heard: "to", skipWord: true },
] as const;

describe("leaflets follow + whisper QC", () => {
  const expected = leafletsWords();

  it("tokenizes the leaflets passage", () => {
    expect(expected.length).toBeGreaterThan(80);
    expect(expected[0]?.text).toBe("Leaflets");
    expect(expected[indexOfPhrase(expected, "Urgent message to")]?.text).toBe("Urgent");
  });

  it("keeps gold moving across 10 one-word-hop splits", () => {
    const results = SPLITS.map((split) => {
      if (split.name === "clean take") {
        const state = followHeard(expected, expected.map((word) => word.text));
        return { name: split.name, cursor: state.cursor, target: expected.length };
      }
      if ("skipBefore" in split && split.skipBefore) {
        const start = indexOfPhrase(expected, "At dusk they");
        const heard = expected.slice(start).map((word) => word.text);
        const state = followHeard(expected, heard);
        return { name: split.name, cursor: state.cursor, target: expected.length };
      }
      if ("skipWord" in split && split.skipWord) {
        const at = indexOfPhrase(expected, split.phrase) + split.offset;
        const heard = expected.filter((_, index) => index !== at).map((word) => word.text);
        const state = followHeard(expected, heard);
        return { name: split.name, cursor: state.cursor, target: expected.length };
      }
      const at = indexOfPhrase(expected, split.phrase) + split.offset;
      const state = followHeard(expected, heardWithSwap(expected, at, split.heard));
      return { name: split.name, cursor: state.cursor, target: expected.length, at };
    });

    const stalled = results.filter((result) => result.cursor < result.target - 1);
    expect(stalled, `gold stalled on: ${stalled.map((item) => item.name).join(", ")}`).toEqual([]);
  });

  it("lets Whisper flag the intended miss and not an old dusk word once gold is at say", () => {
    const toIndex = indexOfPhrase(expected, "message to the") + 1;
    const sayIndex = indexOfPhrase(expected, "they say") + 1;
    const duskIndex = indexOfPhrase(expected, "At dusk they") + 1;

    const intended = liveBackFlag({
      chapterId: "leaflets",
      expected,
      transcript: [
        { text: "Urgent", start: 0, end: 0.3, confidence: 0.99 },
        { text: "message", start: 0.3, end: 0.55, confidence: 0.99 },
        { text: "on", start: 0.55, end: 0.7, confidence: 0.93 },
        { text: "the", start: 0.7, end: 0.82, confidence: 0.99 },
        { text: "inhabitants", start: 0.82, end: 1.3, confidence: 0.99 },
        { text: "of", start: 1.3, end: 1.4, confidence: 0.99 },
        { text: "this", start: 1.4, end: 1.55, confidence: 0.99 },
        { text: "town", start: 1.55, end: 1.8, confidence: 0.99 },
      ],
      state: { cursor: toIndex - 2, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: sayIndex,
      confidenceThreshold: 0.9,
    });
    expect(intended).toMatchObject({ expected: "to", heard: "on", expectedIndex: toIndex });

    const theIndex = indexOfPhrase(expected, "across the rampars") + 1;
    const article = liveBackFlag({
      chapterId: "leaflets",
      expected,
      transcript: [
        { text: "across", start: 0, end: 0.3, confidence: 0.99 },
        { text: "a", start: 0.3, end: 0.42, confidence: 0.94 },
        { text: "rampars", start: 0.42, end: 0.9, confidence: 0.99 },
      ],
      state: { cursor: theIndex - 1, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: theIndex + 4,
      confidenceThreshold: 0.9,
    });
    expect(article).toMatchObject({ expected: "the", heard: "a", expectedIndex: theIndex });

    const stale = liveBackFlag({
      chapterId: "leaflets",
      expected,
      transcript: [
        { text: "At", start: 0, end: 0.2, confidence: 0.99 },
        { text: "dust", start: 0.2, end: 0.5, confidence: 0.99 },
        { text: "they", start: 0.5, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: duskIndex - 1, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: sayIndex,
      confidenceThreshold: 0.9,
    });
    expect(stale).toBeUndefined();
    expect(isStaleLiveFlag(duskIndex, sayIndex)).toBe(true);
    expect(isStaleLiveFlag(toIndex, sayIndex)).toBe(false);
  });
});
