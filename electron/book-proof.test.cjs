const { collectBookProof, applyPickupDecision, applyPickupUpdates } = require("./book-proof.cjs");

const project = {
  chapters: [
    { id: "ch02", index: 2, title: "Two", text_path: "text/ch02.json", audio_path: "audio/ch02.wav" },
    { id: "ch01", index: 1, title: "One", text_path: "text/ch01.json", audio_path: "audio/ch01.wav" },
    { id: "ch03", index: 3, title: "Three", text_path: "text/ch03.json" },
  ],
};

const documents = {
  ch01: { text: "The pier at dawn." },
  ch02: { text: "The pier again." },
  ch03: { text: "No audio yet." },
};

const alignments = {
  ch01: {
    transcript: [{ text: "the", start: 0, end: 0.2 }],
    pickups: [{ id: "p1", chapter_id: "ch01" }],
  },
};

function readDocument(chapter) {
  return Promise.resolve(documents[chapter.id] ?? null);
}

function readAlignment(chapterId) {
  return Promise.resolve(alignments[chapterId] ?? null);
}

describe("whole-book proof collection", () => {
  it("returns every chapter in reading order with its text and alignment", async () => {
    const book = await collectBookProof(project, readDocument, readAlignment);
    expect(book.chapters.map((chapter) => chapter.chapterId)).toEqual(["ch01", "ch02", "ch03"]);
    expect(book.chapters[0].manuscript).toBe("The pier at dawn.");
    expect(book.chapters[0].transcript).toHaveLength(1);
    expect(book.chapters[0].pickups).toHaveLength(1);
    expect(book.chapters[0].hasAudio).toBe(true);
  });

  it("joins span-only chapter scripts so a name scan can see the manuscript", async () => {
    const book = await collectBookProof(
      { chapters: [{ id: "ch01", index: 1, title: "One", text_path: "text/ch01.json" }] },
      () => Promise.resolve({
        spans: [{ text: "Daphne " }, { text: "Bridgerton crumpled the paper." }],
      }),
      () => Promise.resolve(null),
    );
    expect(book.chapters[0].manuscript).toBe("Daphne Bridgerton crumpled the paper.");
  });

  it("reports chapters that have no recording yet", async () => {
    const book = await collectBookProof(project, readDocument, readAlignment);
    const third = book.chapters[2];
    expect(third.hasAudio).toBe(false);
    expect(third.transcript).toEqual([]);
    expect(third.manuscript).toBe("No audio yet.");
  });

  it("keeps scanning when one chapter's script cannot be read", async () => {
    const book = await collectBookProof(
      project,
      (chapter) => chapter.id === "ch02"
        ? Promise.reject(new Error("Chapter script is malformed: Two"))
        : readDocument(chapter),
      readAlignment,
    );
    expect(book.chapters).toHaveLength(3);
    expect(book.chapters[1].manuscript).toBe("");
    expect(book.chapters[0].manuscript).toBe("The pier at dawn.");
    expect(book.chapters[2].manuscript).toBe("No audio yet.");
  });

  it("keeps scanning when one chapter's saved alignment cannot be read", async () => {
    const book = await collectBookProof(
      project,
      readDocument,
      (chapterId) => chapterId === "ch01"
        ? Promise.reject(new Error("schema"))
        : readAlignment(chapterId),
    );
    expect(book.chapters[0].transcript).toEqual([]);
    expect(book.chapters[0].pickups).toEqual([]);
    expect(book.chapters[0].manuscript).toBe("The pier at dawn.");
  });

  it("skips a chapter with no script path without calling the reader", async () => {
    let calls = 0;
    const book = await collectBookProof(
      { chapters: [{ id: "ch01", index: 1, title: "One" }] },
      () => {
        calls += 1;
        return Promise.resolve({ text: "unused" });
      },
      readAlignment,
    );
    expect(calls).toBe(0);
    expect(book.chapters[0].manuscript).toBe("");
  });

  it("handles an empty project", async () => {
    const book = await collectBookProof({}, readDocument, readAlignment);
    expect(book.chapters).toEqual([]);
  });

  it("reports which chapters already have a saved proof pass", async () => {
    const book = await collectBookProof(project, readDocument, readAlignment);
    expect(book.chapters.map((chapter) => chapter.checked)).toEqual([true, false, false]);
  });
});

describe("bulk pickup decisions", () => {
  const saved = [
    { id: "p1", status: "open", expected: "Leominster" },
    { id: "p2", status: "open", expected: "dawn" },
    { id: "p3", status: "done", expected: "Leominster" },
  ];

  it("changes only the named flags", () => {
    const result = applyPickupDecision(saved, ["p1"], "ignored");
    expect(result.changed).toBe(true);
    expect(result.pickups.map((pickup) => pickup.status)).toEqual(["ignored", "open", "done"]);
  });

  it("keeps the rest of each flag untouched", () => {
    const result = applyPickupDecision(saved, ["p1"], "ignored");
    expect(result.pickups[0]).toEqual({ id: "p1", status: "ignored", expected: "Leominster" });
  });

  it("reports no change when the flags already hold that decision", () => {
    const result = applyPickupDecision(saved, ["p3"], "done");
    expect(result.changed).toBe(false);
    expect(result.pickups).toEqual(saved);
  });

  it("reports no change for ids this chapter does not have", () => {
    const result = applyPickupDecision(saved, ["nope"], "ignored");
    expect(result.changed).toBe(false);
  });

  it("refuses a status the workflow does not define", () => {
    expect(() => applyPickupDecision(saved, ["p1"], "maybe")).toThrow(/status/i);
  });

  it("survives a chapter with no saved flags", () => {
    expect(applyPickupDecision(undefined, ["p1"], "done")).toEqual({ pickups: [], changed: false });
  });
});

describe("incoming pickup decisions", () => {
  const saved = [
    { id: "p1", status: "open", expected: "dawn" },
    { id: "p2", status: "open", expected: "road", note: "mine" },
  ];

  it("takes the status and the note that came with it", () => {
    const result = applyPickupUpdates(saved, [{ id: "p1", status: "done", note: "re-recorded" }]);
    expect(result.changed).toBe(true);
    expect(result.pickups[0]).toEqual({
      id: "p1",
      status: "done",
      expected: "dawn",
      note: "re-recorded",
    });
  });

  it("leaves flags nobody mentioned alone", () => {
    const result = applyPickupUpdates(saved, [{ id: "p1", status: "done" }]);
    expect(result.pickups[1]).toBe(saved[1]);
  });

  it("keeps an existing note when the incoming decision has none", () => {
    const result = applyPickupUpdates(saved, [{ id: "p2", status: "ignored" }]);
    expect(result.pickups[1]).toEqual({ id: "p2", status: "ignored", expected: "road", note: "mine" });
  });

  it("ignores a blank note rather than erasing what is there", () => {
    const result = applyPickupUpdates(saved, [{ id: "p2", note: "   " }]);
    expect(result.changed).toBe(false);
    expect(result.pickups[1].note).toBe("mine");
  });

  it("reports no change when the decision matches what is saved", () => {
    const result = applyPickupUpdates(saved, [{ id: "p1", status: "open" }]);
    expect(result.changed).toBe(false);
  });

  it("refuses a status the workflow does not define", () => {
    expect(() => applyPickupUpdates(saved, [{ id: "p1", status: "maybe" }])).toThrow(/status/i);
  });

  it("ignores updates without an id", () => {
    expect(applyPickupUpdates(saved, [{ status: "done" }]).changed).toBe(false);
  });
});
