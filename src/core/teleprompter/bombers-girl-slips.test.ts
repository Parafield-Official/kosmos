import { describe, expect, it } from "vitest";
import { liveBackFlag, matchLiveWindow, type LiveExpectedWord } from "./live";
import { promptTextTokens } from "./model";

const BOMBERS_GIRL = [
  "Bombers",
  "They cross the Channel at midnight. There are twelve and they are Thanes the Channel at midnigh. There are twe and they are named for songs: Stardust and Stormy Weather and In the Mood and Pistol-Packin' Mama.",
  "The sea glides along far below, spattered with the countless chevrons of whitecaps.",
  "Soon enough, the navigators can discern the low moonlit lumps of islands ranged along the horizon. France.",
  "Intercoms crackle. Deliberately, almost lazily, the bombers shed altitude.",
  "Threads of red light ascend from anti-air emplacements up and down the coast.",
  "Dark, ruined ships appear, scuttled or destroyed, one with its bow shorn away, a second flickering as it burns.",
  "On an outermost island, panicked sheep run zigzagging between rocks.",
  "Inside each airplane, a bombardier peers through an aiming window and counts to twenty.",
  "In a corner of the city, inside a tall, narrow house at Number 4 rue Vauborel, on the sixth and highest floor, a sightless sixteen-year-old named Marie-Laure LeBlanc kneels over a low table covered entirely with a model.",
  "The model is a miniature of the city she kneels within, and contains scale replicas of the hundreds of houses and shops and hotels within its walls.",
  "A slender wooden jetty arcs our from a beach called the Plage du Môle.",
  "She whispers, and her fingers walk down a lite staircase.",
  "In a corner of the room stand two galvanized buckets filled to the rim with water.",
].join(" ");

const SLIPS = [
  { name: "prep at→in", phrase: "Channel at midnight", offset: 1, heard: "in" },
  { name: "number twelve→twenty", phrase: "are twelve and", offset: 1, heard: "twenty" },
  { name: "determiner the→a", phrase: "The sea glides", offset: 0, heard: "A" },
  { name: "dropped s glides", phrase: "sea glides along", offset: 1, heard: "glide" },
  { name: "dropped s chevrons", phrase: "countless chevrons of", offset: 1, heard: "chevron" },
  { name: "dropped s islands", phrase: "of islands ranged", offset: 1, heard: "island" },
  { name: "content France→Spain", phrase: "horizon France", offset: 1, heard: "Spain" },
  { name: "dropped s bombers", phrase: "the bombers shed", offset: 1, heard: "bomber" },
  { name: "dropped s Threads", phrase: "Threads of red", offset: 0, heard: "Thread" },
  { name: "dropped s ships", phrase: "ruined ships appear", offset: 1, heard: "ship" },
  { name: "dropped s rocks", phrase: "between rocks", offset: 1, heard: "rock" },
  { name: "number twenty→twelve", phrase: "to twenty", offset: 1, heard: "twelve" },
  { name: "ordinal sixth→fifth", phrase: "the sixth and", offset: 1, heard: "fifth" },
  { name: "dropped s kneels", phrase: "LeBlanc kneels over", offset: 1, heard: "kneel" },
  { name: "dropped s buckets", phrase: "galvanized buckets filled", offset: 1, heard: "bucket" },
] as const;

function wordsOf(text: string): LiveExpectedWord[] {
  return promptTextTokens(text)
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

function flagSwap(expected: LiveExpectedWord[], at: number, heard: string) {
  const around = expected.slice(Math.max(0, at - 1), at + 2);
  return liveBackFlag({
    chapterId: "bombers-girl",
    expected,
    transcript: around.map((word, offset) => ({
      text: word.index === at ? heard : word.text,
      start: offset * 0.25,
      end: offset * 0.25 + 0.2,
      confidence: 0.96,
    })),
    state: { cursor: Math.max(0, at - 1), lastHeardEnd: 0 },
    flagsEnabled: true,
    goldCursor: at + 2,
    confidenceThreshold: 0.9,
  });
}

describe("Bombers + Girl narrator slips", () => {
  const expected = wordsOf(BOMBERS_GIRL);

  it("tokenizes both later headings", () => {
    expect(indexOfPhrase(expected, "cross the Channel")).toBeGreaterThan(0);
    expect(indexOfPhrase(expected, "Marie-Laure LeBlanc kneels")).toBeGreaterThan(40);
  });

  it("flags 15 unique narrator slips on this passage", () => {
    const misses = SLIPS.flatMap((slip) => {
      const at = indexOfPhrase(expected, slip.phrase) + slip.offset;
      const flag = flagSwap(expected, at, slip.heard);
      const wanted = expected[at]?.text;
      if (flag?.expected === wanted && flag.heard.toLocaleLowerCase("en-US") === slip.heard.toLocaleLowerCase("en-US")) {
        return [];
      }
      return [`${slip.name}: wanted ${wanted}→${slip.heard}, got ${flag ? `${flag.expected}→${flag.heard}` : "nothing"}`];
    });
    expect(misses, misses.join("\n")).toEqual([]);
  });

  it("does not freeze gold on twelve when the narrator says 20", () => {
    const at = indexOfPhrase(expected, "are twelve and") + 1;
    const next = matchLiveWindow({
      chapterId: "bombers-girl",
      expected,
      transcript: [{ text: "20", start: 0, end: 0.3, confidence: 0.97 }],
      state: { cursor: at, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    expect(next.state.cursor).toBe(at + 1);
  });

  it("does not paint Channel onto a later countless word", () => {
    const start = indexOfPhrase(expected, "They cross the");
    const flag = liveBackFlag({
      chapterId: "bombers-girl",
      expected,
      transcript: [
        { text: "They", start: 0, end: 0.2, confidence: 0.99 },
        { text: "cross", start: 0.2, end: 0.4, confidence: 0.99 },
        { text: "the", start: 0.4, end: 0.5, confidence: 0.99 },
        { text: "Channel", start: 0.5, end: 0.8, confidence: 0.99 },
        { text: "in", start: 0.8, end: 0.95, confidence: 0.94 },
        { text: "midnight", start: 0.95, end: 1.3, confidence: 0.99 },
      ],
      state: { cursor: start, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: start + 6,
      confidenceThreshold: 0.9,
    });
    expect(flag).toMatchObject({ expected: "at", heard: "in" });
    expect(flag?.expected?.toLocaleLowerCase("en-US")).not.toBe("countless");
  });

  it("does not paint cannot onto an earlier word far behind gold", () => {
    const at = indexOfPhrase(expected, "countless chevrons of");
    const flag = liveBackFlag({
      chapterId: "bombers-girl",
      expected,
      transcript: [
        { text: "and", start: 0, end: 0.15, confidence: 0.99 },
        { text: "she", start: 0.15, end: 0.3, confidence: 0.99 },
        { text: "cannot", start: 0.3, end: 0.55, confidence: 0.97 },
        { text: "sleep", start: 0.55, end: 0.8, confidence: 0.99 },
      ],
      state: { cursor: at, lastHeardEnd: 0 },
      flagsEnabled: true,
      goldCursor: at + 2,
      confidenceThreshold: 0.9,
    });
    expect(flag?.expected?.toLocaleLowerCase("en-US")).not.toBe("chevrons");
    expect(flag?.expected?.toLocaleLowerCase("en-US")).not.toBe("countless");
  });
});
