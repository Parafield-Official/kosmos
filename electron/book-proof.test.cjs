const { collectBookProof } = require("./book-proof.cjs");

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
});
