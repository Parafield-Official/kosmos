import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "../project/types";
import {
  buildVoiceGuideMarkdown,
  collectGuideRows,
  fillGlossaryRespells,
  markUpScript,
  planVoiceGuideFiles,
} from "./guide";

function entry(partial: Partial<GlossaryEntry> & { spelling: string }): GlossaryEntry {
  return {
    id: partial.id ?? `id-${partial.spelling.toLowerCase()}`,
    spelling: partial.spelling,
    respell: partial.respell,
    voice_note: partial.voice_note,
    frequency: partial.frequency ?? 0,
    source: partial.source ?? "user",
  };
}

describe("collectGuideRows", () => {
  it("counts appearances and lists the chapters a name is in", () => {
    const rows = collectGuideRows({
      glossary: [entry({ spelling: "Siobhan" }), entry({ spelling: "Leominster" })],
      chapters: [
        { index: 1, title: "One", text: "Siobhan left Leominster. Siobhan did not look back." },
        { index: 2, title: "Two", text: "Leominster was quiet." },
        { index: 3, title: "Three", text: "Leominster again." },
      ],
    });
    expect(rows.map((row) => [row.entry.spelling, row.count, row.chapters])).toEqual([
      ["Leominster", 3, [1, 2, 3]],
      ["Siobhan", 2, [1]],
    ]);
  });

  it("counts a possessive as the name", () => {
    const rows = collectGuideRows({
      glossary: [entry({ spelling: "Siobhan" })],
      chapters: [{ index: 1, title: "One", text: "Siobhan’s coat. Siobhan's key. Siobhan." }],
    });
    expect(rows[0].count).toBe(3);
  });

  it("does not count a name inside a longer word", () => {
    const rows = collectGuideRows({
      glossary: [entry({ spelling: "Ann" })],
      chapters: [{ index: 1, title: "One", text: "Anna and Annette walked. Ann waved." }],
    });
    expect(rows[0].count).toBe(1);
  });

  it("keeps the edited row when two entries share a spelling", () => {
    const rows = collectGuideRows({
      glossary: [
        entry({ id: "auto-x", spelling: "Niamh", source: "auto" }),
        entry({ id: "user-x", spelling: "niamh", respell: "NEEV", source: "user" }),
      ],
      chapters: [{ index: 1, title: "One", text: "Niamh." }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.respell).toBe("NEEV");
  });
});

describe("buildVoiceGuideMarkdown", () => {
  const chapters = [
    { index: 1, title: "One", text: "Siobhan drove to Leominster with Niamh." },
    { index: 2, title: "Two", text: "Leominster." },
  ];

  it("splits decided pronunciations from the ones still open", () => {
    const guide = buildVoiceGuideMarkdown({
      projectName: "The Long Road",
      narrator: "R. Vance",
      generatedAt: "2026-08-20T00:00:00.000Z",
      glossary: [
        entry({ spelling: "Leominster", respell: "LEM-ster", voice_note: "Local: clipped." }),
        entry({ spelling: "Siobhan", respell: "shiv-AWN" }),
        entry({ spelling: "Niamh" }),
      ],
      chapters,
    });
    expect(guide).toContain("# Voice guide — The Long Road");
    expect(guide).toContain("Narrator: R. Vance");
    expect(guide).toContain("Names: 3 (2 with a pronunciation)");
    expect(guide).toContain("| Leominster | LEM-ster | Local: clipped. | 2 | 1–2 |");
    expect(guide).toContain("| Siobhan | shiv-AWN | — | 1 | 1 |");
    expect(guide).toContain("## Still to decide");
    expect(guide.indexOf("## Pronunciations")).toBeLessThan(guide.indexOf("## Still to decide"));
    expect(guide.slice(guide.indexOf("## Still to decide"))).toContain("| Niamh |");
  });

  it("says so when a glossary name never appears in the chapters given", () => {
    const guide = buildVoiceGuideMarkdown({
      glossary: [entry({ spelling: "Ravenscroft", respell: "RAY-venz-kroft" })],
      chapters,
    });
    expect(guide).toContain("Not found in the chapters given: Ravenscroft.");
  });

  it("does not print an empty table for an empty glossary", () => {
    const guide = buildVoiceGuideMarkdown({ glossary: [], chapters });
    expect(guide).toContain("The glossary is empty.");
    expect(guide).not.toContain("| Name |");
  });

  it("escapes a pipe so the table survives", () => {
    const guide = buildVoiceGuideMarkdown({
      glossary: [entry({ spelling: "Ada", respell: "AY-duh", voice_note: "warm | dry" })],
      chapters: [{ index: 1, title: "One", text: "Ada." }],
    });
    expect(guide).toContain("warm \\| dry");
  });

  it("collapses a long chapter run into a range", () => {
    const guide = buildVoiceGuideMarkdown({
      glossary: [entry({ spelling: "Ada", respell: "AY-duh" })],
      chapters: [1, 2, 3, 7, 9, 10].map((index) => ({ index, title: `C${index}`, text: "Ada." })),
    });
    expect(guide).toContain("1–3, 7, 9–10");
  });
});

describe("fillGlossaryRespells", () => {
  const dictionary = {
    pronunciation: (word: string) => ({
      siobhan: "SH AW1 B AA2 N",
      leominster: "L IY1 OW0 M IH2 N S T ER0",
    }[word]),
  };

  it("answers what the dictionary knows and names what it does not", () => {
    const result = fillGlossaryRespells([
      entry({ spelling: "Siobhan" }),
      entry({ spelling: "Zathrusia" }),
    ], dictionary);
    expect(result.filled).toBe(1);
    expect(result.glossary[0].respell).toBe("SHOW-bahn");
    expect(result.glossary[1].respell).toBeUndefined();
    expect(result.unknown).toEqual(["Zathrusia"]);
  });

  it("never overwrites a pronunciation a person wrote", () => {
    const mine = entry({ spelling: "Leominster", respell: "LEM-ster" });
    const result = fillGlossaryRespells([mine], dictionary);
    expect(result.filled).toBe(0);
    expect(result.glossary[0].respell).toBe("LEM-ster");
    expect(result.glossary[0]).toBe(mine);
  });

  it("hands back the same list when it changed nothing", () => {
    const glossary = [entry({ spelling: "Zathrusia" })];
    expect(fillGlossaryRespells(glossary, dictionary).glossary).toBe(glossary);
  });
});

describe("planVoiceGuideFiles", () => {
  it("plans the guide plus one marked script per chapter", () => {
    const files = planVoiceGuideFiles({
      glossary: [entry({ spelling: "Siobhan", respell: "shiv-AWN" })],
      chapters: [
        { index: 1, title: "The Long Road", text: "Siobhan drove." },
        { index: 12, title: "Home / Away", text: "Siobhan stopped." },
      ],
    });
    expect(files.map((file) => file.fileName)).toEqual([
      "voice-guide.md",
      "01_the-long-road_marked.txt",
      "12_home-away_marked.txt",
    ]);
    expect(files[1].contents).toBe("Siobhan [shiv-AWN] drove.\n");
    expect(files[0].contents).toContain("# Voice guide");
  });

  it("still names a file when a chapter title has nothing usable in it", () => {
    const files = planVoiceGuideFiles({
      glossary: [],
      chapters: [{ index: 3, title: "— ***", text: "Words." }],
    });
    expect(files[1].fileName).toBe("03_chapter_marked.txt");
  });

  it("passes the marking frequency through", () => {
    const files = planVoiceGuideFiles(
      {
        glossary: [entry({ spelling: "Siobhan", respell: "shiv-AWN" })],
        chapters: [{ index: 1, title: "One", text: "Siobhan and Siobhan." }],
      },
      { frequency: "all" },
    );
    expect(files[1].contents).toBe("Siobhan [shiv-AWN] and Siobhan [shiv-AWN].\n");
  });

  it("writes just the guide for a book with no chapters", () => {
    const files = planVoiceGuideFiles({ glossary: [], chapters: [] });
    expect(files).toHaveLength(1);
  });
});

describe("markUpScript", () => {
  const glossary = [
    entry({ spelling: "Leominster", respell: "LEM-ster" }),
    entry({ spelling: "Siobhan", respell: "shiv-AWN" }),
  ];

  it("puts the pronunciation after the name", () => {
    expect(markUpScript("Siobhan drove to Leominster.", glossary))
      .toBe("Siobhan [shiv-AWN] drove to Leominster [LEM-ster].");
  });

  it("marks a name once per paragraph by default", () => {
    const text = "Siobhan waited. Siobhan left.\n\nSiobhan returned.";
    expect(markUpScript(text, glossary))
      .toBe("Siobhan [shiv-AWN] waited. Siobhan left.\n\nSiobhan [shiv-AWN] returned.");
  });

  it("marks every appearance when asked", () => {
    expect(markUpScript("Siobhan waited. Siobhan left.", glossary, { frequency: "all" }))
      .toBe("Siobhan [shiv-AWN] waited. Siobhan [shiv-AWN] left.");
  });

  it("keeps the paragraph breaks and spacing it was handed", () => {
    const text = "One.\n\n  Siobhan.\n\nThree.\n";
    expect(markUpScript(text, glossary)).toBe("One.\n\n  Siobhan [shiv-AWN].\n\nThree.\n");
  });

  it("leaves the script alone when nothing has a pronunciation", () => {
    const text = "Siobhan drove to Leominster.";
    expect(markUpScript(text, [entry({ spelling: "Siobhan" })])).toBe(text);
    expect(markUpScript(text, [])).toBe(text);
  });

  it("prefers the longer name when two entries overlap", () => {
    const marked = markUpScript("Mary Kate spoke.", [
      entry({ spelling: "Mary", respell: "MER-ee" }),
      entry({ spelling: "Mary Kate", respell: "MER-ee KAYT" }),
    ]);
    expect(marked).toBe("Mary Kate [MER-ee KAYT] spoke.");
  });

  it("marks a possessive without breaking the apostrophe", () => {
    expect(markUpScript("Siobhan’s coat.", glossary)).toBe("Siobhan [shiv-AWN]’s coat.");
  });

  it("does not mark a name inside a longer word", () => {
    expect(markUpScript("Siobhanna waited.", glossary)).toBe("Siobhanna waited.");
  });

  it("accepts a different wrapper", () => {
    expect(markUpScript("Siobhan.", glossary, { open: "(", close: ")" }))
      .toBe("Siobhan (shiv-AWN).");
  });
});
