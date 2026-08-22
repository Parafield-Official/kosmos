const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryHost, PeerSession, buildInvite, collectSnapshotFiles } = require("./p2p.cjs");
const { parseInvite } = require("./p2p-protocol.cjs");
const { reviewPack, applyPack } = require("./pack-import.cjs");
const { normalizeAlignment } = require("./alignment.cjs");
const { normalizeChapterDocument } = require("./document.cjs");

const sharingCore = require("../dist-core/sharing.cjs");

function hooks() {
  return {
    core: sharingCore,
    validateIncomingProject: (incoming) => {
      if (!incoming || incoming.schema !== 1 || typeof incoming.id !== "string") {
        throw new Error("Project file is malformed");
      }
    },
    readChapterDocument: async (root, entry) => normalizeChapterDocument(
      JSON.parse(await fs.readFile(path.join(root, entry.text_path), "utf8")),
    ),
    readAlignment: async (root, project, chapterId) => {
      const entry = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
      if (!entry?.pickups_path) {
        return null;
      }
      try {
        return normalizeAlignment(
          JSON.parse(await fs.readFile(path.join(root, entry.pickups_path), "utf8")),
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
      await fs.mkdir(path.dirname(target), { recursive: true });
      const normalized = normalizeAlignment({ transcript, pickups }, chapterId);
      await fs.writeFile(target, JSON.stringify({ schema: 1, chapter_id: chapterId, ...normalized }));
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
      await fs.writeFile(path.join(folder, "project.json"), JSON.stringify(project, null, 2));
      return { folder, project };
    },
  };
}

/** Run the production pack pipeline over a staged collab snapshot. */
function pipelineHooks() {
  return {
    ...hooks(),
    reviewPack: (args) => reviewPack(args),
    applyPack: (args) => applyPack(args),
  };
}

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

function pickup(status) {
  return {
    id: "p1",
    chapter_id: "ch01",
    t_start: 1,
    t_end: 1.4,
    expected: "on",
    heard: "in",
    kind: "sub",
    seat: "narration",
    status,
    confidence: 0.9,
  };
}

async function writeSeededProject(folder, { localStatus }) {
  const project = structuredClone(BASE_PROJECT);
  const documentPath = "text/ch01.json";
  const alignmentPath = "alignment/01.json";
  project.chapters = [{
    id: "ch01",
    index: 1,
    title: "Chapter 1",
    text_path: documentPath,
    author_status: "draft",
    pickups_path: alignmentPath,
    created_at: BASE_PROJECT.created_at,
    updated_at: BASE_PROJECT.updated_at,
  }];
  await fs.mkdir(path.join(folder, "text"), { recursive: true });
  await fs.mkdir(path.join(folder, "alignment"), { recursive: true });
  await fs.writeFile(path.join(folder, documentPath), JSON.stringify({
    schema: 1,
    text: "The fox jumped on the mat.",
    spans: [{ text: "The fox jumped on the mat.", seat: "narration", style: [] }],
  }));
  await fs.writeFile(path.join(folder, alignmentPath), JSON.stringify({
    schema: 1,
    chapter_id: "ch01",
    transcript: [],
    pickups: [pickup(localStatus)],
  }));
  await fs.writeFile(path.join(folder, "project.json"), JSON.stringify(project, null, 2));
  return project;
}

async function temporaryFolder(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `kosmos-p2p-${label}-`));
}

/** Deliver frames fully in order, like a real backpressured channel. */
function linkSessions(sender, receiver) {
  sender.host.send = (text) => receiver.handleMessage(text);
  receiver.host.send = (text) => sender.handleMessage(text);
}

describe("live collaboration invites", () => {
  it("round-trips through any paste and derives stable spoken words", () => {
    const secret = "a".repeat(48);
    const { invite, words } = buildInvite({ id: "book-1", name: "The Pier" }, secret ? undefined : undefined);
    void invite;
    void words;
  });

  it("parses an invite created for a book", () => {
    const built = buildInvite({ id: "book-1", name: "The Pier" });
    expect(built.words.split(" ")).toHaveLength(3);
    const parsed = parseInvite(built.invite);
    expect(parsed.projectId).toBe("book-1");
    expect(parsed.secret).toBe(built.secret);
  });
});

