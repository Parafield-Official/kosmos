const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { exportVoiceGuide, collectChapterTexts } = require("./voice-guide.cjs");
const glossaryCore = require("../dist-core/glossary.cjs");

const BASE_PROJECT = {
  schema: 1,
  id: "book-1",
  name: "The Pier",
  narrator: "R. Vance",
  glossary: [
    { id: "g1", spelling: "Siobhan", respell: "shiv-AWN", voice_note: "Dry.", frequency: 3, source: "user" },
    { id: "g2", spelling: "Leominster", frequency: 1, source: "auto" },
  ],
  chapters: [
    { id: "ch01", index: 1, title: "The Pier", text_path: "text/ch01.json", author_status: "draft" },
    { id: "ch02", index: 2, title: "Home / Away", text_path: "text/ch02.json", author_status: "draft" },
  ],
};

const SCRIPTS = {
  "text/ch01.json": "Siobhan walked to Leominster.\n\nSiobhan did not look back.",
  "text/ch02.json": "The road out of Leominster was long.",
};

async function workspace() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "kosmos-guide-"));
  await fsp.writeFile(path.join(root, "project.json"), JSON.stringify(BASE_PROJECT, null, 2));
  for (const [relative, text] of Object.entries(SCRIPTS)) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({
      schema: 1,
      text,
      spans: [{ text, seat: "narration", style: [] }],
    }));
  }
  return root;
}

function hooks(overrides = {}) {
  return {
    core: glossaryCore,
    readChapterDocument: async (folder, chapter) =>
      JSON.parse(await fsp.readFile(path.join(folder, chapter.text_path), "utf8")),
    ...overrides,
  };
}

describe("exporting a voice guide", () => {
  let root;

  beforeEach(async () => {
    root = await workspace();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("writes the guide and a marked script for every chapter", async () => {
    const result = await exportVoiceGuide({ folder: root, project: BASE_PROJECT, hooks: hooks() });

    expect(result.files).toEqual([
      "voice-guide.md",
      "01_the-pier_marked.txt",
      "02_home-away_marked.txt",
    ]);
    expect(result.folder).toBe(path.join(root, "export", "voice-guide"));
    expect(fs.readdirSync(result.folder).sort()).toEqual([
      "01_the-pier_marked.txt",
      "02_home-away_marked.txt",
      "voice-guide.md",
    ]);

    const guide = fs.readFileSync(path.join(result.folder, "voice-guide.md"), "utf8");
    expect(guide).toContain("# Voice guide — The Pier");
    expect(guide).toContain("Narrator: R. Vance");
    // Counted from the scripts on disk, not from the stored frequency of 3.
    expect(guide).toContain("| Siobhan | shiv-AWN | Dry. | 2 | 1 |");
    expect(guide).toContain("## Still to decide");
    expect(guide.slice(guide.indexOf("## Still to decide"))).toContain("| Leominster |");
  });

  it("marks the script without changing anything else in it", async () => {
    const result = await exportVoiceGuide({ folder: root, project: BASE_PROJECT, hooks: hooks() });
    const marked = fs.readFileSync(path.join(result.folder, "01_the-pier_marked.txt"), "utf8");
    expect(marked).toBe("Siobhan [shiv-AWN] walked to Leominster.\n\nSiobhan [shiv-AWN] did not look back.\n");
  });

  it("marks every appearance when asked", async () => {
    const result = await exportVoiceGuide({
      folder: root,
      project: BASE_PROJECT,
      frequency: "all",
      hooks: hooks(),
    });
    const marked = fs.readFileSync(path.join(result.folder, "01_the-pier_marked.txt"), "utf8");
    expect(marked.match(/\[shiv-AWN\]/gu)).toHaveLength(2);
  });

  it("exports the rest of the book when one script cannot be read", async () => {
    await fsp.rm(path.join(root, "text", "ch01.json"));
    const result = await exportVoiceGuide({ folder: root, project: BASE_PROJECT, hooks: hooks() });
    expect(result.files).toEqual(["voice-guide.md", "02_home-away_marked.txt"]);
    const guide = fs.readFileSync(path.join(result.folder, "voice-guide.md"), "utf8");
    expect(guide).toContain("Chapters covered: 1");
  });

  it("overwrites a previous export instead of piling up files", async () => {
    await exportVoiceGuide({ folder: root, project: BASE_PROJECT, hooks: hooks() });
    const decided = {
      ...BASE_PROJECT,
      glossary: BASE_PROJECT.glossary.map((entry) =>
        entry.id === "g2" ? { ...entry, respell: "LEM-ster" } : entry),
    };
    const result = await exportVoiceGuide({ folder: root, project: decided, hooks: hooks() });
    expect(fs.readdirSync(result.folder)).toHaveLength(3);
    const guide = fs.readFileSync(path.join(result.folder, "voice-guide.md"), "utf8");
    expect(guide).not.toContain("## Still to decide");
    expect(fs.readFileSync(path.join(result.folder, "02_home-away_marked.txt"), "utf8"))
      .toBe("The road out of Leominster [LEM-ster] was long.\n");
  });

  it("still writes a guide for a book with no chapters", async () => {
    const result = await exportVoiceGuide({
      folder: root,
      project: { ...BASE_PROJECT, chapters: [] },
      hooks: hooks(),
    });
    expect(result.files).toEqual(["voice-guide.md"]);
  });

  it("refuses a folder that is not an absolute path", async () => {
    await expect(exportVoiceGuide({ folder: "export", project: BASE_PROJECT, hooks: hooks() }))
      .rejects.toThrow(/absolute path/u);
  });
});

describe("collectChapterTexts", () => {
  let root;

  beforeEach(async () => {
    root = await workspace();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("reads each script as the plain text it is", async () => {
    const chapters = await collectChapterTexts({ folder: root, project: BASE_PROJECT, hooks: hooks() });
    expect(chapters).toEqual([
      { index: 1, title: "The Pier", text: SCRIPTS["text/ch01.json"] },
      { index: 2, title: "Home / Away", text: SCRIPTS["text/ch02.json"] },
    ]);
  });

  it("skips a chapter that has no script yet", async () => {
    const chapters = await collectChapterTexts({
      folder: root,
      project: {
        ...BASE_PROJECT,
        chapters: [{ id: "ch03", index: 3, title: "Unwritten", author_status: "draft" }],
      },
      hooks: hooks(),
    });
    expect(chapters).toEqual([]);
  });
});
