import { describe, expect, it } from "vitest";
import { liveBackFlag, matchLiveWindow, type LiveExpectedWord } from "./live";
import { promptTextTokens } from "./model";

/**
 * Later-chapter narrator slips. These lines are not the Leaflets opening.
 * Each case is a class (dropped -s, determiner, preposition, number, content)
 * so it must still flag on any English book.
 */
const LATER = [
  "The moon hangs small and yellow and gibbous.",
  "On the rooftops of beachfront hotels to the east, and in the gardens behind them, a half-dozen American artillery units drop incendiary rounds into the mouths of mortars.",
  "They cross the Channel at midnight.",
  "There are twelve and they are named for songs: Stardust and Stormy Weather.",
  "The sea glides along far below, spattered with the countless chevrons of whitecaps.",
  "Soon enough, the navigators can discern the low moonlit lumps of islands ranged along the horizon.",
  "Intercoms crackle. Deliberately, almost lazily, the bombers shed altitude.",
  "Threads of red light ascend from anti-air emplacements up and down the coast.",
  "Dark, ruined ships appear, scuttled or destroyed.",
  "On an outermost island, panicked sheep run zigzagging between rocks.",
  "Inside each airplane, a bombardier peers through an aiming window and counts to twenty.",
  "In a corner of the city, inside a tall, narrow house at Number 4 rue Vauborel, a sightless sixteen-year-old named Marie-Laure LeBlanc kneels over a low table.",
  "The model is a miniature of the city she kneels within, and contains scale replicas of the hundreds of houses and shops and hotels within its walls.",
  "In a corner of the room stand two galvanized buckets filled to the rim with water.",
  "Otherwise, the night is dreadfully silent: no engines, no voices, no clatter. No sirens.",
].join(" ");

const SLIPS = [
  { name: "dropped s on hangs", phrase: "moon hangs small", offset: 1, heard: "hang" },
  { name: "dropped s on units", phrase: "artillery units drop", offset: 1, heard: "unit" },
  { name: "at midnight said in", phrase: "Channel at midnight", offset: 1, heard: "in" },
  { name: "twelve said twenty", phrase: "are twelve and", offset: 1, heard: "twenty" },
  { name: "glides said glide", phrase: "sea glides along", offset: 1, heard: "glide" },
  { name: "chevrons said chevron", phrase: "countless chevrons of", offset: 1, heard: "chevron" },
  { name: "islands said island", phrase: "of islands ranged", offset: 1, heard: "island" },
  { name: "bombers said bomber", phrase: "the bombers shed", offset: 1, heard: "bomber" },
  { name: "Threads said Thread", phrase: "Threads of red", offset: 0, heard: "Thread" },
  { name: "emplacements said emplacement", phrase: "air emplacements up", offset: 1, heard: "emplacement" },
  { name: "ships said ship", phrase: "ruined ships appear", offset: 1, heard: "ship" },
  { name: "rocks said rock", phrase: "between rocks", offset: 1, heard: "rock" },
  { name: "twenty said twelve", phrase: "to twenty", offset: 1, heard: "twelve" },
  { name: "kneels said kneel", phrase: "LeBlanc kneels over", offset: 1, heard: "kneel" },
  { name: "houses said house", phrase: "of houses and", offset: 1, heard: "house" },
  { name: "buckets said bucket", phrase: "galvanized buckets filled", offset: 1, heard: "bucket" },
  { name: "sirens said siren", phrase: "No sirens", offset: 1, heard: "siren" },
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
    chapterId: "later",
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

describe("later-paragraph narrator slips", () => {
  const expected = wordsOf(LATER);

  it("covers later Bombers and Girl lines, not just Leaflets", () => {
    expect(indexOfPhrase(expected, "moon hangs small")).toBeGreaterThanOrEqual(0);
    expect(indexOfPhrase(expected, "cross the Channel")).toBeGreaterThan(10);
    expect(indexOfPhrase(expected, "Marie-Laure LeBlanc kneels")).toBeGreaterThan(40);
    expect(indexOfPhrase(expected, "No sirens")).toBeGreaterThan(60);
  });

  it("flags fifteen dropped-s, number, and function-word slips on later paragraphs", () => {
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

  it("treats twenty and 20 as the same narrator number slip on twelve", () => {
    const at = indexOfPhrase(expected, "are twelve and") + 1;
    for (const heard of ["twenty", "20"]) {
      const flag = flagSwap(expected, at, heard);
      expect(flag, heard).toMatchObject({ expected: "twelve", expectedIndex: at });
      expect(flag?.heard).toBe(heard);
    }

    const afterTwenty = matchLiveWindow({
      chapterId: "later",
      expected,
      transcript: [
        { text: "There", start: 0, end: 0.2, confidence: 0.99 },
        { text: "are", start: 0.2, end: 0.35, confidence: 0.99 },
        { text: "20", start: 0.35, end: 0.55, confidence: 0.97 },
        { text: "and", start: 0.55, end: 0.7, confidence: 0.99 },
      ],
      state: { cursor: at - 2, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    const loneDigit = matchLiveWindow({
      chapterId: "later",
      expected,
      transcript: [{ text: "20", start: 0.35, end: 0.55, confidence: 0.97 }],
      state: { cursor: at, lastHeardEnd: 0 },
      flagsEnabled: false,
    });
    expect(loneDigit.state.cursor).toBe(at + 1);
  });
});