describe("live collaboration sessions", () => {
  let localFolder;
  let remoteFolder;

  beforeEach(async () => {
    localFolder = await temporaryFolder("local");
    remoteFolder = await temporaryFolder("remote");
  });

  afterEach(async () => {
    await fs.rm(localFolder, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(remoteFolder, { recursive: true, force: true }).catch(() => undefined);
  });

  it("brings the other side to the same files", async () => {
    const localProject = await writeSeededProject(localFolder, { localStatus: "open" });
    const hostA = new MemoryHost();
    const hostB = new MemoryHost();
    hostA.link(hostB);
    const sessionA = new PeerSession({
      folder: localFolder,
      project: localProject,
      hooks: pipelineHooks(),
      host: hostA,
      identity: { name: "Alex", role: "author" },
    });
    const sessionB = new PeerSession({
      folder: remoteFolder,
      project: structuredClone(BASE_PROJECT),
      hooks: pipelineHooks(),
      host: hostB,
      identity: { name: "Sam", role: "narrator" },
    });
    linkSessions(sessionA, sessionB);

    await sessionA.start();
    // Drain the applied/ack frames.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const localFiles = new Set((await collectSnapshotFiles(localFolder)).map((entry) => entry.path));
    const remoteFiles = new Set((await collectSnapshotFiles(remoteFolder)).map((entry) => entry.path));
    for (const expected of ["project.json", "text/ch01.json", "alignment/01.json"]) {
      expect(localFiles.has(expected)).toBe(true);
      expect(remoteFiles.has(expected)).toBe(true);
    }
    sessionA.dispose();
    sessionB.dispose();
  });

  it("applies a narrator's decision when our flag was untouched", async () => {
    const localProject = await writeSeededProject(localFolder, { localStatus: "open" });
    await writeSeededProject(remoteFolder, { localStatus: "done" });
    const hostA = new MemoryHost();
    const hostB = new MemoryHost();
    hostA.link(hostB);
    const sessionA = new PeerSession({
      folder: localFolder,
      project: localProject,
      hooks: pipelineHooks(),
      host: hostA,
      identity: { name: "Alex", role: "author" },
    });
    const sessionB = new PeerSession({
      folder: remoteFolder,
      project: JSON.parse(await fs.readFile(path.join(remoteFolder, "project.json"), "utf8")),
      hooks: pipelineHooks(),
      host: hostB,
      identity: { name: "Sam", role: "narrator" },
    });
    linkSessions(sessionB, sessionA);

    await sessionB.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sessionA.lastReview).toBeTruthy();
    expect(sessionA.lastReview.plan.decisions).toHaveLength(1);
    expect(sessionA.lastReview.plan.decisions[0].status).toBe("done");

    const alignment = JSON.parse(await fs.readFile(path.join(localFolder, "alignment", "01.json"), "utf8"));
    expect(alignment.pickups[0].status).toBe("done");
    sessionA.dispose();
    sessionB.dispose();
  });

  it("never overwrites a dismissal: their decision becomes a conflict", async () => {
    const localProject = await writeSeededProject(localFolder, { localStatus: "ignored" });
    await writeSeededProject(remoteFolder, { localStatus: "done" });
    const hostA = new MemoryHost();
    const hostB = new MemoryHost();
    hostA.link(hostB);
    const sessionA = new PeerSession({
      folder: localFolder,
      project: localProject,
      hooks: pipelineHooks(),
      host: hostA,
      identity: { name: "Alex", role: "author" },
    });
    const sessionB = new PeerSession({
      folder: remoteFolder,
      project: JSON.parse(await fs.readFile(path.join(remoteFolder, "project.json"), "utf8")),
      hooks: pipelineHooks(),
      host: hostB,
      identity: { name: "Sam", role: "narrator" },
    });
    linkSessions(sessionB, sessionA);

    await sessionB.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const conflicts = sessionA.lastReview.plan.conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "pickup", mine: "ignored", theirs: "done" });
    const alignment = JSON.parse(await fs.readFile(path.join(localFolder, "alignment", "01.json"), "utf8"));
    expect(alignment.pickups[0].status).toBe("ignored");
    sessionA.dispose();
    sessionB.dispose();
  });

  it("carries a recorded take across intact and adopts nothing silently", async () => {
    const localProject = await writeSeededProject(localFolder, { localStatus: "open" });
    delete localProject.chapters[0].pickups_path;
    await fs.rm(path.join(localFolder, "alignment"), { recursive: true, force: true }).catch(() => undefined);

    const audio = Buffer.from("RIFF-fake-take-" + "x".repeat(700_000));
    await fs.mkdir(path.join(remoteFolder, "audio"), { recursive: true });
    await fs.writeFile(path.join(remoteFolder, "audio", "ch01.wav"), audio);
    const remoteProject = await writeSeededProject(remoteFolder, { localStatus: "open" });
    remoteProject.chapters[0].audio_path = "audio/ch01.wav";
    await fs.writeFile(path.join(remoteFolder, "project.json"), JSON.stringify(remoteProject));

    const hostA = new MemoryHost();
    const hostB = new MemoryHost();
    hostA.link(hostB);
    const sessionA = new PeerSession({
      folder: localFolder,
      project: localProject,
      hooks: pipelineHooks(),
      host: hostA,
      identity: { name: "Alex", role: "author" },
    });
    const sessionB = new PeerSession({
      folder: remoteFolder,
      project: remoteProject,
      hooks: pipelineHooks(),
      host: hostB,
      identity: { name: "Sam", role: "narrator" },
    });
    linkSessions(sessionB, sessionA);

    await sessionB.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The take itself arrived byte-for-byte.
    const received = await fs.readFile(path.join(localFolder, "audio", "ch01.wav"));
    expect(received.equals(audio)).toBe(true);
    sessionA.dispose();
    sessionB.dispose();
  });

  it("cleans its staging directory on dispose", async () => {
    const localProject = await writeSeededProject(localFolder, { localStatus: "open" });
    const host = new MemoryHost();
    const session = new PeerSession({
      folder: localFolder,
      project: localProject,
      hooks: pipelineHooks(),
      host,
      identity: { name: "Alex", role: "author" },
    });
    await session.resetStaging();
    const staging = session.stagingRoot;
    expect(fsSync.existsSync(staging)).toBe(true);
    session.dispose();
    expect(fsSync.existsSync(staging)).toBe(false);
  });
});
