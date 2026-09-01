/**
 * Send a pack out of the app and bring it back in, through the real code.
 *
 * `electron/pack-import.test.cjs` builds its archives with fflate by hand, so
 * it proves the merge is right but not that the archive the app actually writes
 * is the archive the app can actually read. That seam is where a collaboration
 * feature fails in the field: the narrator's zip arrives and nothing opens it.
 *
 * Here the pack is written by the app's own streaming ZIP writer, opened by an
 * unrelated tool (Python's zipfile) to prove a collaborator's machine can read
 * it, and then imported by the app's own extractor and merge planner. Every
 * claim is checked against the bytes on disk afterwards.
 *
 * Usage: node scripts/verify-collab.mjs [--keep]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { zipProjectFolder } = require(path.join(root, "electron/share.cjs"));
const { extractArchive } = require(path.join(root, "electron/unzip.cjs"));
const { reviewPack, applyPack, findPackProjectRoot } = require(path.join(root, "electron/pack-import.cjs"));
const { normalizeAlignment } = require(path.join(root, "electron/alignment.cjs"));
const { normalizeChapterDocument } = require(path.join(root, "electron/document.cjs"));
const sharingCore = require(path.join(root, "dist-core/sharing.cjs"));

const keep = process.argv.includes("--keep");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kosmos-collab-"));
const failures = [];
let checks = 0;

function check(claim, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`ok    ${claim}`);
    return;
  }
  failures.push(claim);
  console.log(`FAIL  ${claim}${detail ? `\n        ${detail}` : ""}`);
}

const BASE = {
  schema: 1,
  id: "book-verify",
  name: "The Long Pier",
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
  glossary: [],
  chapter_notes: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

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

async function writeProject(folder, project, { documents = {}, alignments = {}, audio = {} }) {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, "project.json"), JSON.stringify(project, null, 2));
  for (const [relative, text] of Object.entries(documents)) {
    const target = path.join(folder, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({
      schema: 1,
      text,
      spans: [{ text, seat: "narration", style: [] }],
    }));
  }
  for (const [relative, value] of Object.entries(alignments)) {
    const target = path.join(folder, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({ schema: 1, ...value }));
  }
  for (const [relative, source] of Object.entries(audio)) {
    const target = path.join(folder, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
  }
  return folder;
}

/** Every file in a project folder, the way the app collects them to share. */
function collectFiles(folder, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectFiles(folder, relative));
    } else {
      found.push(relative);
    }
  }
  return found;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hooks() {
  return {
    core: sharingCore,
    validateIncomingProject: (incoming) => {
      if (!incoming || incoming.schema !== 1 || typeof incoming.id !== "string") {
        throw new Error("Project file is malformed");
      }
    },
    readChapterDocument: async (folder, entry) => normalizeChapterDocument(
      JSON.parse(await fsp.readFile(path.join(folder, entry.text_path), "utf8")),
    ),
    readAlignment: async (folder, project, chapterId) => {
      const entry = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
      if (!entry?.pickups_path) {
        return null;
      }
      try {
        return normalizeAlignment(
          JSON.parse(await fsp.readFile(path.join(folder, entry.pickups_path), "utf8")),
          chapterId,
        );
      } catch (error) {
        if (error?.code === "ENOENT") {
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
      await fsp.writeFile(target, JSON.stringify({
        schema: 1,
        chapter_id: chapterId,
        ...normalizeAlignment({ transcript, pickups }, chapterId),
      }));
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

const exampleAudio = path.join(root, "public", "examples", "proof", "on_vs_in.wav");

// The author's copy: two chapters written, no recordings yet, one name in the
// glossary nobody has answered, and one pickup the author already dismissed.
const authorProject = {
  ...BASE,
  chapters: [
    {
      id: "ch01",
      index: 1,
      title: "The Pier",
      text_path: "text/ch01.json",
      pickups_path: "alignment/01.json",
      author_status: "draft",
    },
    { id: "ch02", index: 2, title: "The Letter", text_path: "text/ch02.json", author_status: "draft" },
  ],
  glossary: [{ id: "g1", spelling: "Leominster", respell: "", frequency: 3, source: "auto" }],
};
const author = await writeProject(path.join(workspace, "The Long Pier.booth"), authorProject, {
  documents: {
    "text/ch01.json": "The pier at dawn, and the Leominster road beyond it.",
    "text/ch02.json": "He read the letter twice.",
  },
  alignments: {
    "alignment/01.json": {
      chapter_id: "ch01",
      transcript: [{ text: "the", start: 0, end: 0.2, confidence: 0.9 }],
      pickups: [
        pickup({ id: "p1", status: "open" }),
        pickup({ id: "p2", expected: "beyond", heard: "behind", t_start: 2, t_end: 2.4, status: "ignored" }),
      ],
    },
  },
  audio: {},
});

// The narrator's copy of the same book, recorded and proofed: takes for both
// chapters, decisions on the author's pickups, a note, and the name answered.
const narratorProject = {
  ...BASE,
  updated_at: "2026-03-01T00:00:00.000Z",
  chapters: [
    {
      id: "ch01",
      index: 1,
      title: "The Pier",
      text_path: "text/ch01.json",
      pickups_path: "alignment/01.json",
      audio_path: "audio/01.wav",
      author_status: "needs_pickup",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "ch02",
      index: 2,
      title: "The Letter",
      text_path: "text/ch02.json",
      audio_path: "audio/02.wav",
      author_status: "draft",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
  ],
  glossary: [{
    id: "g1",
    spelling: "Leominster",
    respell: "LEM-ster",
    voice_note: "Local: clipped, flat a",
    frequency: 3,
    source: "user",
  }],
  chapter_notes: [{
    id: "note-1",
    chapter_id: "ch01",
    author: "A Narrator",
    body: "Second take on the name; the first was wrong.",
    created_at: "2026-03-01T00:00:00.000Z",
  }],
};
const narrator = await writeProject(path.join(workspace, "The Long Pier narrator.booth"), narratorProject, {
  documents: {
    "text/ch01.json": "The pier at dawn, and the Leominster road beyond it.",
    "text/ch02.json": "He read the letter twice.",
  },
  alignments: {
    "alignment/01.json": {
      chapter_id: "ch01",
      transcript: [{ text: "the", start: 0, end: 0.2, confidence: 0.9 }],
      pickups: [
        pickup({ id: "p1", status: "done", note: "re-recorded" }),
        pickup({ id: "p2", expected: "beyond", heard: "behind", t_start: 2, t_end: 2.4, status: "done" }),
      ],
    },
  },
  audio: { "audio/01.wav": exampleAudio, "audio/02.wav": exampleAudio },
});
// A working folder collects things a collaborator must not receive: who this
// machine is, Finder junk, and the leftovers of an interrupted write.
await fsp.writeFile(path.join(narrator, "me.json"), JSON.stringify({ personName: "A Narrator", role: "narrator" }));
await fsp.writeFile(path.join(narrator, ".DS_Store"), "finder");
await fsp.writeFile(path.join(narrator, "alignment", "01.json.tmp-91"), "half-written");

// 1. Write the pack with the app's own streaming ZIP writer.
const relativePaths = sharingCore.planSharePaths(narratorProject, collectFiles(narrator), { lightPack: false });
const archivePath = path.join(workspace, "return-pack.zip");
const written = await zipProjectFolder({ folder: narrator, outputPath: archivePath, relativePaths });
check("the app writes a pack file", fs.existsSync(archivePath) && fs.statSync(archivePath).size > 0);
check(
  "the pack reports the files it holds",
  written.fileCount === relativePaths.length,
  `reported ${written.fileCount}, planned ${relativePaths.length}`,
);
check(
  "who this machine is, Finder junk and half-written files stay home",
  !relativePaths.some((relative) =>
    relative === "me.json" || relative === ".DS_Store" || relative.includes(".tmp-")),
  relativePaths.join(", "),
);

// 2. Prove an unrelated tool can open it. A collaborator's machine will not be
// running our extractor.
const listed = execFileSync("python3", [
  "-c",
  [
    "import sys, zipfile",
    "z = zipfile.ZipFile(sys.argv[1])",
    "bad = z.testzip()",
    "assert bad is None, bad",
    "print('\\n'.join(sorted(z.namelist())))",
  ].join("\n"),
  archivePath,
], { encoding: "utf8" }).trim().split("\n");
check("Python's zipfile reads the archive without complaint", listed.length === relativePaths.length + 0
  || listed.length >= relativePaths.length, listed.join(", "));
check(
  "every shared file is in the archive, under one folder",
  relativePaths.every((relative) => listed.some((name) => name.endsWith(`/${relative}`)))
  && new Set(listed.map((name) => name.split("/")[0])).size === 1,
  listed.join(", "),
);
check(
  "the recording survives the round trip byte for byte",
  execFileSync("python3", [
    "-c",
    [
      "import hashlib, sys, zipfile",
      "z = zipfile.ZipFile(sys.argv[1])",
      "name = [n for n in z.namelist() if n.endswith('audio/01.wav')][0]",
      "print(hashlib.sha256(z.read(name)).hexdigest())",
    ].join("\n"),
    archivePath,
  ], { encoding: "utf8" }).trim() === sha256(exampleAudio),
);

// 3. Import it with the app's own extractor and merge planner.
const staging = path.join(workspace, "staging");
await extractArchive({ archivePath, destination: staging });
const packRoot = await findPackProjectRoot(staging);
check("the importer finds the project inside the pack", Boolean(packRoot), String(packRoot));

const review = await reviewPack({ folder: author, project: authorProject, stagingPath: staging, hooks: hooks() });
check("the review names the book it came from", review.incomingName === "The Long Pier", review.incomingName);
check(
  "the review offers both recordings",
  review.plan.audioToAdopt.length === 2,
  JSON.stringify(review.plan.audioToAdopt),
);
check(
  "the review keeps the author's own dismissal as a conflict, not a silent overwrite",
  review.plan.conflicts.some((conflict) => conflict.kind === "pickup" && conflict.pickupId === "p2"),
  JSON.stringify(review.plan.conflicts),
);
check(
  "the review reads before it writes",
  !fs.existsSync(path.join(author, "audio", "01.wav")),
);
check("the review says what it will do in plain words", /recording|note|name/i.test(review.summary), review.summary);

const applied = await applyPack({ folder: author, project: authorProject, stagingPath: staging, hooks: hooks() });

// 4. Check the claims against the bytes on disk.
const merged = JSON.parse(await fsp.readFile(path.join(author, "project.json"), "utf8"));
check(
  "the takes are on disk, byte for byte",
  sha256(path.join(author, "audio", "01.wav")) === sha256(exampleAudio)
  && sha256(path.join(author, "audio", "02.wav")) === sha256(exampleAudio),
);
check(
  "the chapters point at the takes that arrived",
  merged.chapters[0].audio_path === "audio/01.wav" && merged.chapters[1].audio_path === "audio/02.wav",
  JSON.stringify(merged.chapters.map((entry) => entry.audio_path)),
);
check(
  "the narrator's note is in the book",
  (merged.chapter_notes ?? []).some((note) => note.body.startsWith("Second take on the name")),
  JSON.stringify(merged.chapter_notes),
);
check(
  "the name the narrator answered is filled in, with the voice note",
  merged.glossary[0].respell === "LEM-ster" && merged.glossary[0].voice_note === "Local: clipped, flat a",
  JSON.stringify(merged.glossary),
);
const mergedAlignment = JSON.parse(await fsp.readFile(path.join(author, "alignment", "01.json"), "utf8"));
const first = mergedAlignment.pickups.find((entry) => entry.id === "p1");
const second = mergedAlignment.pickups.find((entry) => entry.id === "p2");
check("a pickup the author had not touched takes the narrator's decision", first?.status === "done", JSON.stringify(first));
check(
  "a pickup the author had already dismissed keeps the author's decision",
  second?.status === "ignored",
  JSON.stringify(second),
);
check(
  "the import reports what it changed",
  applied.applied.recordings === 2
  && applied.applied.notes >= 1
  && applied.applied.glossary >= 1
  && applied.applied.conflicts >= 1,
  JSON.stringify(applied.applied),
);

// 5. Importing the same pack twice must not double anything up.
const secondStaging = path.join(workspace, "staging-again");
await extractArchive({ archivePath, destination: secondStaging });
const again = await applyPack({
  folder: author,
  project: merged,
  stagingPath: secondStaging,
  hooks: hooks(),
});
const twice = JSON.parse(await fsp.readFile(path.join(author, "project.json"), "utf8"));
check(
  "importing the same pack again changes nothing",
  (twice.chapter_notes ?? []).length === (merged.chapter_notes ?? []).length
  && twice.glossary[0].respell === "LEM-ster",
  JSON.stringify({ notes: twice.chapter_notes?.length, applied: again.applied }),
);

if (!keep) {
  fs.rmSync(workspace, { recursive: true, force: true });
} else {
  console.log(`\nWorkspace kept at ${workspace}`);
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error(`\nFailed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("A pack written by the app comes back in with the right merge.");
