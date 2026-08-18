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

  it("flags a known heteronym when the lexicon has multiple pronunciations", () => {
    const lexicon = parsePronouncingDictionary(`
      read R EH1 D
      read(2) R IY1 D
      this DH IH1 S
      please P L IY1 Z
    `);

    const candidates = extractGlossaryCandidates("Please read this. I read it.", { lexicon });

    expect(candidates).toEqual([
      expect.objectContaining({ spelling: "read", reasons: expect.arrayContaining(["ambiguous-pronunciation"]) }),
    ]);
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

  it("chooses the next available generated user ID after entries have been removed", () => {
    const first = addGlossaryEntry([], "Elena");
    const second = addGlossaryEntry(first, "Kael");
    const remaining = deleteGlossaryEntry(second, first[0].id);
    const next = addGlossaryEntry(remaining, "Mara");

    expect(new Set(next.map((entry) => entry.id)).size).toBe(next.length);
  });
});
