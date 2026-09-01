import { describe, expect, it } from "vitest";
import {
  addGlossaryEntry,
  candidatesToGlossary,
  deleteGlossaryEntry,
  extractGlossaryCandidates,
  mergeGlossaryCandidates,
  linkGlossarySpans,
  mergeGlossaryEntries,
  parsePronouncingDictionary,
  replaceAutoGlossaryCandidates,
  renameGlossaryEntry,
} from "./candidates";

describe("offline glossary candidates", () => {
  it("merges case variants, skips common headings, and recognizes name context", () => {
    const text = [
      "CHAPTER 1",
      "The rain stopped. Elena said hello to Kael.",
      "Said ELENA, ‘Kael will visit Bistritz in January.’",
      "At dawn, Elena found Kael waiting.",
      "Hope said it would work.",
    ].join("\n");

    const candidates = extractGlossaryCandidates(text);
    const byName = new Map(candidates.map((candidate) => [candidate.spelling, candidate]));

    expect(byName.get("Elena")?.frequency).toBe(3);
    expect(byName.get("Kael")?.frequency).toBe(3);
    expect(byName.get("Bistritz")?.frequency).toBe(1);
    expect(byName.get("Hope")?.reasons).toContain("name-pattern");
    expect(byName.has("Chapter")).toBe(false);
    expect(byName.has("The")).toBe(false);
    expect(byName.has("January")).toBe(false);
  });

  it("keeps unusual spellings even when the word list knows them", () => {
    const candidates = extractGlossaryCandidates("We drove through Worcester. Worcester was quiet.");
    expect(candidates.find((candidate) => candidate.spelling === "Worcester")?.reasons).toContain(
      "unusual-spelling",
    );
  });

  it("keeps ordinary words out of pronunciation suggestions while retaining names", () => {
    const lexicon = parsePronouncingDictionary(`
      hotel HH OW0 T EH1 L
      bees B IY1 Z
      big B IH1 G
      walls W AO1 L Z
      fingers F IH1 NG G ER0 Z
      Werner W ER1 N ER0
    `);

    const candidates = extractGlossaryCandidates(
      "Werner said the hotel had big walls. Bees covered his fingers.",
      { lexicon },
    );

    expect(candidates.map((candidate) => candidate.spelling)).toEqual(["Werner"]);
  });

  it("does not put everyday heteronyms on the pronunciation list", () => {
    const lexicon = parsePronouncingDictionary(`
      read R EH1 D
      read(2) R IY1 D
      this DH IH1 S
      please P L IY1 Z
      insult IH2 N S AH1 L T
      insult(2) IH1 N S AH0 L T
    `);

    const candidates = extractGlossaryCandidates("Please read this. I read it. A scathing insult followed.", { lexicon });

    expect(candidates.map((candidate) => candidate.spelling.toLocaleLowerCase("en-US"))).not.toContain("read");
    expect(candidates.map((candidate) => candidate.spelling.toLocaleLowerCase("en-US"))).not.toContain("insult");
  });

  it("keeps names a narrator would actually trip on and drops common English", () => {
    const lexicon = parsePronouncingDictionary(`
      actually AE1 K CH UW2 AH0 L IY0
      actually(2) AE1 K CH L IY0
      read R EH1 D
      read(2) R IY1 D
      produce P R AH0 D UW1 S
      produce(2) P R AA1 D UW0 S
      record R AH0 K AO1 R D
      record(2) R EH1 K ER0 D
      wednesday W EH1 N Z D IY0
      daphne D AE1 F N IY0
      violet V AY1 AH0 L IH0 T
      hyacinth HH AY1 AH0 S IH0 N TH
      insult IH2 N S AH1 L T
      insult(2) IH1 N S AH0 L T
      the DH AH0
      and AH0 N D
      said S EH1 D
      what W AH1 T
      she SH IY1
      it IH1 T
      then DH EH1 N
    `);
    const text = [
      "The Bridgertons are by far the most prolific family.",
      "Anthony, Benedict, Colin, Daphne, Eloise, Francesca, Gregory, and Hyacinth.",
      "Violet Bridgerton crumpled the paper. \"Did you read what she said?\"",
      "\"Read it, then,\" Violet wailed.",
      "\"Actually, what she said was that there could be no doubt.\"",
      "It was delivered every Monday, Wednesday, and Friday.",
      "\"Oooooooooohhhhhhhhhh!\"",
      "She did not produce a single child. This Author never took the time to record eye color.",
      "A mix of commentary and scathing insult.",
      "Lady Whistledown named the Featheringtons in full.",
    ].join(" ");

    const candidates = extractGlossaryCandidates(text, { lexicon });
    const spellings = candidates.map((candidate) => candidate.spelling);

    expect(spellings).toEqual(expect.arrayContaining([
      "Daphne",
      "Violet",
      "Hyacinth",
      "Whistledown",
      "Bridgertons",
      "Featheringtons",
    ]));
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "read")).toBe(false);
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "actually")).toBe(false);
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "wednesday")).toBe(false);
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "insult")).toBe(false);
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "produce")).toBe(false);
    expect(spellings.some((spelling) => spelling.toLocaleLowerCase("en-US") === "record")).toBe(false);
    expect(spellings.some((spelling) => /^(?:o|h)+$/iu.test(spelling))).toBe(false);
  });

  it("drops a dialogue-initial filler with a syllable mismatch even when it is not on a stoplist", () => {
    const lexicon = parsePronouncingDictionary(`
      fortunately F AO1 R CH AH0 N AH0 T L IY0
      she SH IY1
      left L EH1 F T
      i AY1
      agreed AH0 G R IY1 D
    `);
    const candidates = extractGlossaryCandidates(
      "\"Fortunately, she left. I fortunately agreed.\"",
      { lexicon },
    );
    expect(candidates.map((candidate) => candidate.spelling.toLocaleLowerCase("en-US"))).not.toContain("fortunately");
  });

  it("flags a name the dictionary says with fewer syllables than it is spelled with", () => {
    const lexicon = parsePronouncingDictionary(`
      worcester W UH1 S T ER0
      hermione HH ER0 M IY0 OW1 N IY0
      london L AH1 N D AH0 N
      michael M AY1 K AH0 L
      the DH AH0
      from F R AH1 M
      to T UW1
      train T R EY1 N
      drove D R OW1 V
      us AH1 S
    `);

    const candidates = extractGlossaryCandidates(
      "The train from Worcester to London. Michael drove Hermione to us.",
      { lexicon },
    );

    expect(candidates.map((candidate) => candidate.spelling).sort()).toEqual(["Hermione", "Worcester"]);
    expect(candidates.find((candidate) => candidate.spelling === "Worcester")?.reasons)
      .toContain("unexpected-pronunciation");
  });

  it("does not flag an unexpected pronunciation when the word only starts sentences", () => {
    const lexicon = parsePronouncingDictionary(`
      worcester W UH1 S T ER0
      was W AA1 Z
      quiet K W AY1 AH0 T
    `);

    const candidates = extractGlossaryCandidates("Worcester was quiet.", { lexicon });

    expect(candidates.map((candidate) => candidate.spelling)).toEqual([]);
  });

  it("refreshes auto suggestions without deleting authored pronunciation work", () => {
    const refreshed = replaceAutoGlossaryCandidates(
      [
        { id: "auto-hotel", spelling: "hotel", frequency: 8, source: "auto" },
        { id: "user-family", spelling: "family", frequency: 0, source: "user", respell: "FAM-lee" },
        { id: "auto-werner", spelling: "Werner", frequency: 2, source: "auto", clip_path: "audio/glossary/werner.wav" },
      ],
      [
        { spelling: "Werner", frequency: 3, reasons: ["name-pattern"] },
      ],
    );

    expect(refreshed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "user-family", spelling: "family", respell: "FAM-lee" }),
      expect.objectContaining({ spelling: "Werner", frequency: 3, clip_path: "audio/glossary/werner.wav" }),
    ]));
    expect(refreshed.some((entry) => entry.spelling === "hotel")).toBe(false);
  });

  it("sorts by frequency, caps auto suggestions, and keeps stable ties", () => {
    const invented = Array.from({ length: 100 }, (_, index) => {
      const first = String.fromCharCode(65 + Math.floor(index / 26));
      const second = String.fromCharCode(65 + (index % 26));
      return `Zname${first}${second}`;
    });
    const text = invented.map((word, index) => `${word} ${index < 3 ? "Zorven ".repeat(4) : ""}`).join(" ");
    const candidates = extractGlossaryCandidates(text, { limit: 80 });

    expect(candidates).toHaveLength(80);
    expect(candidates[0].spelling).toBe("Zorven");
  });

  it("lets the human add, rename, merge, and delete draft entries", () => {
    let glossary = candidatesToGlossary(
      extractGlossaryCandidates("Elena met ELENA. Kael waved."),
    );
    glossary = addGlossaryEntry(glossary, "Leominster", { id: "user-leominster" });
    glossary = renameGlossaryEntry(glossary, "user-leominster", "Leominster", "LEM-ster");

    const elena = glossary.find((entry) => entry.spelling === "Elena");
    const kael = glossary.find((entry) => entry.spelling === "Kael");
    expect(elena).toBeDefined();
    expect(kael).toBeDefined();

    glossary = mergeGlossaryEntries(glossary, elena!.id, kael!.id, "Elena / Kael");
    expect(glossary.find((entry) => entry.id === elena!.id)).toMatchObject({
      spelling: "Elena / Kael",
      frequency: 3,
    });
    expect(glossary.some((entry) => entry.id === kael!.id)).toBe(false);

    glossary = deleteGlossaryEntry(glossary, "user-leominster");
    expect(glossary.some((entry) => entry.id === "user-leominster")).toBe(false);
  });

  it("links glossary spellings without dropping span styles or punctuation", () => {
    const linked = linkGlossarySpans(
      [{ text: "Elena waved.", seat: "N1", style: ["italic"] }],
      [{ id: "elena", spelling: "Elena", frequency: 1, source: "user" }],
    );
    expect(linked).toEqual([
      { text: "Elena", seat: "N1", style: ["italic"], glossary_id: "elena" },
      { text: " waved.", seat: "N1", style: ["italic"], glossary_id: undefined },
    ]);
  });

  it("prefers a user pronunciation row over a duplicate auto candidate", () => {
    const linked = linkGlossarySpans(
      [{ text: "Elena spoke.", seat: "narration", style: [] }],
      [
        { id: "auto-elena", spelling: "Elena", frequency: 3, source: "auto" },
        { id: "user-elena", spelling: "ELENA", frequency: 0, source: "user", respell: "eh-LAY-na" },
      ],
    );
    expect(linked[0].glossary_id).toBe("user-elena");
  });

  it("keeps generated IDs unique when different spellings share a slug", () => {
    const glossary = candidatesToGlossary([
      { spelling: "A/B", frequency: 1, reasons: ["uncommon"] },
      { spelling: "A-B", frequency: 1, reasons: ["uncommon"] },
    ]);

    expect(new Set(glossary.map((entry) => entry.id)).size).toBe(2);
  });

  it("preserves earlier glossary links when another manuscript is imported", () => {
    const existing = [
      {
        id: "auto-kael",
        spelling: "Kael",
        frequency: 2,
        source: "auto" as const,
        clip_path: "audio/glossary/kael.wav",
      },
      {
        id: "user-elena",
        spelling: "Elena",
        frequency: 0,
        source: "user" as const,
        respell: "eh-LAY-na",
      },
    ];

    const merged = mergeGlossaryCandidates(existing, [
      { spelling: "Elena", frequency: 3, reasons: ["capitalized"] },
      { spelling: "Mara", frequency: 1, reasons: ["uncommon"] },
    ]);

    expect(merged).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "auto-kael", clip_path: "audio/glossary/kael.wav" }),
      expect.objectContaining({ id: "user-elena", respell: "eh-LAY-na", frequency: 3 }),
      expect.objectContaining({ id: "auto-mara", spelling: "Mara" }),
    ]));
    expect(new Set(merged.map((entry) => entry.id)).size).toBe(merged.length);
  });

  it("aggregates frequencies for preserved auto candidates", () => {
    const merged = mergeGlossaryCandidates(
      [{ id: "auto-kael", spelling: "Kael", frequency: 2, source: "auto" }],
      [{ spelling: "KAEL", frequency: 3, reasons: ["repeated-capitalized"] }],
    );
    expect(merged).toEqual([
      expect.objectContaining({ id: "auto-kael", spelling: "Kael", frequency: 5 }),
    ]);
  });

  it("scans a novel-length manuscript without quadratic freeze", () => {
    const sentence = "The rain stopped. Elena said hello to Kael. ";
    const repeats = 12_000;
    const text = sentence.repeat(repeats);
    const started = Date.now();
    const candidates = extractGlossaryCandidates(text);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(candidates.find((candidate) => candidate.spelling === "Elena")?.frequency).toBe(repeats);
  });

  it("chooses the next available generated user ID after entries have been removed", () => {
    const first = addGlossaryEntry([], "Elena");
    const second = addGlossaryEntry(first, "Kael");
    const remaining = deleteGlossaryEntry(second, first[0].id);
    const next = addGlossaryEntry(remaining, "Mara");

    expect(new Set(next.map((entry) => entry.id)).size).toBe(next.length);
  });
});
