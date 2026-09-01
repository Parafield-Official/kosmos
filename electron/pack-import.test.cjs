const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");
const { extractArchive } = require("./unzip.cjs");
const { applyPack, findPackProjectRoot, reviewPack } = require("./pack-import.cjs");
const { normalizeAlignment } = require("./alignment.cjs");
const { normalizeChapterDocument } = require("./document.cjs");
const sharingCore = require("../dist-core/sharing.cjs");

const BASE_PROJECT = {
  schema: 1,
  id: "book-1",
  name: "The Pier",
  mode: "solo",
  acx_spec_version: "2026-acx",
  author: "An Author",
  narrator_n1: "A Narrator",
  narrator_n2: "",
  people: [],
  seats: {
    narration: { label: "Narration", color: "#111111" },
    N1: { label: "N1", color: "#222222" },
    N2: { label: "N2", color: "#333333" },
  },
  chapters: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function chapter(overrides) {
  return {
    id: overrides.id,
    index: overrides.index,
    title: overrides.title ?? `Chapter ${overrides.index}`,
    text_path: `text/${overrides.id}.json`,
    author_status: "draft",
    ...overrides,
  };
}

function pickup(overrides) {
  return {
    chapter_id: "ch01",
    t_start: 1,
    t_end: 1.4,
    expected: "dawn",
    heard: "down",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.9,
    ...overrides,
  };
}

/** Write a project folder on disk the way the app lays one out. */
async function writeProjectFolder(root, project, { documents = {}, alignments = {}, audio = {} } = {}) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "project.json"), JSON.stringify(project, null, 2));
  for (const [relative, text] of Object.entries(documents)) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({ schema: 1, text, spans: [{ text, seat: "narration", style: [] }] }));
  }
  for (const [relative, value] of Object.entries(alignments)) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({ schema: 1, ...value }));
  }
  for (const [relative, bytes] of Object.entries(audio)) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, bytes);
  }
  return root;
}

/** Zip a folder the way the app's own share export nests it. */
function zipFolder(folder, archivePath, rootName = "Pack") {
  const payload = {};
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(absolute, name);
      } else {
        payload[name] = new Uint8Array(fs.readFileSync(absolute));
      }
    }
  };
  walk(folder, rootName);
  fs.writeFileSync(archivePath, Buffer.from(zipSync(payload)));
  return archivePath;
}

