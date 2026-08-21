import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { respellArpabet, suggestRespelling, type RespellLexicon } from "./respell";
import { parsePronouncingDictionary } from "./candidates";

function lexicon(entries: Record<string, string>): RespellLexicon {
  return {
    pronunciation: (word) => entries[word],
  };
}

describe("respellArpabet", () => {
  it("marks the stressed syllable and joins the rest with hyphens", () => {
    expect(respellArpabet("HH ER0 M IY0 OW1 N IY0")?.respell).toBe("her-mee-OH-nee");
  });

  it("keeps a one-syllable word as one piece", () => {
    expect(respellArpabet("T EH1 M Z")?.respell).toBe("TEMZ");
  });

  it("breaks a cluster where English would start a syllable", () => {
    expect(respellArpabet("L IY1 OW0 M IH2 N S T ER0")?.respell).toBe("LEE-oh-min-ster");
    expect(respellArpabet("K EY1 T L IH0 N")?.respell).toBe("KAYT-lin");
  });

  it("tells the two 'oo' sounds apart", () => {
    expect(respellArpabet("W UH1 S T ER0")?.respell).toBe("WUU-ster");
    expect(respellArpabet("B UW1 T")?.respell).toBe("BOOT");
  });

  it("falls back to secondary stress when nothing carries primary stress", () => {
    const result = respellArpabet("W AA2 K IY0 N");
    expect(result?.respell).toBe("WAH-keen");
  });

  it("reports the syllables it found, not just the joined string", () => {
    expect(respellArpabet("HH AY0 P ER1 B AH0 L IY2")?.syllables).toEqual([
      { text: "hy", stressed: false },
      { text: "per", stressed: true },
      { text: "buh", stressed: false },
      { text: "lee", stressed: false },
    ]);
  });

  it("refuses phones it does not know rather than inventing a sound", () => {
    expect(respellArpabet("L QQ1 M")).toBeNull();
    expect(respellArpabet("")).toBeNull();
    expect(respellArpabet("L M N")).toBeNull();
  });
});

describe("suggestRespelling", () => {
  it("looks a word up as written, ignoring case and punctuation", () => {
    const dictionary = lexicon({ thames: "T EH1 M Z" });
    expect(suggestRespelling("Thames", dictionary)).toBe("TEMZ");
    expect(suggestRespelling("“Thames,”", dictionary)).toBe("TEMZ");
  });

  it("respells a hyphenated name a part at a time", () => {
    const dictionary = lexicon({ mary: "M EH1 R IY0", kate: "K EY1 T" });
    expect(suggestRespelling("Mary-Kate", dictionary)).toBe("MER-ee KAYT");
  });

  it("says nothing when a name is not in the dictionary", () => {
    const dictionary = lexicon({ mary: "M EH1 R IY0" });
    expect(suggestRespelling("Zathrusia", dictionary)).toBeNull();
    expect(suggestRespelling("Mary-Zathrusia", dictionary)).toBeNull();
    expect(suggestRespelling("   ", dictionary)).toBeNull();
  });
});

describe("the bundled pronouncing dictionary", () => {
  const dictionaryPath = path.resolve(process.cwd(), "vendor/cmudict/cmudict.dict");
  const contents = readFileSync(dictionaryPath, "utf8");
  const dictionary = parsePronouncingDictionary(contents);

  it("suggests a readable respelling for names narrators trip over", () => {
    expect(suggestRespelling("Leominster", dictionary)).toBe("LEE-oh-min-ster");
    expect(suggestRespelling("Gloucester", dictionary)).toBe("GLAH-ster");
    expect(suggestRespelling("Siobhan", dictionary)).toBe("SHOW-bahn");
    expect(suggestRespelling("Hermione", dictionary)).toBe("her-mee-OH-nee");
    expect(suggestRespelling("hyperbole", dictionary)).toBe("hy-PER-buh-lee");
  });

  it("still answers the questions the candidate list asks of it", () => {
    expect(dictionary.has("leominster")).toBe(true);
    expect(dictionary.has("zathrusia")).toBe(false);
    expect(dictionary.pronunciationCount("read")).toBeGreaterThan(1);
    expect(dictionary.pronunciation("zathrusia")).toBeUndefined();
  });

  it("respells every word it lists, or declines cleanly", () => {
    // A dictionary-wide pass: no crash, no empty suggestion, on a large sample.
    let respelled = 0;
    let declined = 0;
    for (const line of contents.split("\n").slice(0, 4000)) {
      const match = /^(\S+)\s+(.+)$/u.exec(line.trim());
      if (!match || match[1].startsWith(";;")) {
        continue;
      }
      const result = respellArpabet(match[2]);
      if (result === null) {
        declined += 1;
        continue;
      }
      expect(result.respell.length).toBeGreaterThan(0);
      expect(result.respell).not.toContain("undefined");
      respelled += 1;
    }
    expect(respelled).toBeGreaterThan(3000);
    expect(declined).toBeLessThan(respelled / 100);
  });
});