function hooks() {
  return {
    core: sharingCore,
    validateIncomingProject: (incoming) => {
      if (!incoming || incoming.schema !== 1 || typeof incoming.id !== "string") {
        throw new Error("Project file is malformed");
      }
    },
    readChapterDocument: async (root, entry) => normalizeChapterDocument(
      JSON.parse(await fsp.readFile(path.join(root, entry.text_path), "utf8")),
    ),
    readAlignment: async (root, project, chapterId) => {
      const entry = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
      if (!entry?.pickups_path) {
        return null;
      }
      try {
        return normalizeAlignment(
          JSON.parse(await fsp.readFile(path.join(root, entry.pickups_path), "utf8")),
          chapterId,
        );
      } catch (error) {
        if (error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    saveAlignment: async (folder, project, chapterId, pickups, transcript) => {
      const entry = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
      const relative = entry.pickups_path || `alignment/${String(entry.index).padStart(2, "0")}.json`;
      const target = path.join(folder, relative);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const normalized = normalizeAlignment({ transcript, pickups }, chapterId);
      await fsp.writeFile(target, JSON.stringify({ schema: 1, chapter_id: chapterId, ...normalized }));
      return {
        folder,
        project: {
          ...project,
          chapters: project.chapters.map((candidate) => candidate.id === chapterId
            ? { ...candidate, pickups_path: relative }
            : candidate),
        },
      };
    },
    saveProject: async (folder, project) => {
      await fsp.writeFile(path.join(folder, "project.json"), JSON.stringify(project, null, 2));
      return { folder, project };
    },
  };
}

async function stage(archivePath, workspace) {
  const destination = path.join(workspace, "staging");
  await extractArchive({ archivePath, destination });
  return destination;
}

describe("importing a collaborator pack", () => {
  let workspace;

  beforeEach(async () => {
    workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "kosmos-pack-"));
  });

  async function narratorReturnPack({ localAlignment = null, localAudio = false } = {}) {
    const localProject = {
      ...BASE_PROJECT,
      chapters: [chapter({
        id: "ch01",
        index: 1,
        ...(localAudio ? { audio_path: "audio/mine.wav" } : {}),
        ...(localAlignment ? { pickups_path: "alignment/01.json" } : {}),
      })],
    };
    const local = await writeProjectFolder(path.join(workspace, "author"), localProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
      alignments: localAlignment ? { "alignment/01.json": localAlignment } : {},
      audio: localAudio ? { "audio/mine.wav": Buffer.from("author take") } : {},
    });

    const theirProject = {
      ...BASE_PROJECT,
      updated_at: "2026-03-01T00:00:00.000Z",
      chapters: [chapter({
        id: "ch01",
        index: 1,
        audio_path: "audio/01.wav",
        pickups_path: "alignment/01.json",
        author_status: "needs_pickup",
        updated_at: "2026-03-01T00:00:00.000Z",
      })],
      chapter_notes: [{
        id: "note-1",
        chapter_id: "ch01",
        author: "A Narrator",
        body: "Second take on the name.",
        created_at: "2026-03-01T00:00:00.000Z",
      }],
      glossary: [{ id: "g1", spelling: "Leominster", respell: "LEM-ster", frequency: 2, source: "user" }],
    };
    const theirs = await writeProjectFolder(path.join(workspace, "narrator"), theirProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
      alignments: {
        "alignment/01.json": {
          chapter_id: "ch01",
          transcript: [{ text: "the", start: 0, end: 0.2, confidence: 0.9 }],
          pickups: [pickup({ id: "p1", status: "done", note: "fixed on the second take" })],
        },
      },
      audio: { "audio/01.wav": Buffer.from("narrator take") },
    });
    const archivePath = zipFolder(theirs, path.join(workspace, "pack.zip"));
    return { local, localProject, archivePath };
  }

  it("reports what a narrator's return pack would bring, before touching anything", async () => {
    const { local, localProject, archivePath } = await narratorReturnPack();
    const stagingPath = await stage(archivePath, workspace);
    const review = await reviewPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });

    expect(review.plan.audioToAdopt).toHaveLength(1);
    expect(review.plan.audioToAdopt[0]).toMatchObject({ relativePath: "audio/01.wav", withAlignment: true });
    expect(review.plan.notesToAdd).toHaveLength(1);
    expect(review.plan.glossaryToAdd).toHaveLength(1);
    expect(review.plan.statusChanges).toHaveLength(1);
    expect(review.summary).toContain("Brings");
    // Nothing was written yet.
    await expect(fsp.access(path.join(local, "audio", "01.wav"))).rejects.toThrow();
  });

  it("copies the recording, the proof pass, the note and the pronunciation in", async () => {
    const { local, localProject, archivePath } = await narratorReturnPack();
    const stagingPath = await stage(archivePath, workspace);
    const result = await applyPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });

    expect(result.applied).toMatchObject({ recordings: 1, notes: 1, glossary: 1, statuses: 1 });
    expect(await fsp.readFile(path.join(local, "audio", "01.wav"), "utf8")).toBe("narrator take");
    const saved = JSON.parse(await fsp.readFile(path.join(local, "project.json"), "utf8"));
    expect(saved.chapters[0].audio_path).toBe("audio/01.wav");
    expect(saved.chapters[0].pickups_path).toBe("alignment/01.json");
    expect(saved.chapters[0].author_status).toBe("needs_pickup");
    expect(saved.chapter_notes).toHaveLength(1);
    expect(saved.glossary[0].respell).toBe("LEM-ster");
    const alignment = JSON.parse(await fsp.readFile(path.join(local, "alignment", "01.json"), "utf8"));
    expect(alignment.pickups[0]).toMatchObject({ id: "p1", status: "done", note: "fixed on the second take" });
    expect(alignment.transcript).toHaveLength(1);
  });

  it("keeps our recording and reports the disagreement instead of overwriting it", async () => {
    const { local, localProject, archivePath } = await narratorReturnPack({ localAudio: true });
    const stagingPath = await stage(archivePath, workspace);
    const review = await reviewPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });
    expect(review.plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "audio", mine: "audio/mine.wav", theirs: "audio/01.wav" }),
    ]));

    await applyPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });
    expect(await fsp.readFile(path.join(local, "audio", "mine.wav"), "utf8")).toBe("author take");
    await expect(fsp.access(path.join(local, "audio", "01.wav"))).rejects.toThrow();
  });

  it("takes their decision on a flag we had not touched", async () => {
    const { local, localProject, archivePath } = await narratorReturnPack({
      localAudio: true,
      localAlignment: {
        chapter_id: "ch01",
        transcript: [{ text: "the", start: 0, end: 0.2, confidence: 0.9 }],
        pickups: [pickup({ id: "p1" })],
      },
    });
    const stagingPath = await stage(archivePath, workspace);
    const result = await applyPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });

    expect(result.applied.decisions).toBe(1);
    expect(result.applied.decidedChapters).toBe(1);
    const alignment = JSON.parse(await fsp.readFile(path.join(local, "alignment", "01.json"), "utf8"));
    expect(alignment.pickups[0]).toMatchObject({ status: "done", note: "fixed on the second take" });
  });

  it("keeps our decision on a flag we already handled differently", async () => {
    const { local, localProject, archivePath } = await narratorReturnPack({
      localAudio: true,
      localAlignment: {
        chapter_id: "ch01",
        transcript: [{ text: "the", start: 0, end: 0.2, confidence: 0.9 }],
        pickups: [pickup({ id: "p1", status: "ignored", note: "read is fine" })],
      },
    });
    const stagingPath = await stage(archivePath, workspace);
    const result = await applyPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });

    expect(result.applied.decisions).toBe(0);
    expect(result.applied.conflicts).toBeGreaterThan(0);
    const alignment = JSON.parse(await fsp.readFile(path.join(local, "alignment", "01.json"), "utf8"));
    expect(alignment.pickups[0]).toMatchObject({ status: "ignored", note: "read is fine" });
  });

  it("says the script no longer matches when their text has moved on", async () => {
    const localProject = { ...BASE_PROJECT, chapters: [chapter({ id: "ch01", index: 1 })] };
    const local = await writeProjectFolder(path.join(workspace, "author"), localProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
    });
    const theirProject = { ...BASE_PROJECT, chapters: [chapter({ id: "ch01", index: 1 })] };
    const theirs = await writeProjectFolder(path.join(workspace, "narrator"), theirProject, {
      documents: { "text/ch01.json": "The pier at dusk, rewritten." },
    });
    const stagingPath = await stage(zipFolder(theirs, path.join(workspace, "pack.zip")), workspace);
    const review = await reviewPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });
    expect(review.plan.conflicts).toEqual([
      { kind: "script", chapterId: "ch01", chapterTitle: "Chapter 1" },
    ]);
  });

  it("refuses a pack from a different book", async () => {
    const localProject = { ...BASE_PROJECT, chapters: [chapter({ id: "ch01", index: 1 })] };
    const local = await writeProjectFolder(path.join(workspace, "author"), localProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
    });
    const theirs = await writeProjectFolder(
      path.join(workspace, "other"),
      { ...BASE_PROJECT, id: "book-2", chapters: [chapter({ id: "ch01", index: 1 })] },
      { documents: { "text/ch01.json": "Another book." } },
    );
    const stagingPath = await stage(zipFolder(theirs, path.join(workspace, "pack.zip")), workspace);
    await expect(reviewPack({ folder: local, project: localProject, stagingPath, hooks: hooks() }))
      .rejects.toThrow(/different book/i);
  });

  it("refuses a zip that is not a project at all", async () => {
    const archivePath = path.join(workspace, "notes.zip");
    fs.writeFileSync(archivePath, Buffer.from(zipSync({ "notes/hello.txt": strToU8("hi") })));
    const stagingPath = await stage(archivePath, workspace);
    await expect(reviewPack({
      folder: workspace,
      project: BASE_PROJECT,
      stagingPath,
      hooks: hooks(),
    })).rejects.toThrow(/does not contain a Kosmos project/i);
  });

  it("finds the project when a re-zip nests it deeper", async () => {
    const theirs = await writeProjectFolder(
      path.join(workspace, "narrator"),
      { ...BASE_PROJECT, chapters: [] },
      {},
    );
    const archivePath = path.join(workspace, "nested.zip");
    const payload = {};
    for (const entry of fs.readdirSync(theirs)) {
      payload[`Sent/To Me/Pack/${entry}`] = new Uint8Array(fs.readFileSync(path.join(theirs, entry)));
    }
    fs.writeFileSync(archivePath, Buffer.from(zipSync(payload)));
    const stagingPath = await stage(archivePath, workspace);
    const root = await findPackProjectRoot(stagingPath);
    expect(fs.existsSync(path.join(root, "project.json"))).toBe(true);
  });

  it("applies an identical pack without changing anything", async () => {
    const localProject = {
      ...BASE_PROJECT,
      chapters: [chapter({ id: "ch01", index: 1, audio_path: "audio/01.wav" })],
    };
    const local = await writeProjectFolder(path.join(workspace, "author"), localProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
      audio: { "audio/01.wav": Buffer.from("take") },
    });
    const theirs = await writeProjectFolder(path.join(workspace, "narrator"), localProject, {
      documents: { "text/ch01.json": "The pier at dawn." },
      audio: { "audio/01.wav": Buffer.from("take") },
    });
    const stagingPath = await stage(zipFolder(theirs, path.join(workspace, "pack.zip")), workspace);
    const result = await applyPack({ folder: local, project: localProject, stagingPath, hooks: hooks() });
    expect(result.applied).toMatchObject({ recordings: 0, decisions: 0, notes: 0, glossary: 0, statuses: 0 });
    expect(fs.readdirSync(path.join(local, "audio"))).toEqual(["01.wav"]);
  });
});
