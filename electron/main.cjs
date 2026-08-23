const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, systemPreferences } = require("electron");
const { findModel, findLiveModel, transcribeAudio } = require("./asr.cjs");
const { PersistentWhisperServer } = require("./asr-server.cjs");
const { PersistentParakeetServer } = require("./parakeet-server.cjs");
const { PersistentParakeetLive } = require("./parakeet-live.cjs");
const { MODEL, downloadModel, modelStatus, modelStatusForFile } = require("./model.cjs");
const { zipProjectFolder } = require("./share.cjs");
const { strToU8, zipSync } = require("fflate");
const { extractArchive } = require("./unzip.cjs");
const { applyPack, reviewPack } = require("./pack-import.cjs");
const { CollabDesk } = require("./collab.cjs");
const { loadTurnSecrets, mintIceServers } = require("./turn.cjs");
const { exportVoiceGuide: exportVoiceGuideFiles } = require("./voice-guide.cjs");
const { loadIdentity, saveIdentity } = require("./identity.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const { runCommand } = require("./process.cjs");
const { convertWithMarkItDown } = require("./markitdown.cjs");
const { isMicrophonePermission, ensureMicrophoneAccess } = require("./media-access.cjs");
const {
  assertProjectFolder,
  ensureProjectDirectory,
  ensureProjectRoot,
  projectAudioPath,
  projectAssetPath,
} = require("./project-path.cjs");
const { normalizePunchBounds } = require("./punch.cjs");
const { normalizeAlignment } = require("./alignment.cjs");
const { decodeLiveAudioPayload } = require("./live-audio.cjs");
const { createLiveTape } = require("./live-tape.cjs");
const { assertRecorderPcmBounds } = require("./recording-wav.cjs");
const { createAppUpdater, RELEASE_PAGE } = require("./app-update.cjs");
const { normalizeChapterDocument } = require("./document.cjs");
const { collectBookProof, applyPickupDecision, applyPickupUpdates } = require("./book-proof.cjs");
const {
  assertDuetMixRouting,
  chapterAfterDuetRoutingChange,
  chapterAfterSoloMode,
  chapterAfterSeatChange,
  chapterHasAudio,
  resetChapterAudioFields,
  resetChapterProofFields,
  seatForProjectMode,
} = require("./chapter-state.cjs");
const {
  audioDurationFromPcm,
  finitePositive,
  inferMp3Vbr,
  normalizeAudioFormat,
  normalizeProbeMetadata,
} = require("./audio-metadata.cjs");
const {
  decodeAudioRequest,
  encodeAudioRequest,
  parseByteRange,
  streamResponse,
} = require("./audio-stream.cjs");
const {
  assetStamp,
  copyFileAtomic,
  copyFileUnique,
  nextAvailablePath,
  replaceDirectory,
  writeFileAtomic,
  writeJsonAtomic,
} = require("./file-utils.cjs");

const isDevelopment = !app.isPackaged;
const MAX_AUDIO_SECONDS = 2 * 60 * 60;
const MAX_PCM_OUTPUT_BYTES = 1_500_000_000;
const MAX_RECORDER_WAV_BYTES = 1_500_000_000;
const MAX_ROOM_TEST_SECONDS = 60;
const MAX_MANUSCRIPT_BYTES = 200_000_000;
const FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;
let pronunciationLexicon = null;
const liveAsrServer = new PersistentWhisperServer();
const liveFollowServer = new PersistentParakeetServer();
const liveFollowStream = new PersistentParakeetLive();
const boothTape = createLiveTape();
let boothTapeContext = null;

// Words leave the follow model on its own schedule, so broadcast them the
// moment they appear rather than attaching them to an audio request.
liveFollowStream.onWords((words) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("live:words", { words });
    }
  }
});

// Kosmos is a product rename, not a data migration. Keep the established
// application-data folder so existing model caches, identities, and recent
// project state remain available after the update.
app.setPath("userData", path.join(app.getPath("appData"), "booth-desk"));

protocol.registerSchemesAsPrivileged([{
  scheme: "booth-audio",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

const DEFAULT_SEATS = {
  narration: { label: "Narration", color: "#888888" },
  N1: { label: "N1", color: "#c45c26" },
  N2: { label: "N2", color: "#2c4c7c" },
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: "Kosmos",
    backgroundColor: "#f3eee6",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  if (isDevelopment) {
    void window.loadURL("http://127.0.0.1:5173");
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

async function createProjectFolder() {
  const result = await dialog.showOpenDialog({
    title: "Choose a folder for the Kosmos project",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folder = result.filePaths[0];
  const projectPath = path.join(folder, "project.json");
  let projectExists = true;
  try {
    await fs.access(projectPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      projectExists = false;
    } else {
      throw error;
    }
  }

  if (projectExists) {
    const opened = await readProjectFolder(folder);
    await rememberRecentProject(folder);
    return opened;
  }

  const now = new Date().toISOString();
  const project = {
    schema: 1,
    id: `project-${crypto.randomUUID()}`,
    name: path.basename(folder) || "Untitled project",
    mode: "solo",
    acx_spec_version: "2026-acx",
    author: "",
    narrator_n1: "",
    narrator_n2: "",
    people: [],
    seats: {
      narration: { label: "Narration", color: "#888888" },
      N1: { label: "N1", color: "#c45c26" },
      N2: { label: "N2", color: "#2c4c7c" },
    },
    chapters: [],
    glossary: [],
    chapter_notes: [],
    punch_recordings: [],
    settings: {
      proof_sensitivity: "default",
      pause_threshold_seconds: 4,
      acx_target_rms_dbfs: -20,
      spec_preset_id: "acx",
      proof_confidence_floor: 0.35,
      suppressed_words: [],
      teleprompter_theme: "cream",
      teleprompter_font_size: 28,
      teleprompter_preset_version: 2,
    },
    created_at: now,
    updated_at: now,
  };
  await ensureProjectLayout(folder);
  await writeJsonAtomic(projectPath, project);
  await writeBundledSpec(folder);
  await rememberRecentProject(folder);
  return { folder, project };
}

async function openProjectFolder() {
  const result = await dialog.showOpenDialog({
    title: "Open a Kosmos project",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folder = result.filePaths[0];
  const opened = await readProjectFolder(folder);
  const refreshed = await refreshGlossaryOnOpen(opened);
  await rememberRecentProject(folder);
  return refreshed;
}

async function readProjectFolder(folder) {
  await assertProjectFolder(folder);
  const project = JSON.parse(await fs.readFile(projectAssetPath(folder, "project.json"), "utf8"));
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("project.json must contain an object");
  }
  for (const [field, fallback] of [
    ["chapters", []],
    ["people", []],
    ["glossary", []],
    ["chapter_notes", []],
    ["punch_recordings", []],
  ]) {
    if (project[field] !== undefined && !Array.isArray(project[field])) {
      throw new Error(`project.json ${field} must be an array`);
    }
    if (project[field] === undefined) {
      project[field] = fallback;
    }
  }
  if (project.seats !== undefined && (!project.seats || typeof project.seats !== "object" || Array.isArray(project.seats))) {
    throw new Error("project.json seats must be an object");
  }
  if (project.mode !== undefined && project.mode !== "solo" && project.mode !== "duet") {
    throw new Error("project.json has an invalid mode");
  }
  project.chapters.forEach((chapter, index) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) {
      throw new Error(`project.json chapter ${index + 1} must be an object`);
    }
  });
  const chapters = await Promise.all((Array.isArray(project.chapters) ? project.chapters : []).map(async (chapter) => {
    if (!chapter.pickups_path) {
      return chapter;
    }
    try {
      const alignment = normalizeAlignment(
        JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.pickups_path), "utf8")),
        chapter.id,
      );
      return {
        ...chapter,
        open_pickups: alignment.pickups.filter((pickup) => pickup.status === "open").length,
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return chapter;
      }
      throw error;
    }
  }));
  const normalized = {
    ...project,
    mode: project.mode === "duet" ? "duet" : "solo",
    people: project.people,
    seats: { ...DEFAULT_SEATS, ...(project.seats ?? {}) },
    chapters: chapters.map((chapter) => ({
      ...chapter,
      author_status: chapter.author_status ?? "draft",
    })),
    glossary: Array.isArray(project.glossary) ? project.glossary : [],
    chapter_notes: Array.isArray(project.chapter_notes) ? project.chapter_notes : [],
    punch_recordings: Array.isArray(project.punch_recordings) ? project.punch_recordings : [],
    settings: normalizeProjectSettings(project.settings),
  };
  loadCoreModule("project").validateProject(normalized);
  return { folder, project: normalized };
}

async function saveProjectFolder(folder, project) {
  await assertProjectEnvelope(folder, project);
  const persistedProject = {
    ...project,
    settings: normalizeProjectSettings(project.settings),
  };
  loadCoreModule("project").validateProject(persistedProject);
  await writeJsonAtomic(projectAssetPath(folder, "project.json"), persistedProject);
  await rememberRecentProject(folder);
  return { folder, project: persistedProject };
}

/**
 * IPC callers send the current project snapshot with every action. Validate
 * it before following any referenced path, and bind it to the selected folder
 * so a stale/forged snapshot cannot write project B's references into project
 * A. The folder is still the source of truth for the final save.
 */
async function assertProjectEnvelope(folder, project) {
  const root = await assertProjectFolder(folder);
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("Project payload must be an object");
  }
  const candidate = {
    ...project,
    settings: normalizeProjectSettings(project.settings),
  };
  loadCoreModule("project").validateProject(candidate);
  const diskProject = JSON.parse(await fs.readFile(projectAssetPath(root, "project.json"), "utf8"));
  if (!diskProject || typeof diskProject.id !== "string" || diskProject.id !== candidate.id) {
    throw new Error("Project payload does not belong to the selected project folder");
  }
  return root;
}

async function importTextFile(folder, project) {
  await assertProjectEnvelope(folder, project);
  const result = await dialog.showOpenDialog({
    title: "Import a chapter manuscript",
    properties: ["openFile"],
    filters: [{ name: "Manuscript", extensions: ["txt", "md", "markdown", "docx", "epub", "pdf"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const sourcePath = result.filePaths[0];
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > MAX_MANUSCRIPT_BYTES) {
    throw new Error(`Manuscript files must be regular files smaller than ${MAX_MANUSCRIPT_BYTES} bytes.`);
  }
  const manuscriptCore = loadCoreModule("manuscript");
  const extension = path.extname(sourcePath).toLowerCase();
  let imported;
  const convertedMarkdown = await convertWithMarkItDown({
    sourcePath,
    extension,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    requireBundled: app.isPackaged,
  });
  if (convertedMarkdown) {
    imported = {
      ...manuscriptCore.fromPlainText(convertedMarkdown, "md"),
      format: extension.replace(/^\./u, ""),
    };
  } else if (extension === ".pdf") {
    let extracted;
    try {
      extracted = await runCommand(resolveRuntimeBinary({
        name: "pdftotext",
        envVar: "PDFTOTEXT_PATH",
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      }), ["-layout", sourcePath, "-"], { maxOutputBytes: 100_000_000 });
    } catch (error) {
      throw new Error(`Could not extract a PDF text layer. Scanned PDFs are not supported (${String(error)}).`);
    }
    imported = manuscriptCore.fromPlainText(extracted.toString("utf8"), "pdf");
  } else {
    const bytes = await fs.readFile(sourcePath);
    imported = manuscriptCore.importManuscriptBytes(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      path.extname(sourcePath),
    );
  }
  return writeImportedManuscript(folder, project, sourcePath, imported);
}

async function writePastedText(folder, project, title, text) {
  await assertProjectEnvelope(folder, project);
  if (typeof title !== "string" || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("A chapter needs a title and some text");
  }
  const manuscriptCore = loadCoreModule("manuscript");
  const parsed = manuscriptCore.parsePastedChapter(text, title);
  const savedTitle = /^Chapter\s+\d+$/iu.test(title.trim()) ? parsed.title : title.trim();
  return writeChapterText(folder, project, savedTitle, parsed.text);
}

async function loadProofExample(folder, project) {
  await assertProjectEnvelope(folder, project);
  const roots = [
    path.join(app.getAppPath(), "public", "examples", "proof"),
    path.join(app.getAppPath(), "dist", "examples", "proof"),
    path.join(process.resourcesPath, "examples", "proof"),
  ];
  let sourceRoot = null;
  for (const candidate of roots) {
    try {
      await fs.access(path.join(candidate, "on_vs_in.wav"));
      sourceRoot = candidate;
      break;
    } catch {
      // Try the next packaged/development location.
    }
  }
  if (!sourceRoot) {
    throw new Error("The bundled proof fixture is missing from this build.");
  }
  const manuscript = await fs.readFile(path.join(sourceRoot, "on_vs_in.md"), "utf8");
  const created = await writeChapterText(folder, project, "Proof fixture · on → in", manuscript);
  const chapter = created.chapter;
  const requestedRelative = `audio/${String(chapter.index).padStart(2, "0")}_raw.wav`;
  const destination = await copyFileUnique(
    path.join(sourceRoot, "on_vs_in.wav"),
    projectAssetPath(folder, requestedRelative),
  );
  const destinationRelative = path.relative(folder, destination).replaceAll(path.sep, "/");
  const nextProject = {
    ...created.project,
    chapters: created.project.chapters.map((candidate) => candidate.id === chapter.id
      ? { ...candidate, audio_path: destinationRelative, raw_audio_path: destinationRelative }
      : candidate),
    updated_at: new Date().toISOString(),
  };
  const transcript = JSON.parse(await fs.readFile(path.join(sourceRoot, "on_vs_in.transcript.json"), "utf8"));
  const saved = await saveProjectFolder(folder, nextProject);
  return {
    ...saved,
    chapter,
    transcriptText: transcript.words.map((word) => word.text).join(" "),
  };
}

async function writeChapterText(folder, project, title, text) {
  const manuscriptCore = loadCoreModule("manuscript");
  const index = nextChapterIndex(project);
  const chapterId = `ch${String(index).padStart(2, "0")}`;
  const fileName = `${String(index).padStart(2, "0")}.json`;
  const wordCount = countWords(text);
  const estimatedMinutes = estimateDurationMinutes(wordCount);
  const chapter = {
    id: chapterId,
    index,
    title: title.trim() || `Chapter ${index}`,
    text_path: `manuscript/chapters/${fileName}`,
    pickups_path: `alignment/${String(index).padStart(2, "0")}.json`,
    word_count: wordCount,
    estimated_duration_minutes: estimatedMinutes,
    duration_warning: estimatedMinutes > 120
      ? "Estimated narration is over 120 minutes; ACX requires a chapter split."
      : undefined,
    author_status: "draft",
  };
  const nextProject = {
    ...project,
    chapters: [...(Array.isArray(project.chapters) ? project.chapters : []), chapter]
      .sort((a, b) => a.index - b.index),
    updated_at: new Date().toISOString(),
  };
  await writeChapterDocument(
    folder,
    chapter.text_path,
    { schema: 1, spans: manuscriptCore.inferDialogueSpans([{ text, seat: "narration", style: [] }]) },
  );
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, chapter };
}

async function writeImportedManuscript(folder, project, sourcePath, imported) {
  const manuscriptCore = loadCoreModule("manuscript");
  const glossaryCore = loadCoreModule("glossary");
  const sections = manuscriptCore.splitManuscript(imported.source_text ?? imported.text, {
    idPrefix: "ch",
    hashStartsChapter: imported.format === "txt",
  });
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("The manuscript is empty; add some text before importing.");
  }

  const originalsFolder = await ensureProjectDirectory(folder, "manuscript/originals");
  const originalDestination = projectAssetPath(
    folder,
    path.relative(folder, path.join(originalsFolder, path.basename(sourcePath))),
  );
  await copyFileUnique(
    sourcePath,
    originalDestination,
  );

  const firstIndex = nextChapterIndex(project);
  const glossary = glossaryCore.mergeGlossaryCandidates(
    project.glossary ?? [],
    glossaryCore.extractGlossaryCandidates(imported.text, {
      lexicon: loadPronunciationLexicon(),
    }),
  );
  const createdChapters = [];
  for (const [offset, section] of sections.entries()) {
    const index = firstIndex + offset;
    const padded = String(index).padStart(2, "0");
    const chapter = {
      id: `ch${padded}`,
      index,
      title: section.title,
      text_path: `manuscript/chapters/${padded}.json`,
      pickups_path: `alignment/${padded}.json`,
      word_count: section.word_count,
      estimated_duration_minutes: section.estimated_duration_minutes,
      duration_warning: section.over_120_minutes
        ? "Estimated narration is over 120 minutes; ACX requires a chapter split."
        : undefined,
      author_status: "draft",
    };
    const styledSpans = manuscriptCore.sliceScriptSpans(
      imported.spans,
      section.content_start,
      section.content_end,
    );
    const dialogueSpans = manuscriptCore.inferDialogueSpans(styledSpans.length > 0
      ? styledSpans
      : [{ text: section.text, seat: "narration", style: [] }]);
    const spans = glossaryCore.linkGlossarySpans(dialogueSpans, glossary);
    await writeChapterDocument(folder, chapter.text_path, { schema: 1, spans });
    createdChapters.push(chapter);
  }

  const nextProject = {
    ...project,
    chapters: [...(project.chapters ?? []), ...createdChapters].sort((a, b) => a.index - b.index),
    glossary,
    chapter_notes: Array.isArray(project.chapter_notes) ? project.chapter_notes : [],
    updated_at: new Date().toISOString(),
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, chapters: createdChapters, sourcePath, format: imported.format };
}

async function renameChapterFile(folder, project, chapterId, title) {
  await assertProjectEnvelope(folder, project);
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (cleanTitle.length === 0) {
    throw new Error("Chapter title cannot be empty");
  }
  const now = new Date().toISOString();
  let found = false;
  const nextProject = {
    ...project,
    chapters: (project.chapters ?? []).map((chapter) => {
      if (chapter.id !== chapterId) {
        return chapter;
      }
      found = true;
      return { ...chapter, title: cleanTitle, updated_at: now };
    }),
    updated_at: now,
  };
  if (!found) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  return saveProjectFolder(folder, nextProject);
}

async function splitChapterFile(folder, project, chapterId, offset, secondTitle) {
  await assertProjectEnvelope(folder, project);
  const manuscriptCore = loadCoreModule("manuscript");
  const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
  const position = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (position < 0) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  const chapter = chapters[position];
  if (chapterHasAudio(chapter)) {
    throw new Error("Detach or move chapter audio before splitting the manuscript chapter.");
  }
  const document = await readChapterDocument(folder, chapter);
  const text = document.spans.map((span) => span.text).join("");
  if (!Number.isInteger(offset) || offset <= 0 || offset >= text.length) {
    throw new Error("Place the cursor inside the manuscript before splitting.");
  }
  const leftSpans = manuscriptCore.sliceScriptSpans(document.spans, 0, offset);
  const rightSpans = manuscriptCore.sliceScriptSpans(document.spans, offset, text.length);
  const leftText = leftSpans.map((span) => span.text).join("");
  const rightText = rightSpans.map((span) => span.text).join("");
  if (leftText.trim().length === 0 || rightText.trim().length === 0) {
    throw new Error("Both sides of a manual split need manuscript text.");
  }

  const newId = nextSplitChapterId(project, chapter.id);
  const newPath = `manuscript/chapters/${newId}.json`;
  const now = new Date().toISOString();
  const leftWordCount = manuscriptCore.countWords(leftText);
  const rightWordCount = manuscriptCore.countWords(rightText);
  const leftMinutes = manuscriptCore.estimateDurationMinutes(leftWordCount);
  const rightMinutes = manuscriptCore.estimateDurationMinutes(rightWordCount);
  chapters[position] = {
    ...resetChapterProofFields(chapter),
    word_count: leftWordCount,
    estimated_duration_minutes: leftMinutes,
    duration_warning: durationWarning(leftMinutes),
    author_status: "draft",
    updated_at: now,
  };
  const created = {
    id: newId,
    index: chapter.index + 1,
    title: typeof secondTitle === "string" && secondTitle.trim().length > 0
      ? secondTitle.trim()
      : `${chapter.title} (continued)`,
    text_path: newPath,
    pickups_path: `alignment/${newId}.json`,
    word_count: rightWordCount,
    estimated_duration_minutes: rightMinutes,
    duration_warning: durationWarning(rightMinutes),
    author_status: "draft",
    updated_at: now,
  };
  chapters.splice(position + 1, 0, created);
  const renumbered = chapters.map((candidate, index) => ({ ...candidate, index: index + 1 }));

  await writeChapterDocument(folder, chapter.text_path, { ...document, spans: leftSpans });
  await clearChapterAlignment(folder, chapters[position]);
  await writeChapterDocument(folder, newPath, { ...document, spans: rightSpans });
  await clearChapterAlignment(folder, created);
  const saved = await saveProjectFolder(folder, {
    ...project,
    chapters: renumbered,
    updated_at: now,
  });
  return { ...saved, chapter: created };
}

async function mergeChapterFiles(folder, project, firstChapterId, secondChapterId) {
  await assertProjectEnvelope(folder, project);
  const manuscriptCore = loadCoreModule("manuscript");
  const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
  const firstPosition = chapters.findIndex((chapter) => chapter.id === firstChapterId);
  const secondPosition = chapters.findIndex((chapter) => chapter.id === secondChapterId);
  if (firstPosition < 0 || secondPosition !== firstPosition + 1) {
    throw new Error("Only adjacent chapters can be merged in manuscript order.");
  }
  const first = chapters[firstPosition];
  const second = chapters[secondPosition];
  if (chapterHasAudio(first) || chapterHasAudio(second)) {
    throw new Error("Detach or move chapter audio before merging manuscript chapters.");
  }
  const [firstDocument, secondDocument] = await Promise.all([
    readChapterDocument(folder, first),
    readChapterDocument(folder, second),
  ]);
  const firstText = firstDocument.spans.map((span) => span.text).join("");
  const secondText = secondDocument.spans.map((span) => span.text).join("");
  const separator = /\s$/u.test(firstText) || /^\s/u.test(secondText) ? "" : "\n\n";
  const spans = [
    ...firstDocument.spans,
    ...(separator ? [{ text: separator, seat: "narration", style: [] }] : []),
    ...secondDocument.spans,
  ];
  const mergedText = `${firstText}${separator}${secondText}`;
  const wordCount = manuscriptCore.countWords(mergedText);
  const minutes = manuscriptCore.estimateDurationMinutes(wordCount);
  const now = new Date().toISOString();
  chapters[firstPosition] = {
    ...resetChapterProofFields(first),
    word_count: wordCount,
    estimated_duration_minutes: minutes,
    duration_warning: durationWarning(minutes),
    author_status: "draft",
    updated_at: now,
  };
  chapters.splice(secondPosition, 1);
  const renumbered = chapters.map((candidate, index) => ({ ...candidate, index: index + 1 }));
  await writeChapterDocument(folder, first.text_path, { ...firstDocument, spans });
  await clearChapterAlignment(folder, renumbered[firstPosition]);
  const saved = await saveProjectFolder(folder, {
    ...project,
    chapters: renumbered,
    chapter_notes: (project.chapter_notes ?? []).map((note) => note.chapter_id === second.id
      ? { ...note, chapter_id: first.id }
      : note),
    punch_recordings: (project.punch_recordings ?? []).map((punch) => punch.chapter_id === second.id
      ? { ...punch, chapter_id: first.id }
      : punch),
    updated_at: now,
  });
  return { ...saved, preservedSourcePath: second.text_path };
}

async function setChapterSeat(folder, project, chapterId, seat) {
  await assertProjectEnvelope(folder, project);
  if (seat !== "narration" && seat !== "N1" && seat !== "N2") {
    throw new Error("Seat must be narration, N1, or N2");
  }
  if (project.mode === "solo" && seat !== "narration") {
    throw new Error("Solo projects can assign only the narration seat; switch to duet mode first.");
  }
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  const document = await readChapterDocument(folder, chapter);
  await writeChapterDocument(folder, chapter.text_path, {
    ...document,
    spans: document.spans.map((span) => ({ ...span, seat })),
  });
  await clearChapterAlignment(folder, chapter);
  const now = new Date().toISOString();
  return saveProjectFolder(folder, {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? { ...chapterAfterSeatChange(candidate), updated_at: now }
      : candidate),
    updated_at: now,
  });
}

/** Switch voice mode while keeping the solo invariant true on disk. */
async function setProjectMode(folder, project, mode) {
  await assertProjectEnvelope(folder, project);
  if (mode !== "solo" && mode !== "duet") {
    throw new Error("Project mode must be solo or duet");
  }
  let nextProject = { ...project, mode, updated_at: new Date().toISOString() };
  if (mode === "solo") {
    for (const chapter of project.chapters ?? []) {
      const document = await readChapterDocument(folder, chapter);
      if (document.spans.some((span) => span.seat !== "narration")) {
        await writeChapterDocument(folder, chapter.text_path, {
          ...document,
          spans: document.spans.map((span) => ({ ...span, seat: "narration" })),
        });
      }
      // Seat-aware pickup assignments are no longer meaningful after a mode
      // switch, even when this chapter happened to contain only narration
      // spans. Always clear the alignment so reopening the folder cannot show
      // stale duet proof results.
      await clearChapterAlignment(folder, chapter);
      const now = new Date().toISOString();
      nextProject = {
        ...nextProject,
        chapters: nextProject.chapters.map((candidate) => candidate.id === chapter.id
          ? {
              ...chapterAfterSoloMode(candidate),
              updated_at: now,
            }
          : candidate),
      };
    }
  }
  return saveProjectFolder(folder, nextProject);
}

async function setChapterSpans(folder, project, chapterId, spans) {
  await assertProjectEnvelope(folder, project);
  if (!Array.isArray(spans)) {
    throw new Error("Chapter spans must be an array");
  }
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  const normalized = spans.map((span) => {
    if (!span || typeof span.text !== "string") {
      throw new Error("Every chapter span needs text");
    }
    if (span.seat !== "narration" && span.seat !== "N1" && span.seat !== "N2") {
      throw new Error("Every chapter span needs a valid seat");
    }
    const styles = Array.isArray(span.style)
      ? span.style.filter((style) => ["bold", "italic", "underline", "highlight"].includes(style))
      : [];
    return {
      text: span.text,
      seat: seatForProjectMode(project.mode, span.seat),
      style: styles,
      ...(typeof span.dialogue === "boolean" ? { dialogue: span.dialogue } : {}),
      ...(typeof span.glossary_id === "string" ? { glossary_id: span.glossary_id } : {}),
    };
  });
  await writeChapterDocument(folder, chapter.text_path, { schema: 1, spans: normalized });
  await clearChapterAlignment(folder, chapter);
  const now = new Date().toISOString();
  return saveProjectFolder(folder, {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? { ...chapterAfterSeatChange(candidate), updated_at: now }
      : candidate),
    updated_at: now,
  });
}

async function readChapterDocument(folder, chapter) {
  const value = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.text_path), "utf8"));
  try {
    return normalizeChapterDocument(value);
  } catch (error) {
    throw new Error(`Chapter script is malformed: ${chapter.title} (${String(error)})`);
  }
}

async function writeChapterDocument(folder, relativePath, value) {
  const destination = projectAssetPath(folder, relativePath);
  await ensureProjectDirectory(folder, path.dirname(relativePath));
  await writeJsonAtomic(destination, normalizeChapterDocument(value));
}

function nextSplitChapterId(project, baseId) {
  const ids = new Set((project.chapters ?? []).map((chapter) => chapter.id));
  let suffix = 2;
  while (ids.has(`${baseId}-part${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-part${suffix}`;
}

/** Matching ignores case, so one word must not become two rows. */
function normalizeWordList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Map();
  for (const entry of value) {
    const word = typeof entry === "string" ? entry.trim() : "";
    const key = word.toLocaleLowerCase("en-US");
    if (word !== "" && word.length <= 80 && !seen.has(key)) {
      seen.set(key, word);
    }
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}

function durationWarning(minutes) {
  return minutes > 120
    ? "Estimated narration is over 120 minutes; ACX requires a chapter split."
    : undefined;
}

function normalizeProjectSettings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const numberOr = (raw, min, max, fallback) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const legacyTeleprompterDefaults = candidate.teleprompter_preset_version !== 2
    && candidate.teleprompter_theme === "dark"
    && Number(candidate.teleprompter_font_size) === 48;
  return {
    proof_sensitivity: candidate.proof_sensitivity === "conservative" || candidate.proof_sensitivity === "aggressive"
      ? candidate.proof_sensitivity
      : "default",
    pause_threshold_seconds: numberOr(candidate.pause_threshold_seconds, 2, 12, 4),
    acx_target_rms_dbfs: numberOr(candidate.acx_target_rms_dbfs, -23, -18, -20),
    spec_preset_id: typeof candidate.spec_preset_id === "string" && candidate.spec_preset_id.trim() !== ""
      ? candidate.spec_preset_id.trim()
      : "acx",
    proof_confidence_floor: numberOr(candidate.proof_confidence_floor, 0, 0.9, 0.35),
    suppressed_words: normalizeWordList(candidate.suppressed_words),
    teleprompter_theme: legacyTeleprompterDefaults
      ? "cream"
      : candidate.teleprompter_theme === "dark"
      || candidate.teleprompter_theme === "sepia"
      || candidate.teleprompter_theme === "cream"
      ? candidate.teleprompter_theme
      : "cream",
    teleprompter_font_size: legacyTeleprompterDefaults
      ? 28
      : Math.round(numberOr(candidate.teleprompter_font_size, 20, 96, 28)),
    teleprompter_preset_version: 2,
  };
}

/** Keep an alignment file present but empty when a new take invalidates it. */
async function clearChapterAlignment(folder, chapter) {
  const relativePath = chapter.pickups_path
    || `alignment/${String(chapter.index).padStart(2, "0")}.json`;
  await ensureProjectDirectory(folder, path.dirname(relativePath));
  await writeJsonAtomic(projectAssetPath(folder, relativePath), {
    schema: 1,
    chapter_id: chapter.id,
    updated_at: new Date().toISOString(),
    transcript: [],
    pickups: [],
  });
}

async function attachAudioFile(folder, project, chapterId) {
  await assertProjectEnvelope(folder, project);
  const result = await dialog.showOpenDialog({
    title: "Attach a chapter recording",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "aiff", "aif"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const chapter = project.chapters?.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Choose a chapter before attaching audio");
  }
  const sourcePath = result.filePaths[0];
  const extension = path.extname(sourcePath).toLowerCase() || ".wav";
  const requestedRelative = `audio/${String(chapter.index).padStart(2, "0")}_raw${extension}`;
  const destination = await copyFileUnique(sourcePath, projectAssetPath(folder, requestedRelative));
  const destinationRelative = path.relative(folder, destination).replaceAll(path.sep, "/");
  await clearChapterAlignment(folder, chapter);
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? resetChapterAudioFields({
          ...candidate,
          audio_path: destinationRelative,
          raw_audio_path: destinationRelative,
        })
      : candidate),
    updated_at: new Date().toISOString(),
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, sourcePath, audioPath: destinationRelative };
}

async function attachDuetTrackFile(folder, project, chapterId, kind) {
  await assertProjectEnvelope(folder, project);
  if (project.mode !== "duet") {
    throw new Error("Switch the project to duet mode before attaching bed or overdub audio.");
  }
  if (kind !== "bed" && kind !== "overdub") {
    throw new Error("Duet track must be bed or overdub");
  }
  const result = await dialog.showOpenDialog({
    title: kind === "bed" ? "Choose the N1 bed recording" : "Choose the N2 overdub recording",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "aiff", "aif"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Choose a chapter before attaching a duet track");
  }
  const sourcePath = result.filePaths[0];
  const extension = path.extname(sourcePath).toLowerCase() || ".wav";
  const requestedRelative = `audio/duet/${String(chapter.index).padStart(2, "0")}_${kind}${extension}`;
  await ensureProjectDirectory(folder, "audio/duet");
  const destination = await copyFileUnique(sourcePath, projectAssetPath(folder, requestedRelative));
  const destinationRelative = path.relative(folder, destination).replaceAll(path.sep, "/");
  const now = new Date().toISOString();
  const field = kind === "bed" ? "bed_audio_path" : "overdub_audio_path";
  await clearChapterAlignment(folder, chapter);
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? {
          ...chapterAfterDuetRoutingChange({
            ...candidate,
            [field]: destinationRelative,
          }),
          updated_at: now,
        }
      : candidate),
    updated_at: now,
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, kind, sourcePath, audioPath: destinationRelative };
}

async function attachGlossaryClip(folder, project, glossaryId) {
  await assertProjectEnvelope(folder, project);
  const entry = (project.glossary ?? []).find((candidate) => candidate.id === glossaryId);
  if (!entry) {
    throw new Error("Glossary entry not found");
  }
  const result = await dialog.showOpenDialog({
    title: `Choose a pronunciation clip for ${entry.spelling}`,
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "aiff", "aif"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const sourcePath = result.filePaths[0];
  const extension = path.extname(sourcePath).toLowerCase() || ".wav";
  const base = `audio/glossary/${slugFileName(entry.spelling)}`;
  const destination = await copyFileUnique(sourcePath, projectAssetPath(folder, `${base}${extension}`));
  const destinationRelative = path.relative(folder, destination).replaceAll(path.sep, "/");
  const nextProject = {
    ...project,
    glossary: (project.glossary ?? []).map((candidate) => candidate.id === glossaryId
      ? { ...candidate, clip_path: destinationRelative }
      : candidate),
    updated_at: new Date().toISOString(),
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, sourcePath, clipPath: destinationRelative };
}

async function relinkGlossary(folder, project) {
  await assertProjectEnvelope(folder, project);
  const glossaryCore = loadCoreModule("glossary");
  const glossary = project.glossary ?? [];
  for (const chapter of project.chapters ?? []) {
    const document = await readChapterDocument(folder, chapter);
    const spans = glossaryCore.linkGlossarySpans(document.spans, glossary);
    await writeChapterDocument(folder, chapter.text_path, { ...document, spans });
  }
  return saveProjectFolder(folder, { ...project, updated_at: new Date().toISOString() });
}

async function refreshGlossary(folder, project) {
  await assertProjectEnvelope(folder, project);
  const glossaryCore = loadCoreModule("glossary");
  const documents = await Promise.all((project.chapters ?? []).map(async (chapter) => ({
    chapter,
    document: await readChapterDocument(folder, chapter),
  })));
  const manuscript = documents
    .map(({ document }) => document.spans.map((span) => span.text).join(""))
    .join("\n");
  const candidates = glossaryCore.extractGlossaryCandidates(manuscript, {
    lexicon: loadPronunciationLexicon(),
  });
  const glossary = glossaryCore.replaceAutoGlossaryCandidates(project.glossary ?? [], candidates);
  for (const { chapter, document } of documents) {
    const spans = glossaryCore.linkGlossarySpans(document.spans, glossary);
    await writeChapterDocument(folder, chapter.text_path, { ...document, spans });
  }
  return saveProjectFolder(folder, { ...project, glossary, updated_at: new Date().toISOString() });
}

/**
 * Fill in the pronunciations the bundled dictionary already knows, so a narrator
 * only hand-writes the names no dictionary has. Rows someone has already
 * answered are left alone.
 */
async function suggestGlossaryRespells(folder, project) {
  await assertProjectEnvelope(folder, project);
  const glossaryCore = loadCoreModule("glossary");
  const lexicon = loadPronunciationLexicon();
  if (!lexicon) {
    throw new Error("The pronouncing dictionary is not bundled with this build.");
  }
  const { glossary, filled, unknown } = glossaryCore.fillGlossaryRespells(project.glossary ?? [], lexicon);
  const saved = filled > 0
    ? await saveProjectFolder(folder, { ...project, glossary, updated_at: new Date().toISOString() })
    : { folder, project };
  return { ...saved, filled, unknown };
}

/**
 * Two files a narrator can actually read from: the guide of every name with how
 * to say it and how it should sound, and the script itself with pronunciations
 * dropped in beside the names.
 */
async function exportVoiceGuide(folder, project, options = {}) {
  await assertProjectEnvelope(folder, project);
  return exportVoiceGuideFiles({
    folder,
    project,
    frequency: options.frequency,
    hooks: { readChapterDocument, core: loadCoreModule("glossary") },
  });
}

async function readChapterText(folder, project, chapterId) {
  await assertProjectEnvelope(folder, project);
  const chapter = project.chapters?.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const value = await readChapterDocument(folder, chapter);
  const text = value.spans.map((span) => span.text).join("");
  return { chapterId, text, spans: value.spans };
}

async function saveAlignment(folder, project, chapterId, pickups, transcript) {
  await assertProjectEnvelope(folder, project);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  if (!Array.isArray(pickups)) {
    throw new Error("Alignment pickups must be an array");
  }
  const normalizedAlignment = normalizeAlignment({ transcript, pickups }, chapterId);
  const relativePath = chapter.pickups_path || `alignment/${String(chapter.index).padStart(2, "0")}.json`;
  const value = {
    schema: 1,
    chapter_id: chapterId,
    updated_at: new Date().toISOString(),
    transcript: normalizedAlignment.transcript,
    pickups: normalizedAlignment.pickups,
  };
  await ensureProjectDirectory(folder, path.dirname(relativePath));
  await writeJsonAtomic(projectAssetPath(folder, relativePath), value);
  const now = new Date().toISOString();
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? {
          ...candidate,
          pickups_path: relativePath,
          open_pickups: normalizedAlignment.pickups.filter((pickup) => pickup.status === "open").length,
          updated_at: now,
        }
      : candidate),
    updated_at: now,
  };
  return saveProjectFolder(folder, nextProject);
}

async function readAlignment(folder, project, chapterId) {
  await assertProjectEnvelope(folder, project);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter?.pickups_path) {
    return null;
  }
  try {
    const value = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.pickups_path), "utf8"));
    return normalizeAlignment(value, chapterId);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Every chapter's text and saved alignment in one read, for whole-book scans. */
async function readBookProof(folder, project) {
  await assertProjectEnvelope(folder, project);
  return collectBookProof(
    project,
    (chapter) => readChapterDocument(folder, chapter),
    (chapterId) => readAlignment(folder, project, chapterId),
  );
}

/**
 * Apply one decision to flags in several chapters at once. The same misread
 * name can be flagged in a dozen chapters, and opening each one to dismiss it
 * is the part narrators give up on.
 */
async function resolveBookPickups(folder, project, requests, status) {
  await assertProjectEnvelope(folder, project);
  if (!Array.isArray(requests)) {
    throw new Error("Invalid pickup decision request");
  }
  let current = project;
  let changedChapters = 0;
  for (const request of requests) {
    if (!request?.chapterId || !Array.isArray(request.ids) || request.ids.length === 0) {
      continue;
    }
    const alignment = await readAlignment(folder, current, request.chapterId);
    if (!alignment) {
      continue;
    }
    const decided = applyPickupDecision(alignment.pickups, request.ids, status);
    if (!decided.changed) {
      continue;
    }
    const saved = await saveAlignment(
      folder,
      current,
      request.chapterId,
      decided.pickups,
      alignment.transcript,
    );
    current = saved.project;
    changedChapters += 1;
  }
  return { folder, project: current, changedChapters };
}

const importStaging = new Map();
const IMPORT_STAGING_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Read a collaborator's pack and report what it would change here, without
 * changing anything. Sharing a book was one-way until now: a pack could be
 * sent, but whatever came back had to be re-entered by hand.
 */
async function reviewCollaboratorPack(folder, project) {
  await assertProjectEnvelope(folder, project);
  const result = await dialog.showOpenDialog({
    title: "Open a collaborator pack",
    properties: ["openFile"],
    filters: [{ name: "Collaborator pack", extensions: ["zip"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const archivePath = result.filePaths[0];
  const archiveStat = await fs.lstat(archivePath);
  if (!archiveStat.isFile()) {
    throw new Error("A collaborator pack must be a regular .zip file");
  }

  await pruneImportStaging();
  const stagingId = crypto.randomUUID();
  const stagingPath = path.join(app.getPath("temp"), `kosmos-import-${stagingId}`);
  await extractArchive({ archivePath, destination: stagingPath });
  importStaging.set(stagingId, { folder, stagingPath, createdAt: Date.now() });

  try {
    const review = await reviewPack({
      folder,
      project,
      stagingPath,
      hooks: packImportHooks(),
    });
    return {
      stagingId,
      packName: path.basename(archivePath),
      summary: review.summary,
      plan: review.plan,
      incomingName: review.incomingName,
    };
  } catch (error) {
    await discardImportStaging(stagingId);
    throw error;
  }
}

/** Copy in everything the reviewed plan described, then forget the pack. */
async function applyCollaboratorPack(folder, project, stagingId) {
  await assertProjectEnvelope(folder, project);
  const staging = importStaging.get(stagingId);
  if (!staging || staging.folder !== folder) {
    throw new Error("That pack is no longer open. Choose it again.");
  }
  const result = await applyPack({
    folder,
    project,
    stagingPath: staging.stagingPath,
    hooks: packImportHooks(),
  });
  await discardImportStaging(stagingId);
  return result;
}

/** The project reads and writes the import needs, bound to this process. */
function packImportHooks() {
  return {
    core: loadCoreModule("sharing"),
    readAlignment,
    saveAlignment,
    saveProject: saveProjectFolder,
    readChapterDocument,
    validateIncomingProject: (incoming) => {
      loadCoreModule("project").validateProject({
        ...incoming,
        settings: normalizeProjectSettings(incoming.settings),
      });
    },
  };
}

const collabDesk = new CollabDesk({
  hooksFor: () => ({
    ...packImportHooks(),
    reviewPack,
    applyPack,
  }),
});

async function pruneImportStaging() {
  const cutoff = Date.now() - IMPORT_STAGING_TTL_MS;
  for (const [id, entry] of [...importStaging]) {
    if (entry.createdAt <= cutoff) {
      await discardImportStaging(id);
    }
  }
}

async function discardImportStaging(stagingId) {
  const entry = importStaging.get(stagingId);
  if (!entry) {
    return { discarded: false };
  }
  importStaging.delete(stagingId);
  await fs.rm(entry.stagingPath, { recursive: true, force: true }).catch(() => undefined);
  return { discarded: true };
}

async function exportMarkerFiles(folder, project, chapterId, pickups) {
  await assertProjectEnvelope(folder, project);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const markersCore = loadCoreModule("markers");
  const outputFolder = await ensureProjectDirectory(folder, "export/markers");
  const baseName = `${String(chapter.index).padStart(2, "0")}_${slugFileName(chapter.title)}`;
  const normalizedPickups = normalizeAlignment(
    { transcript: [], pickups: Array.isArray(pickups) ? pickups : [] },
    chapterId,
  ).pickups;
  const files = markersCore.markerFileSet(baseName, normalizedPickups);
  for (const file of files) {
    const destination = projectAssetPath(
      folder,
      path.relative(folder, path.join(outputFolder, file.fileName)),
    );
    await writeFileAtomic(destination, file.contents, "utf8");
  }
  return {
    folder: outputFolder,
    files: files.map((file) => file.fileName),
  };
}

async function exportProofReportFiles(folder, project, chapterId, transcript, pickups) {
  await assertProjectEnvelope(folder, project);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const reportCore = loadCoreModule("proof-report");
  const normalized = normalizeAlignment(
    { transcript: Array.isArray(transcript) ? transcript : [], pickups: Array.isArray(pickups) ? pickups : [] },
    chapterId,
  );
  let duration;
  if (chapter.audio_path) {
    try {
      duration = (await probeAudio(projectAudioPath(folder, chapter.audio_path))).duration;
    } catch {
      duration = undefined;
    }
  }
  const files = reportCore.buildProofReportFiles({
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    audioPath: chapter.audio_path,
    audioDurationSeconds: duration,
    transcript: normalized.transcript,
    pickups: normalized.pickups,
  });
  const outputFolder = await ensureProjectDirectory(folder, "export/proofing");
  const baseName = `${String(chapter.index).padStart(2, "0")}_${slugFileName(chapter.title)}`;
  const outputFiles = [
    { fileName: `${baseName}_proof_report.md`, contents: files.report },
    { fileName: `${baseName}_pickup_packet.csv`, contents: files.csv },
  ];
  for (const file of outputFiles) {
    await writeFileAtomic(projectAssetPath(folder, path.relative(folder, path.join(outputFolder, file.fileName))), file.contents, "utf8");
  }
  return { folder: outputFolder, files: outputFiles.map((file) => file.fileName) };
}

/**
 * Write a packet the other side can open without this app: one page per
 * chapter with a playable clip beside every flag, plus the same list as a
 * spreadsheet. Proofers and publishers work in a browser and in Excel, not in
 * a narrator's editor.
 */
async function exportPickupPacket(folder, project, chapterId, transcript, pickups) {
  await assertProjectEnvelope(folder, project);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  if (!chapter.audio_path) {
    throw new Error("Attach the chapter recording before exporting a packet");
  }
  const packetCore = loadCoreModule("proof-packet");
  const reportCore = loadCoreModule("proof-report");
  const normalized = normalizeAlignment(
    { transcript: Array.isArray(transcript) ? transcript : [], pickups: Array.isArray(pickups) ? pickups : [] },
    chapterId,
  );
  const audioPath = projectAudioPath(folder, chapter.audio_path);
  let durationSeconds;
  try {
    durationSeconds = (await probeAudio(audioPath)).duration;
  } catch {
    durationSeconds = undefined;
  }

  const clips = packetCore.planPacketClips(normalized.pickups, { durationSeconds });
  const baseName = `${String(chapter.index).padStart(2, "0")}_${slugFileName(chapter.title)}`;
  const packetRelative = `export/packet/${baseName}`;
  await ensureProjectDirectory(folder, packetRelative);
  const clipsRelative = `${packetRelative}/clips`;
  if (clips.length > 0) {
    await ensureProjectDirectory(folder, clipsRelative);
  }

  for (const clip of clips) {
    const destination = projectAssetPath(folder, `${clipsRelative}/${clip.fileName}`);
    await encodeClipMp3(audioPath, destination, clip.start, Math.max(0.25, clip.end - clip.start));
  }

  const narrator = [project.narrator_n1, project.narrator_n2].filter(Boolean).join(" & ");
  const packetInput = {
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    projectName: project.name,
    narrator: narrator || undefined,
    audioDurationSeconds: durationSeconds,
    pickups: normalized.pickups,
    clips,
  };
  const reportFiles = reportCore.buildProofReportFiles({
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    audioPath: chapter.audio_path,
    audioDurationSeconds: durationSeconds,
    transcript: normalized.transcript,
    pickups: normalized.pickups,
  });

  const workbookParts = packetCore.buildPacketWorkbookParts(packetInput);
  const workbookFiles = {};
  for (const part of workbookParts) {
    workbookFiles[part.path] = strToU8(part.contents);
  }
  const workbook = Buffer.from(zipSync(workbookFiles, { level: 6 }));

  await writeFileAtomic(
    projectAssetPath(folder, `${packetRelative}/index.html`),
    packetCore.buildPacketHtml(packetInput),
    "utf8",
  );
  await writeFileAtomic(
    projectAssetPath(folder, `${packetRelative}/pickups.csv`),
    reportFiles.csv,
    "utf8",
  );
  await writeFileAtomic(
    projectAssetPath(folder, `${packetRelative}/pickups.xlsx`),
    workbook,
  );

  return {
    folder: projectAssetPath(folder, packetRelative),
    files: ["index.html", "pickups.xlsx", "pickups.csv"],
    clipCount: clips.length,
    pickupCount: normalized.pickups.length,
  };
}

async function encodeClipMp3(inputPath, outputPath, startSeconds, durationSeconds) {
  await runFfmpeg([
    "-y", "-v", "error",
    "-ss", String(Math.max(0, startSeconds)),
    "-i", inputPath,
    "-t", String(Math.max(0.25, durationSeconds)),
    "-map_metadata", "-1",
    "-codec:a", "libmp3lame",
    "-b:a", "96k",
    "-ar", "44100",
    "-ac", "1",
    outputPath,
  ]);
}

async function saveRecordingWav(folder, project, payload) {
  await assertProjectEnvelope(folder, project);
  const kind = payload?.kind;
  if (kind !== "chapter" && kind !== "punch" && kind !== "room" && kind !== "glossary" && kind !== "live") {
    throw new Error("Recording kind must be chapter, punch, room, glossary, or live");
  }
  if (typeof payload?.wavBase64 !== "string" || payload.wavBase64.length < 44) {
    throw new Error("Recording did not contain a WAV file");
  }
  const bytes = Buffer.from(payload.wavBase64, "base64");
  if (bytes.length > MAX_RECORDER_WAV_BYTES) {
    throw new Error("Recorder WAV is larger than Kosmos's supported audio limit");
  }
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Recorder output is not a RIFF/WAVE file");
  }
  try {
    // Header checks alone accept truncated or non-PCM payloads. Decode before
    // copying so a bad recorder/browser payload cannot poison the project.
    const audioCore = loadCoreModule("audio");
    const decoded = audioCore.decodeWavPcm16(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    assertRecorderPcmBounds(decoded, kind);
    const duration = decoded.samples.length / decoded.channels / decoded.sampleRate;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Recorder WAV contains no audio samples");
    }
    if (duration > MAX_AUDIO_SECONDS) {
      throw new Error(`Recorder WAV exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute limit`);
    }
    if (kind === "room" && duration > MAX_ROOM_TEST_SECONDS) {
      throw new Error(`Room tests must be ${MAX_ROOM_TEST_SECONDS} seconds or shorter`);
    }
  } catch (error) {
    throw new Error(`Recorder output is not a supported PCM16 WAV: ${String(error)}`);
  }
  const chapter = payload.chapterId
    ? (project.chapters ?? []).find((candidate) => candidate.id === payload.chapterId)
    : null;
  const glossaryEntry = payload.glossaryId
    ? (project.glossary ?? []).find((candidate) => candidate.id === payload.glossaryId)
    : null;
  if (kind === "glossary" && !glossaryEntry) {
    throw new Error("Choose a glossary entry before saving its clip");
  }
  if (kind !== "room" && kind !== "glossary" && !chapter) {
    throw new Error("Choose a chapter before saving this recording");
  }
  const stamp = assetStamp();
  let relativePath;
  if (kind === "room") {
    relativePath = `audio/room_test_${stamp}.wav`;
  } else if (kind === "glossary") {
    relativePath = `audio/glossary/${slugFileName(glossaryEntry.spelling)}_${stamp}.wav`;
  } else if (kind === "live") {
    relativePath = `audio/live/${chapter.id}_session_${stamp}.wav`;
  } else if (kind === "punch") {
    const pickup = typeof payload.pickupId === "string" ? payload.pickupId : "manual";
    relativePath = `audio/pickups/${chapter.id}-${slugFileName(pickup)}-${stamp}.wav`;
  } else {
    relativePath = `audio/${String(chapter.index).padStart(2, "0")}_recorded_${stamp}.wav`;
  }
  const destination = await nextAvailablePath(projectAssetPath(folder, relativePath));
  relativePath = path.relative(folder, destination).replaceAll(path.sep, "/");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await writeFileAtomic(destination, bytes);
  const now = new Date().toISOString();
  let nextProject = { ...project, updated_at: now };
  if (kind === "room") {
    nextProject.room_test_path = relativePath;
  } else if (kind === "glossary") {
    nextProject.glossary = (project.glossary ?? []).map((entry) => entry.id === glossaryEntry.id
      ? { ...entry, clip_path: relativePath }
      : entry);
  } else if (kind === "live") {
    nextProject.chapters = project.chapters.map((candidate) => candidate.id === chapter.id
      ? { ...candidate, live_audio_path: relativePath, updated_at: now }
      : candidate);
  } else if (kind === "chapter") {
    await clearChapterAlignment(folder, chapter);
    nextProject.chapters = project.chapters.map((candidate) => candidate.id === chapter.id
      ? resetChapterAudioFields({
          ...candidate,
          audio_path: relativePath,
          raw_audio_path: relativePath,
          updated_at: now,
        })
      : candidate);
  } else {
    nextProject.punch_recordings = [
      ...(project.punch_recordings ?? []),
      {
        id: `punch-${stamp}-${(project.punch_recordings?.length ?? 0) + 1}`,
        chapter_id: chapter.id,
        ...(payload.pickupId ? { pickup_id: payload.pickupId } : {}),
        path: relativePath,
        created_at: now,
      },
    ];
  }
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, path: relativePath, kind };
}

async function applyPunchRecording(folder, project, payload) {
  await assertProjectEnvelope(folder, project);
  if (typeof payload?.wavBase64 !== "string" || payload.wavBase64.length < 44) {
    throw new Error("Punch recording did not contain a WAV file");
  }
  if (!Number.isFinite(payload?.tStart) || !Number.isFinite(payload?.tEnd) || payload.tEnd <= payload.tStart) {
    throw new Error("Punch boundaries must be a valid time range");
  }
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === payload.chapterId);
  if (!chapter?.audio_path) {
    throw new Error("Attach a chapter take before applying a punch");
  }

  const audioCore = loadCoreModule("audio");
  const spliceCore = loadCoreModule("splice");
  const replacementBytes = Buffer.from(payload.wavBase64, "base64");
  if (replacementBytes.length > MAX_RECORDER_WAV_BYTES) {
    throw new Error("Punch WAV is larger than Kosmos's supported audio limit");
  }
  const replacement = audioCore.decodeWavPcm16(new Uint8Array(
    replacementBytes.buffer,
    replacementBytes.byteOffset,
    replacementBytes.byteLength,
  ));
  assertRecorderPcmBounds(replacement);
  const replacementDuration = replacement.samples.length / replacement.channels / replacement.sampleRate;
  if (!Number.isFinite(replacementDuration) || replacementDuration <= 0) {
    throw new Error("Punch WAV contains no audio samples");
  }
  if (replacementDuration > MAX_AUDIO_SECONDS) {
    throw new Error(`Punch WAV exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute limit`);
  }
  const original = await decodeMono44100(projectAssetPath(folder, chapter.audio_path));
  const originalDuration = original.length / 44100;
  let punchBounds;
  try {
    punchBounds = normalizePunchBounds(payload.tStart, payload.tEnd, originalDuration);
  } catch {
    throw new Error(
      `Punch boundaries must stay within the attached take (0.000–${originalDuration.toFixed(3)} seconds).`,
    );
  }
  let replacementSamples = mixInterleavedToMono(replacement.samples, replacement.channels);
  replacementSamples = resampleLinearArray(replacementSamples, replacement.sampleRate, 44100);
  if (payload.trimSilence !== false) {
    replacementSamples = spliceCore.trimPunchSilence(replacementSamples, 44100, {
      threshold: 0.01,
      padMs: 50,
    });
  }
  const edited = spliceCore.splicePunch({
    original,
    replacement: replacementSamples,
    sampleRate: 44100,
    startSeconds: punchBounds.start,
    endSeconds: punchBounds.end,
    crossfadeMs: 10,
  });

  const stamp = assetStamp();
  const punchRelative = `audio/pickups/${chapter.id}-${slugFileName(payload.pickupId || "manual")}-${stamp}.wav`;
  const editedRelative = `audio/${String(chapter.index).padStart(2, "0")}_edited_${stamp}.wav`;
  await ensureProjectDirectory(folder, path.dirname(punchRelative));
  await writeFileAtomic(projectAssetPath(folder, punchRelative), replacementBytes);
  await writeFileAtomic(
    projectAssetPath(folder, editedRelative),
    Buffer.from(audioCore.encodeWavPcm16(edited, 44100, 1)),
  );
  await clearChapterAlignment(folder, chapter);

  const now = new Date().toISOString();
  const rawAudioPath = chapter.raw_audio_path || chapter.audio_path;
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapter.id
      ? {
          ...resetChapterAudioFields(candidate, {
            // A punch edits the current canonical take, but it must not
            // discard the bed/overdub sources in a duet project. The mix and
            // stems are invalidated below; the user can remix from the
            // preserved source tracks after reviewing the punch.
            preserveDuetTracks: project.mode === "duet"
              && Boolean(candidate.bed_audio_path || candidate.overdub_audio_path),
          }),
          raw_audio_path: rawAudioPath,
          edited_audio_path: editedRelative,
          audio_path: editedRelative,
          acx_traffic_light: undefined,
          updated_at: now,
        }
      : candidate),
    punch_recordings: [
      ...(project.punch_recordings ?? []),
      {
        id: `punch-${stamp}-${(project.punch_recordings?.length ?? 0) + 1}`,
        chapter_id: chapter.id,
        ...(payload.pickupId ? { pickup_id: payload.pickupId } : {}),
        ...(typeof payload.expected === "string" ? { expected: payload.expected.slice(0, 1000) } : {}),
        ...(typeof payload.heard === "string" ? { heard: payload.heard.slice(0, 1000) } : {}),
        path: punchRelative,
        edited_path: editedRelative,
        t_start: punchBounds.start,
        t_end: punchBounds.end,
        created_at: now,
      },
    ],
    updated_at: now,
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, kind: "punch", path: punchRelative, editedPath: editedRelative };
}

async function audioStreamUrl(folder, relativePath) {
  await assertProjectFolder(folder);
  const audioPath = projectAudioPath(folder, relativePath);
  const stat = await fs.stat(audioPath);
  if (!stat.isFile()) {
    throw new Error("Audio playback source must be a regular file");
  }
  return encodeAudioRequest(folder, relativePath);
}

/** Serve chapter audio as a seekable stream instead of copying a book-sized
 * file through IPC as base64. The path is revalidated on every request so a
 * stale or hand-written URL cannot escape the selected project folder.
 */
async function handleAudioStreamRequest(request) {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const { folder, relativePath } = decodeAudioRequest(request.url);
    await assertProjectFolder(folder);
    const audioPath = projectAudioPath(folder, relativePath);
    const stat = await fs.stat(audioPath);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) {
      return new Response("Not found", { status: 404 });
    }
    const commonHeaders = {
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": mimeForExtension(path.extname(audioPath)),
    };
    const requestedRange = request.headers.get("range");
    if (requestedRange) {
      const range = parseByteRange(requestedRange, stat.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, "Content-Range": `bytes */${stat.size}` },
        });
      }
      const headers = {
        ...commonHeaders,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      };
      if (request.method === "HEAD") {
        return new Response(null, { status: 206, headers });
      }
      return streamResponse(fsSync.createReadStream(audioPath, range), 206, headers);
    }
    const headers = { ...commonHeaders, "Content-Length": String(stat.size) };
    if (request.method === "HEAD" || stat.size === 0) {
      return new Response(null, { status: 200, headers });
    }
    return streamResponse(fsSync.createReadStream(audioPath), 200, headers);
  } catch {
    // Do not reflect absolute local paths or filesystem details into renderer
    // error pages; the initiating IPC call provides the actionable message.
    return new Response("Not found", { status: 404 });
  }
}

async function decodeAudioFile(folder, relativePath) {
  const decoded = await decodeAudioPcm(folder, relativePath);
  return {
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    format: decoded.format,
    durationSeconds: decoded.durationSeconds,
    bitrateKbps: decoded.bitrateKbps,
    vbr: decoded.vbr,
    pcmBase64: decoded.pcm.toString("base64"),
  };
}

/**
 * Decode a project asset after its caller has selected the appropriate
 * filesystem boundary. Renderer-facing audio operations use
 * `projectAudioPath`; internal export staging may temporarily live under
 * `export/` and therefore uses the broader, still symlink-safe
 * `projectAssetPath` resolver.
 */
async function decodeAudioPcmAtPath(folder, relativePath, resolveAssetPath) {
  await assertProjectFolder(folder);
  const audioPath = resolveAssetPath(folder, relativePath);
  const metadata = await probeAudio(audioPath);
  if (metadata.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute decode limit.`);
  }
  const channels = metadata.channels;
  const sampleRate = metadata.sampleRate;
  const pcm = await runFfmpeg([
    "-v", "error", "-i", audioPath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", String(channels), "-ar", String(sampleRate), "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % 4 !== 0 || pcm.length % (4 * channels) !== 0) {
    throw new Error("Audio decoder returned no complete PCM frames");
  }
  const actualDuration = audioDurationFromPcm(pcm.length, channels, sampleRate);
  if (!Number.isFinite(actualDuration) || actualDuration > MAX_AUDIO_SECONDS) {
    throw new Error(`Decoded audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute limit.`);
  }
  return {
    sampleRate,
    channels,
    format: metadata.format || normalizeAudioFormat(path.extname(audioPath)),
    durationSeconds: actualDuration,
    bitrateKbps: metadata.bitrateKbps,
    vbr: metadata.vbr,
    pcm,
  };
}

async function decodeAudioPcm(folder, relativePath) {
  return decodeAudioPcmAtPath(folder, relativePath, projectAudioPath);
}

async function audioMetadata(folder, relativePath) {
  await assertProjectFolder(folder);
  const audioPath = projectAudioPath(folder, relativePath);
  const metadata = await probeAudio(audioPath);
  if (metadata.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute decode limit.`);
  }
  return {
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    format: metadata.format || normalizeAudioFormat(path.extname(audioPath)),
    durationSeconds: metadata.duration,
    bitrateKbps: metadata.bitrateKbps,
    vbr: metadata.vbr,
  };
}

function decodePcmBase64(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("Live PCM is empty.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 4 || bytes.length % 4 !== 0) {
    throw new Error("Live PCM is malformed.");
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

async function transcribeAudioBuffer(payload) {
  if (payload?.pcmBase64) {
    const pcm = decodePcmBase64(payload.pcmBase64);
    if (liveFollowStream.running) {
      return liveFollowStream.feed(pcm);
    }
    throw new Error("Live stream is not running.");
  }
  const { bytes, extension } = decodeLiveAudioPayload(payload);
  const language = payload.language || "en";
  const wantWhisper = payload?.engine === "whisper";
  if (extension === ".wav") {
    if (!wantWhisper) {
      try {
        const follow = await transcribeLiveFollowWindow(bytes);
        if (follow) {
          return follow;
        }
      } catch (error) {
        console.warn(`Live follow model unavailable; using Whisper: ${error?.message ?? error}`);
      }
    }
    try {
      const modelPath = await findModel({
        userDataPath: app.getPath("userData"),
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      });
      if (modelPath) {
        const serverPath = resolveRuntimeBinary({
          name: "whisper-server",
          envVar: "WHISPER_SERVER_PATH",
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          requireBundled: app.isPackaged,
        });
        return await liveAsrServer.transcribe({
          serverPath,
          modelPath,
          wavBytes: bytes,
          language,
          threads: Math.min(4, Math.max(2, os.cpus().length)),
        });
      }
    } catch (error) {
      console.warn(`Persistent Whisper server unavailable; using CLI fallback: ${error?.message ?? error}`);
    }
  }
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "booth-live-asr-"));
  const inputPath = path.join(temporaryRoot, `window${extension}`);
  try {
    await fs.writeFile(inputPath, bytes, { mode: 0o600 });
    return await transcribeAudio({
      audioPath: inputPath,
      userDataPath: app.getPath("userData"),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      language,
      requireBundled: app.isPackaged,
      live: true,
      inputIsPcmWav: extension === ".wav",
      quality: wantWhisper,
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeLiveFollowWindow(wavBytes) {
  const modelPath = await findLiveModel({
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!modelPath) {
    return null;
  }
  const serverPath = resolveRuntimeBinary({
    name: "parakeet-server",
    envVar: "PARAKEET_SERVER_PATH",
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    requireBundled: false,
  });
  return liveFollowServer.transcribe({
    serverPath,
    modelPath,
    wavBytes,
  });
}

async function warmWhisperLive() {
  const modelPath = await findModel({
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!modelPath) {
    throw new Error("No speech model is ready yet.");
  }
  liveAsrServer.useGpu = false;
  const serverPath = resolveRuntimeBinary({
    name: "whisper-server",
    envVar: "WHISPER_SERVER_PATH",
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    requireBundled: app.isPackaged,
  });
  return liveAsrServer.warm({
    serverPath,
    modelPath,
    threads: Math.min(4, Math.max(2, os.cpus().length)),
  });
}

async function warmLiveTranscription() {
  let follow = null;
  try {
    const liveModelPath = await findLiveModel({
      userDataPath: app.getPath("userData"),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    if (liveModelPath) {
      try {
        const livePath = resolveRuntimeBinary({
          name: "parakeet-live",
          envVar: "PARAKEET_LIVE_PATH",
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          requireBundled: false,
        });
        follow = await liveFollowStream.start({
          serverPath: livePath,
          modelPath: liveModelPath,
        });
      } catch (error) {
        console.warn(`Parakeet live stream unavailable; using clip server: ${error?.message ?? error}`);
        const serverPath = resolveRuntimeBinary({
          name: "parakeet-server",
          envVar: "PARAKEET_SERVER_PATH",
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          requireBundled: false,
        });
        follow = await liveFollowServer.warm({
          serverPath,
          modelPath: liveModelPath,
        });
      }
    }
  } catch (error) {
    console.warn(`Live follow warm-up skipped: ${error?.message ?? error}`);
  }
  try {
    const whisper = await warmWhisperLive();
    return { ...(follow ?? whisper), backcheck: "whisper" };
  } catch (error) {
    console.warn(`Whisper back-check warm-up skipped: ${error?.message ?? error}`);
    if (follow) {
      // Voice follow still works, but word checks do not. Say so explicitly:
      // the follow server also reports `persistent`, so the renderer cannot
      // infer proofreading health from that flag alone.
      return { ...follow, backcheck: "none" };
    }
    throw error;
  }
}

async function measureAudioFile(folder, relativePath, options = {}) {
  const decoded = await decodeAudioPcm(folder, relativePath);
  const masterCore = loadCoreModule("master");
  const preset = masterCore.resolvePreset(
    options.presetId,
    masterCore.normalizeCustomPresets(options.customPresets),
  );
  return masterCore.measurePcm({
    samples: float32View(decoded.pcm),
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    format: decoded.format,
    bitrate_kbps: decoded.bitrateKbps,
    vbr: decoded.vbr,
  }, { requireRoomTone: options.requireRoomTone, preset });
}

/** Sample rate for silence measurement; speech energy needs no more than this. */
const SILENCE_SAMPLE_RATE = 8000;

/**
 * Measure the quiet stretches in a recording.
 *
 * Pause flags used to be read from the recogniser's word timings, which are an
 * even division of each segment rather than a record of when the words were
 * said: five seconds of silence mid-sentence can arrive as a half-second gap.
 * The audio is the only honest source.
 */
async function measureSilences(audioPath, options = {}) {
  const pcm = await runFfmpeg([
    "-v", "error", "-i", audioPath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", String(SILENCE_SAMPLE_RATE), "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % 4 !== 0) {
    return [];
  }
  return loadCoreModule("proof-silence").findSilences(
    float32View(pcm),
    SILENCE_SAMPLE_RATE,
    1,
    { minSeconds: options.minSeconds },
  );
}

async function decodeMono44100(audioPath) {
  const pcm = await runFfmpeg([
    "-v", "error", "-i", audioPath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", "44100", "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % 4 !== 0) {
    throw new Error("Audio decoder returned no complete mono PCM frames");
  }
  const duration = pcm.length / 4 / 44100;
  if (!Number.isFinite(duration) || duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Decoded audio exceeds Kosmos's ${MAX_AUDIO_SECONDS / 60} minute limit.`);
  }
  const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
  return new Float32Array(copy);
}

async function mixDuetChapterFile(folder, project, chapterId, narrationSeat = "N1", crossfadeMs = 20) {
  await assertProjectEnvelope(folder, project);
  if (project.mode !== "duet") {
    throw new Error("Switch the project to duet mode before mixing a chapter.");
  }
  if (narrationSeat !== "N1" && narrationSeat !== "N2") {
    throw new Error("Narration seat must be N1 or N2");
  }
  const normalizedCrossfadeMs = Number.isFinite(crossfadeMs)
    ? Math.min(500, Math.max(0, crossfadeMs))
    : 20;
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter?.bed_audio_path || !chapter.overdub_audio_path) {
    throw new Error("Attach both a bed and an overdub before mixing this chapter.");
  }

  const [bed, overdub] = await Promise.all([
    decodeMono44100(projectAssetPath(folder, chapter.bed_audio_path)),
    decodeMono44100(projectAssetPath(folder, chapter.overdub_audio_path)),
  ]);
  const length = Math.max(bed.length, overdub.length);
  const n1 = padFloat32(bed, length);
  const n2 = padFloat32(overdub, length);
  const document = await readChapterDocument(folder, chapter);
  const alignmentValue = chapter.pickups_path
    ? await readJsonIfPresent(projectAssetPath(folder, chapter.pickups_path))
    : null;
  const alignment = alignmentValue ? normalizeAlignment(alignmentValue, chapter.id) : null;
  const timingSource = alignment?.transcript?.some((word) =>
    Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start,
  ) ? "alignment" : "proportional";
  const timelineCore = loadCoreModule("duet-timeline");
  const mixCore = loadCoreModule("duet-mix");
  const segments = timelineCore.buildDuetTimeline(
    document.spans,
    alignment?.transcript ?? [],
    length / 44100,
  );
  assertDuetMixRouting(segments, narrationSeat);
  const mixed = mixCore.mixDuetTracks({
    n1,
    n2,
    sampleRate: 44100,
    segments,
    narrationSeat,
    crossfadeMs: normalizedCrossfadeMs,
  });
  const audioCore = loadCoreModule("audio");
  const stamp = assetStamp();
  const prefix = `audio/duet/${String(chapter.index).padStart(2, "0")}`;
  const mixPath = `${prefix}_mix_${stamp}.wav`;
  const n1StemPath = `${prefix}_N1_${stamp}.wav`;
  const n2StemPath = `${prefix}_N2_${stamp}.wav`;
  await ensureProjectDirectory(folder, path.dirname(mixPath));
  await Promise.all([
    writeFileAtomic(projectAssetPath(folder, mixPath), Buffer.from(audioCore.encodeWavPcm16(mixed.mix, 44100, 1))),
    writeFileAtomic(projectAssetPath(folder, n1StemPath), Buffer.from(audioCore.encodeWavPcm16(mixed.n1Stem, 44100, 1))),
    writeFileAtomic(projectAssetPath(folder, n2StemPath), Buffer.from(audioCore.encodeWavPcm16(mixed.n2Stem, 44100, 1))),
  ]);
  // Keep the alignment file after mixing. It is the timeline source for a
  // subsequent remix and powers the seat-filtered pickup list; bed/overdub
  // replacement and script edits already clear it before this point.
  const now = new Date().toISOString();
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? {
          ...resetChapterAudioFields(candidate, { preserveDuetTracks: true }),
          audio_path: mixPath,
          duet_mix_path: mixPath,
          n1_stem_path: n1StemPath,
          n2_stem_path: n2StemPath,
          ...(alignment ? {
            open_pickups: alignment.pickups.filter((pickup) => pickup.status === "open").length,
          } : {}),
          acx_traffic_light: undefined,
          updated_at: now,
        }
      : candidate),
    updated_at: now,
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, mixPath, n1StemPath, n2StemPath, segments: segments.length, timingSource };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function padFloat32(samples, length) {
  const output = new Float32Array(length);
  output.set(samples.subarray(0, length));
  return output;
}

function mixInterleavedToMono(samples, channels) {
  const count = Math.max(1, Math.floor(channels || 1));
  if (count === 1) {
    return Array.from(samples);
  }
  const frames = Math.floor(samples.length / count);
  const output = new Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < count; channel += 1) {
      sum += samples[frame * count + channel];
    }
    output[frame] = sum / count;
  }
  return output;
}

function resampleLinearArray(samples, fromRate, toRate) {
  if (samples.length === 0 || fromRate <= 0 || fromRate === toRate) {
    return samples;
  }
  const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(samples.length - 1, left)] ?? 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

async function exportDeliveryPack(folder, project) {
  await assertProjectEnvelope(folder, project);
  const masterCore = loadCoreModule("master");
  const exportCore = loadCoreModule("export");
  const settings = normalizeProjectSettings(project.settings);
  const preset = masterCore.resolvePreset(settings.spec_preset_id);
  const profile = masterCore.deliveryProfile(preset);
  await ensureProjectDirectory(folder, "export");
  const outputFolder = projectAssetPath(folder, path.join("export", profile.folderName));
  // Build beside the previous pack and swap only after every chapter and
  // report has succeeded. A failed retry must not erase a usable export.
  const stagingOutputFolder = await fs.mkdtemp(path.join(path.dirname(outputFolder), `.${profile.folderName}-staging-`));
  const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-desk-export-"));
  const entries = [];
  const outputFiles = [];
  let retailPcm = null;
  let retailChapter = null;

  try {
    const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
    if (chapters.length === 0) {
      throw new Error("Add at least one chapter before exporting a delivery pack");
    }

    const readiness = exportCore.getExportReadiness(project);
    if (!readiness.ready) {
      const titles = readiness.missingAudio.map((chapter) => chapter.title);
      const preview = titles.slice(0, 3).join(", ");
      const suffix = titles.length > 3 ? ` and ${titles.length - 3} more` : "";
      throw new Error(
        `${preset.label} export is blocked: attach audio for ${titles.length} chapter${titles.length === 1 ? "" : "s"} first (${preview}${suffix}).`,
      );
    }

    for (const chapter of chapters) {
      const decoded = await decodeAudioPcm(folder, chapter.audio_path);
      const sourceReport = measureDecodedAudio(masterCore, decoded, preset);
      const fileName = exportCore.chapterFileName(chapter, profile.extension);
      const repaired = await repairAudioFile(masterCore, folder, chapter.audio_path, decoded);
      const repairAssessment = masterCore.assessRepairCandidate(
        float32View(decoded.pcm),
        float32View(repaired.pcm),
      );
      if (repairAssessment.applied && !repairAssessment.safe) {
        entries.push({
          fileName,
          before: sourceReport,
          status: "fail",
          note: `${repairAssessment.reason} Kosmos found click or clipping damage across ${(repairAssessment.changedRatio * 100).toFixed(1)}% of the take; record a cleaner pickup instead of applying a destructive whole-file repair.`,
        });
        continue;
      }
      const prepared = repairAssessment.applied ? repaired : decoded;
      const automaticRestoration = repairAssessment.applied
        ? {
            changedSamples: repairAssessment.changedSamples,
            changedRatio: repairAssessment.changedRatio,
            levelShiftDb: repairAssessment.levelShiftDb,
          }
        : undefined;
      const firstMaster = masterDecodedAudio(masterCore, prepared, preset, profile, settings);
      let master = firstMaster;
      let automaticNoiseReductionDb;

      if (firstMaster.status !== "ok" && firstMaster.abort_code === "noise_floor" && profile.noiseFloorMaxDbfs !== null) {
        const strengths = masterCore.noiseReductionAttempts(
          firstMaster.predicted_floor_dbfs,
          profile.noiseFloorMaxDbfs,
        );
        for (const strength of strengths) {
          const cleaned = await denoiseAudioFile(
            masterCore,
            folder,
            chapter.audio_path,
            decoded,
            firstMaster.before.noise_floor_dbfs,
            strength,
            repairAssessment.applied ? masterCore.AUTOMATIC_REPAIR_FILTER : undefined,
          );
          const candidate = masterDecodedAudio(masterCore, cleaned, preset, profile, settings);
          master = candidate;
          automaticNoiseReductionDb = strength;
          if (candidate.status === "ok" || candidate.abort_code !== "noise_floor") {
            break;
          }
        }
      }

      const processing = automaticRestoration || automaticNoiseReductionDb
        ? {
            ...(automaticRestoration ? { automaticRestoration } : {}),
            ...(automaticNoiseReductionDb ? { automaticNoiseReductionDb } : {}),
          }
        : undefined;
      if (master.status !== "ok") {
        const cleanup = automaticNoiseReductionDb
          ? ` Automatic cleanup tried ${automaticNoiseReductionDb} dB, the safe cap for unattended narration.`
          : "";
        entries.push({
          fileName,
          before: sourceReport,
          status: "fail",
          processing,
          note: `${master.abort_reason ?? "Mastering stopped."}${cleanup}`,
        });
        continue;
      }

      if (!retailPcm) {
        retailPcm = master.samples;
        retailChapter = chapter;
      }

      const temporaryPcm = path.join(temporaryFolder, `${chapter.id}.f32le`);
      await fs.writeFile(temporaryPcm, Buffer.from(master.samples.buffer, master.samples.byteOffset, master.samples.byteLength));
      const destination = projectAssetPath(
        folder,
        path.relative(folder, path.join(stagingOutputFolder, fileName)),
      );
      await encodeDeliveryAudio(
        temporaryPcm,
        destination,
        profile,
        0,
        master.samples.length / master.sampleRate,
      );
      const measured = await decodeAudioPcmAtPath(
        folder,
        path.relative(folder, destination),
        projectAssetPath,
      );
      const measuredSamples = float32View(measured.pcm);
      const after = masterCore.measurePcm({
          samples: measuredSamples,
          sampleRate: measured.sampleRate,
          channels: measured.channels,
          format: profile.container,
          bitrate_kbps: measured.bitrateKbps,
          vbr: measured.vbr,
      }, { preset });
      // The take as it arrived, not the resampled mono the gain maths works on,
      // so the report can show what mastering changed about the file.
      entries.push({
        fileName,
        before: sourceReport,
        after,
        status: reportStatus(after),
        processing,
      });
      outputFiles.push(fileName);
    }

    const failedEntries = entries.filter((entry) => entry.status === "fail");
    if (failedEntries.length > 0) {
      const preview = failedEntries.slice(0, 3).map((entry) => `${entry.fileName}: ${entry.note || `failed ${preset.label} checks`}`).join("; ");
      const suffix = failedEntries.length > 3 ? `; and ${failedEntries.length - 3} more` : "";
      throw new Error(`${preset.label} export stopped because ${failedEntries.length} chapter${failedEntries.length === 1 ? "" : "s"} failed: ${preview}${suffix}`);
    }

    const plan = exportCore.buildExportPlan(project, { profile });
    for (const readme of plan.readmeFiles) {
      await writeFileAtomic(
        projectAssetPath(folder, path.relative(folder, path.join(stagingOutputFolder, readme.fileName))),
        readme.contents,
        "utf8",
      );
    }

    const retailSpec = exportCore.ACX_SPEC?.retail_sample_s ?? { min: 60, max: 300 };
    if (profile.includeRetailSample && retailChapter && retailPcm) {
      const samples = retailPcm;
      const start = Math.min(samples.length, Math.round(profile.headSeconds * profile.sampleRate));
      const availableLength = Math.max(0, samples.length - start);
      const minimumSamples = Math.round(retailSpec.min * profile.sampleRate);
      if (availableLength >= minimumSamples) {
        const sampleLength = Math.min(availableLength, Math.round(retailSpec.max * profile.sampleRate));
        const samplePath = path.join(temporaryFolder, "retail.f32le");
        const sampleBytes = samples.slice(start, start + sampleLength);
        await fs.writeFile(samplePath, Buffer.from(sampleBytes.buffer, sampleBytes.byteOffset, sampleBytes.byteLength));
        const retailName = `99_retail_sample.${profile.extension}`;
        const retailOutput = projectAssetPath(
          folder,
          path.relative(folder, path.join(stagingOutputFolder, retailName)),
        );
        await encodeDeliveryAudio(
          samplePath,
          retailOutput,
          profile,
          0,
          sampleLength / profile.sampleRate,
        );
        outputFiles.push(retailName);
        const retailMeasured = await decodeAudioPcmAtPath(
          folder,
          path.relative(folder, retailOutput),
          projectAssetPath,
        );
        const retailReport = masterCore.measurePcm({
          samples: float32View(retailMeasured.pcm),
          sampleRate: retailMeasured.sampleRate,
          channels: retailMeasured.channels,
          format: profile.container,
          bitrate_kbps: retailMeasured.bitrateKbps,
          vbr: retailMeasured.vbr,
        }, { requireRoomTone: false, preset });
        entries.push({
          fileName: retailName,
          after: retailReport,
          status: reportStatus(retailReport),
          note: `Starts after the lead-in of ${retailChapter.title}; ${(sampleLength / profile.sampleRate).toFixed(1)} seconds selected. Review the range.`,
        });
      } else {
        entries.push({
          fileName: `99_retail_sample.${profile.extension}`,
          status: "not_measured",
          note: `${retailChapter.title} has only ${(availableLength / profile.sampleRate).toFixed(1)} seconds after its lead-in; at least ${retailSpec.min} seconds are required.`,
        });
      }
    } else if (profile.includeRetailSample) {
      entries.push({ fileName: `99_retail_sample.${profile.extension}`, status: "not_measured", note: "Attach chapter audio to create a retail sample." });
    }

    const report = exportCore.reportText(entries);
    await writeFileAtomic(
      projectAssetPath(folder, path.relative(folder, path.join(stagingOutputFolder, "REPORT.txt"))),
      report,
      "utf8",
    );
    await replaceDirectory(stagingOutputFolder, outputFolder);
    const warningCount = entries.filter((entry) => entry.status === "warn" || entry.status === "not_measured").length;
    const result = {
      folder: outputFolder,
      files: outputFiles,
      entries,
      report,
      status: warningCount > 0 ? "ready_with_warnings" : "ready",
      warningCount,
      targetId: preset.id,
      targetLabel: preset.label,
      profileDescription: profile.description,
      container: profile.container,
      profile,
    };
    try {
      revealDeliveryPack(folder, profile.folderName, outputFiles);
    } catch {
      // The pack is already on disk. Finder is a courtesy, not the export.
    }
    return result;
  } finally {
    await fs.rm(temporaryFolder, { recursive: true, force: true });
    await fs.rm(stagingOutputFolder, { recursive: true, force: true });
  }
}

function masterDecodedAudio(masterCore, decoded, preset, profile, settings) {
  return masterCore.masterPcm({
    samples: float32View(decoded.pcm),
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    format: decoded.format,
    bitrate_kbps: decoded.bitrateKbps,
    vbr: decoded.vbr,
  }, {
    preset,
    profile,
    targetRmsDbfs: preset.id === "acx" ? settings.acx_target_rms_dbfs : undefined,
  });
}

function measureDecodedAudio(masterCore, decoded, preset) {
  return masterCore.measurePcm({
    samples: float32View(decoded.pcm),
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    format: decoded.format,
    bitrate_kbps: decoded.bitrateKbps,
    vbr: decoded.vbr,
  }, { preset });
}

/**
 * Repair clipped peaks and isolated impulses before any spectral or level
 * processing can smear them. Overlap-save leaves every sample outside FFmpeg's
 * detected regions untouched; `assessRepairCandidate` independently rejects a
 * result that is widespread or changes programme level.
 */
async function repairAudioFile(masterCore, folder, relativePath, metadata) {
  const audioPath = projectAudioPath(folder, relativePath);
  const pcm = await runFfmpeg([
    "-v", "error",
    "-i", audioPath,
    "-af", masterCore.AUTOMATIC_REPAIR_FILTER,
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(metadata.sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Automatic click and clipping repair returned no complete PCM frames.");
  }
  return {
    ...metadata,
    pcm,
  };
}

/**
 * FFmpeg's adaptive FFT denoiser is bundled with Kosmos. It tracks a steady
 * floor and applies only the reduction required by the failed first pass,
 * capped at 12 dB so unattended cleanup does not turn narration metallic.
 */
async function denoiseAudioFile(
  masterCore,
  folder,
  relativePath,
  metadata,
  noiseFloorDbfs,
  reductionDb,
  repairFilter,
) {
  const audioPath = projectAudioPath(folder, relativePath);
  const denoiseFilter = masterCore.afftdnFilter(noiseFloorDbfs, reductionDb);
  const filter = repairFilter ? `${repairFilter},${denoiseFilter}` : denoiseFilter;
  const pcm = await runFfmpeg([
    "-v", "error",
    "-i", audioPath,
    "-af", filter,
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "-ac", String(metadata.channels),
    "-ar", String(metadata.sampleRate),
    "pipe:1",
  ], { maxOutputBytes: MAX_PCM_OUTPUT_BYTES });
  if (pcm.length === 0 || pcm.length % (4 * metadata.channels) !== 0) {
    throw new Error("Automatic noise reduction returned no complete PCM frames.");
  }
  return {
    ...metadata,
    pcm,
  };
}

function reportStatus(report) {
  if (report.traffic_light === "red") {
    return "fail";
  }
  if (report.traffic_light === "yellow") {
    return "warn";
  }
  return "pass";
}

function revealDeliveryPack(folder, folderName, files) {
  const exportCore = loadCoreModule("export");
  const targetName = exportCore.revealTargetInExportPack(files ?? []);
  const preferred = projectAssetPath(folder, path.join("export", folderName, targetName));
  const fallback = projectAssetPath(folder, path.join("export", folderName));
  const target = fsSync.existsSync(preferred) ? preferred : fallback;
  if (!fsSync.existsSync(target)) {
    throw new Error("The delivery pack folder is missing.");
  }
  shell.showItemInFolder(target);
}

async function showDeliveryPack(folder, project) {
  await assertProjectEnvelope(folder, project);
  const masterCore = loadCoreModule("master");
  const settings = normalizeProjectSettings(project.settings);
  const preset = masterCore.resolvePreset(settings.spec_preset_id);
  const profile = masterCore.deliveryProfile(preset);
  const packFolder = projectAssetPath(folder, path.join("export", profile.folderName));
  if (!fsSync.existsSync(packFolder)) {
    throw new Error(`Export the ${preset.label} pack first.`);
  }
  const names = (await fs.readdir(packFolder)).filter((name) => !name.startsWith("."));
  revealDeliveryPack(folder, profile.folderName, names);
  return { folder: packFolder, shown: true };
}

async function shareProjectZip(folder, project, lightPack) {
  await assertProjectEnvelope(folder, project);
  const result = await dialog.showSaveDialog({
    title: lightPack ? "Save a light collaborator pack" : "Save a collaborator pack",
    defaultPath: path.join(
      path.dirname(folder),
      `${path.basename(folder).replace(/\.booth$/i, "")}-collaborator.zip`,
    ),
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  const sharingCore = loadCoreModule("sharing");
  const available = await collectProjectFiles(folder);
  // A user may choose a ZIP path inside the project. Compare resolved paths
  // instead of raw strings so Windows separators/casing cannot make the ZIP
  // include itself recursively on the next share.
  const outputAbsolute = path.resolve(result.filePath);
  const normalizedForCompare = (value) => process.platform === "win32" || process.platform === "darwin"
    ? value.toLocaleLowerCase("en-US")
    : value;
  const filtered = available.filter((relativePath) =>
    normalizedForCompare(path.resolve(folder, relativePath)) !== normalizedForCompare(outputAbsolute),
  );
  const relativePaths = sharingCore.planSharePaths(project, filtered, { lightPack: Boolean(lightPack) });
  if (relativePaths.length === 0) {
    throw new Error("There are no shareable project files yet.");
  }
  return zipProjectFolder({
    folder,
    outputPath: result.filePath,
    relativePaths,
  });
}

async function shareSeatPack(folder, project, seat) {
  await assertProjectEnvelope(folder, project);
  if (project.mode !== "duet") {
    throw new Error("Switch the project to duet mode before exporting a seat pack.");
  }
  if (seat !== "N1" && seat !== "N2") {
    throw new Error("Seat pack must be N1 or N2");
  }
  const result = await dialog.showSaveDialog({
    title: `Save ${seat} seat pack`,
    defaultPath: path.join(path.dirname(folder), `${slugFileName(project.name)}-${seat}-seat-pack.zip`),
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  const duetCore = loadCoreModule("duet-seats");
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "booth-seat-pack-"));
  const staging = path.join(temporaryRoot, `${slugFileName(project.name)}-${seat}.booth`);
  try {
    await ensureProjectLayout(staging);
    const includedChapters = [];
    for (const chapter of [...(project.chapters ?? [])].sort((a, b) => a.index - b.index)) {
      const document = await readChapterDocument(folder, chapter);
      const spans = duetCore.filterSpansForSeat(document.spans, seat);
      if (spans.length === 0) {
        continue;
      }
      await writeChapterDocument(staging, chapter.text_path, { ...document, spans });
      let subset = duetCore.seatPackChapterSubset(chapter);
      if (chapter.bed_audio_path) {
        await copyProjectAsset(folder, staging, chapter.bed_audio_path);
      }
      if (chapter.pickups_path) {
        try {
          const alignment = normalizeAlignment(
            JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.pickups_path), "utf8")),
            chapter.id,
          );
          const pickups = alignment.pickups
            .filter((pickup) =>
              pickup.seat === seat || (seat === "N1" && pickup.seat === "narration"),
            );
          // A seat pack is a least-privilege subset. Pickup timing is useful to
          // the selected narrator, but the full transcript can expose the
          // other narrator's words and is not needed to record against the
          // supplied bed.
          await writeJsonAtomic(projectAssetPath(staging, chapter.pickups_path), {
            ...alignment,
            transcript: [],
            pickups,
          });
          subset = {
            ...subset,
            open_pickups: pickups.filter((pickup) => pickup.status === "open").length,
          };
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            throw error;
          }
        }
      }
      includedChapters.push(subset);
    }
    if (includedChapters.length === 0) {
      throw new Error(`No script spans are assigned to ${seat}.`);
    }

    const glossary = [];
    for (const entry of project.glossary ?? []) {
      if (entry.clip_path) {
        await copyProjectAsset(folder, staging, entry.clip_path);
      }
      glossary.push(entry);
    }
    const subsetProject = {
      ...project,
      chapters: includedChapters,
      room_test_path: undefined,
      people: (project.people ?? []).filter((person) => person.role === "author" || person.seat === seat),
      glossary,
      chapter_notes: (project.chapter_notes ?? []).filter((note) =>
        includedChapters.some((chapter) => chapter.id === note.chapter_id),
      ),
      punch_recordings: [],
      updated_at: new Date().toISOString(),
    };
    await writeJsonAtomic(projectAssetPath(staging, "project.json"), subsetProject);
    await copyProjectAsset(folder, staging, "acx_spec.json", true);
    await writeFileAtomic(
      projectAssetPath(staging, "SEAT_PACK_README.txt"),
      [
        `Kosmos ${seat} seat pack`,
        "",
        "Duet means each character keeps the same narrator inside every POV.",
        "This subset contains only your assigned lines (plus narration for N1), author notes, glossary clips, and any bed audio.",
        "Return recorded audio through the shared full Kosmos project folder; this ZIP is not a cloud invitation.",
        "",
      ].join("\n"),
      "utf8",
    );
    const files = await collectProjectFiles(staging);
    return await zipProjectFolder({ folder: staging, outputPath: result.filePath, relativePaths: files });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function copyProjectAsset(sourceFolder, destinationFolder, relativePath, optional = false) {
  try {
    const source = projectAssetPath(sourceFolder, relativePath);
    const destination = projectAssetPath(destinationFolder, relativePath);
    await ensureProjectDirectory(destinationFolder, path.dirname(relativePath));
    await copyFileAtomic(source, destination);
  } catch (error) {
    if (optional && error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function collectProjectFiles(folder, current = "") {
  const directory = path.join(folder, current);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relative = current ? path.join(current, entry.name) : entry.name;
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await collectProjectFiles(folder, relative));
    } else if (entry.isFile()) {
      files.push(relative.replaceAll(path.sep, "/"));
    }
  }
  return files;
}

async function encodeDeliveryAudio(inputPath, outputPath, profile, startSeconds, durationSeconds) {
  const args = [
    "-y", "-v", "error",
    "-f", "f32le", "-ar", String(profile.sampleRate), "-ac", String(profile.channels),
    "-ss", String(Math.max(0, startSeconds)),
    "-t", String(Math.max(0, durationSeconds)),
    "-i", inputPath,
    "-map_metadata", "-1",
  ];
  if (profile.container === "mp3") {
    args.push(
      "-codec:a", "libmp3lame",
      "-b:a", `${profile.bitrateKbps ?? 192}k`,
      "-ar", String(profile.sampleRate),
      "-ac", String(profile.channels),
      "-write_xing", "0",
    );
  } else {
    args.push(
      "-codec:a", profile.pcmBitDepth === 24 ? "pcm_s24le" : "pcm_s16le",
      "-ar", String(profile.sampleRate),
      "-ac", String(profile.channels),
    );
  }
  args.push(outputPath);
  await runFfmpeg(args);
}

function loadCoreModule(name) {
  const candidates = [
    path.join(app.getAppPath(), "dist-core", `${name}.cjs`),
    path.join(__dirname, "..", "dist-core", `${name}.cjs`),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next build location.
    }
  }
  throw new Error("The audio core is not bundled. Run npm run build before exporting.");
}

function loadPronunciationLexicon() {
  if (pronunciationLexicon) {
    return pronunciationLexicon;
  }
  const roots = [
    path.join(process.resourcesPath, "cmudict", "cmudict.dict"),
    path.join(app.getAppPath(), "vendor", "cmudict", "cmudict.dict"),
    path.join(__dirname, "..", "vendor", "cmudict", "cmudict.dict"),
  ];
  const source = roots.find((candidate) => fsSync.existsSync(candidate));
  if (!source) {
    return undefined;
  }
  const glossaryCore = loadCoreModule("glossary");
  pronunciationLexicon = glossaryCore.parsePronouncingDictionary(fsSync.readFileSync(source, "utf8"));
  return pronunciationLexicon;
}

function float32View(bytes) {
  if (bytes.byteLength % 4 !== 0) {
    throw new Error("Decoded PCM output is not aligned to 32-bit samples");
  }
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }
  // Buffers returned by child-process collection can begin at an arbitrary
  // byte offset in a pooled ArrayBuffer. Copy misaligned output before
  // exposing it as Float32Array instead of risking a RangeError.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

async function probeAudio(audioPath) {
  try {
    const output = await runCommand(resolveRuntimeBinary({
      name: "ffprobe",
      envVar: "FFPROBE_PATH",
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: !isDevelopment,
    }), [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=channels,sample_rate,duration,bit_rate,codec_name:format=duration,bit_rate,format_name",
      "-of", "json", audioPath,
    ]);
    const value = JSON.parse(output.toString("utf8"));
    const stream = value.streams?.[0] ?? {};
    const format = value.format ?? {};
    const codec = String(stream.codec_name ?? format.format_name ?? "").toLocaleLowerCase("en-US");
    const bitrateKbps = finitePositive(stream.bit_rate ?? format.bit_rate) / 1000;
    let vbr;
    if (codec === "mp3") {
      try {
        const packetOutput = await runCommand(resolveRuntimeBinary({
          name: "ffprobe",
          envVar: "FFPROBE_PATH",
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          requireBundled: !isDevelopment,
        }), [
          "-v", "error", "-select_streams", "a:0", "-show_entries", "packet=size",
          "-read_intervals", "%+30", "-of", "json", audioPath,
        ]);
        const packets = JSON.parse(packetOutput.toString("utf8"));
        vbr = inferMp3Vbr(
          (packets.packets ?? []).map((packet) => packet.size),
          bitrateKbps,
        );
      } catch {
        // A meter can still decode the file when packet inspection is not
        // available; an absent VBR verdict is surfaced as a format warning.
        vbr = undefined;
      }
    }
    const normalized = normalizeProbeMetadata(stream, format);
    return {
      channels: normalized.channels,
      sampleRate: normalized.sampleRate,
      duration: normalized.duration,
      format: normalizeAudioFormat(path.extname(audioPath), stream.codec_name, format.format_name),
      bitrateKbps: bitrateKbps > 0 ? bitrateKbps : undefined,
      vbr,
    };
  } catch (error) {
    // Never substitute 44.1 kHz/mono when probing fails: doing so would make
    // a real 48 kHz or multichannel source appear ACX-compliant after the
    // decoder resamples it. Surface the missing/invalid probe instead.
    throw new Error(`Could not inspect audio metadata: ${String(error)}`);
  }
}

function runFfmpeg(args, options = {}) {
  return runCommand(resolveRuntimeBinary({
    name: "ffmpeg",
    envVar: "FFMPEG_PATH",
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    requireBundled: !isDevelopment,
  }), args, { ...options, timeoutMs: options.timeoutMs ?? FFMPEG_TIMEOUT_MS });
}

function nextChapterIndex(project) {
  let highest = 0;
  for (const chapter of project.chapters ?? []) {
    highest = Math.max(highest, Number(chapter.index) || 0);
  }
  return highest + 1;
}

function countWords(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function estimateDurationMinutes(wordCount) {
  return wordCount > 0 ? (wordCount / 9300) * 60 : 0;
}

function mimeForExtension(extension) {
  return {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
  }[extension.toLowerCase()] || "application/octet-stream";
}

function slugFileName(value) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "pronunciation";
}

async function rememberRecentProject(folder) {
  const statePath = path.join(app.getPath("userData"), "state.json");
  await writeJsonAtomic(statePath, { recentProject: folder });
}

async function reopenRecentProject() {
  const statePath = path.join(app.getPath("userData"), "state.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.name === "SyntaxError")) {
      return null;
    }
    throw error;
  }
  if (typeof state.recentProject !== "string") {
    return null;
  }
  try {
    const opened = await readProjectFolder(state.recentProject);
    return await refreshGlossaryOnOpen(opened);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      // A removable drive or deleted folder should not make every launch fail.
      await fs.rm(statePath, { force: true });
      return null;
    }
    throw error;
  }
}

/**
 * Existing projects may contain suggestions generated before the bundled
 * pronunciation lexicon was available. Re-run automatic suggestions when a
 * project opens so users do not have to discover a separate maintenance
 * button. User-edited rows (respellings, clips, seats, or source=user) are
 * preserved by replaceAutoGlossaryCandidates(). A migration failure must not
 * prevent an otherwise valid book from opening.
 */
async function refreshGlossaryOnOpen(envelope) {
  if (!envelope?.folder || !envelope.project?.chapters?.length) {
    return envelope;
  }
  try {
    return await refreshGlossary(envelope.folder, envelope.project);
  } catch (error) {
    console.warn("Could not refresh pronunciation suggestions while opening the project:", error);
    return envelope;
  }
}

async function ensureProjectLayout(folder) {
  await ensureProjectRoot(folder);
  await Promise.all(
    [
      "manuscript/chapters",
      "manuscript/originals",
      "audio/glossary",
      "alignment",
      "export",
    ].map((relative) => ensureProjectDirectory(folder, relative)),
  );
}

async function writeBundledSpec(folder) {
  const source = path.join(app.getAppPath(), "acx_spec.json");
  try {
    await fs.access(source);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      // Development and packaged builds normally have the root spec. A
      // missing copy should not prevent the project itself from opening.
      return;
    }
    throw error;
  }
  await copyFileAtomic(source, projectAssetPath(folder, "acx_spec.json"));
}

ipcMain.handle("project:new", () => createProjectFolder());
ipcMain.handle("project:open", () => openProjectFolder());
ipcMain.handle("project:recent", () => reopenRecentProject());
ipcMain.handle("project:import-text", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid manuscript import request");
  }
  return importTextFile(payload.folder, payload.project);
});
ipcMain.handle("project:paste-text", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid chapter text request");
  }
  return writePastedText(payload.folder, payload.project, payload.title, payload.text);
});
ipcMain.handle("project:rename-chapter", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter rename request");
  }
  return renameChapterFile(payload.folder, payload.project, payload.chapterId, payload.title);
});
ipcMain.handle("project:split-chapter", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter split request");
  }
  return splitChapterFile(
    payload.folder,
    payload.project,
    payload.chapterId,
    payload.offset,
    payload.secondTitle,
  );
});
ipcMain.handle("project:merge-chapters", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.firstChapterId || !payload?.secondChapterId) {
    throw new Error("Invalid chapter merge request");
  }
  return mergeChapterFiles(
    payload.folder,
    payload.project,
    payload.firstChapterId,
    payload.secondChapterId,
  );
});
ipcMain.handle("project:set-chapter-seat", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter seat request");
  }
  return setChapterSeat(payload.folder, payload.project, payload.chapterId, payload.seat);
});
ipcMain.handle("project:set-mode", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.mode) {
    throw new Error("Invalid project mode request");
  }
  return setProjectMode(payload.folder, payload.project, payload.mode);
});
ipcMain.handle("project:set-chapter-spans", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter span request");
  }
  return setChapterSpans(payload.folder, payload.project, payload.chapterId, payload.spans);
});
ipcMain.handle("project:example", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid example request");
  }
  return loadProofExample(payload.folder, payload.project);
});
ipcMain.handle("project:attach-audio", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid audio attachment request");
  }
  return attachAudioFile(payload.folder, payload.project, payload.chapterId);
});
ipcMain.handle("duet:attach-track", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId || !payload?.kind) {
    throw new Error("Invalid duet track attachment request");
  }
  return attachDuetTrackFile(payload.folder, payload.project, payload.chapterId, payload.kind);
});
ipcMain.handle("glossary:attach-clip", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.glossaryId) {
    throw new Error("Invalid glossary clip request");
  }
  return attachGlossaryClip(payload.folder, payload.project, payload.glossaryId);
});
ipcMain.handle("glossary:relink", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid glossary relink request");
  }
  return relinkGlossary(payload.folder, payload.project);
});
ipcMain.handle("glossary:refresh", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid glossary refresh request");
  }
  return refreshGlossary(payload.folder, payload.project);
});
ipcMain.handle("glossary:suggest-respells", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid respelling request");
  }
  return suggestGlossaryRespells(payload.folder, payload.project);
});
ipcMain.handle("glossary:export-guide", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid voice guide export request");
  }
  return exportVoiceGuide(payload.folder, payload.project, { frequency: payload.frequency });
});
ipcMain.handle("project:chapter-text", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter read request");
  }
  return readChapterText(payload.folder, payload.project, payload.chapterId);
});
ipcMain.handle("project:save-alignment", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid alignment save request");
  }
  return saveAlignment(payload.folder, payload.project, payload.chapterId, payload.pickups, payload.transcript);
});
ipcMain.handle("project:read-alignment", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid alignment read request");
  }
  return readAlignment(payload.folder, payload.project, payload.chapterId);
});
ipcMain.handle("project:read-book-proof", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid book proof read request");
  }
  return readBookProof(payload.folder, payload.project);
});
ipcMain.handle("project:resolve-book-pickups", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.status) {
    throw new Error("Invalid pickup decision request");
  }
  return resolveBookPickups(payload.folder, payload.project, payload.requests, payload.status);
});
ipcMain.handle("project:export-markers", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid marker export request");
  }
  return exportMarkerFiles(payload.folder, payload.project, payload.chapterId, payload.pickups);
});
ipcMain.handle("project:export-pickup-packet", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid packet export request");
  }
  return exportPickupPacket(
    payload.folder,
    payload.project,
    payload.chapterId,
    payload.transcript,
    payload.pickups,
  );
});
ipcMain.handle("project:export-proof-report", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid proof report request");
  }
  return exportProofReportFiles(
    payload.folder,
    payload.project,
    payload.chapterId,
    payload.transcript,
    payload.pickups,
  );
});
ipcMain.handle("recording:save-wav", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid recording save request");
  }
  return saveRecordingWav(payload.folder, payload.project, payload);
});
ipcMain.handle("recording:apply-punch", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid punch application request");
  }
  return applyPunchRecording(payload.folder, payload.project, payload);
});
ipcMain.handle("duet:mix-chapter", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid duet mix request");
  }
  return mixDuetChapterFile(
    payload.folder,
    payload.project,
    payload.chapterId,
    payload.narrationSeat,
    payload.crossfadeMs,
  );
});
ipcMain.handle("audio:url", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio playback request");
  }
  return audioStreamUrl(payload.folder, payload.relativePath);
});
ipcMain.handle("audio:decode", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio decode request");
  }
  return decodeAudioFile(payload.folder, payload.relativePath);
});
ipcMain.handle("audio:metadata", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio metadata request");
  }
  return audioMetadata(payload.folder, payload.relativePath);
});
ipcMain.handle("audio:measure", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio measurement request");
  }
  return measureAudioFile(payload.folder, payload.relativePath, {
    requireRoomTone: payload.requireRoomTone !== false,
    presetId: payload.presetId,
    customPresets: payload.customPresets,
  });
});
ipcMain.handle("proof:transcribe", async (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid transcription request");
  }
  await assertProjectFolder(payload.folder);
  const audioPath = projectAudioPath(payload.folder, payload.relativePath);
  const transcription = await transcribeAudio({
    audioPath,
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    language: payload.language || "en",
    requireBundled: app.isPackaged,
  });
  let silences = [];
  try {
    silences = await measureSilences(audioPath);
  } catch (error) {
    // A transcript without measured silence still proofs words; only the pause
    // flags fall back to the recogniser's timings.
    console.warn(`Silence measurement skipped: ${error?.message ?? error}`);
  }
  return { ...transcription, silences };
});
ipcMain.handle("proof:start-live", async (_event, payload) => {
  if (payload?.chapterId && payload?.folder && payload?.project) {
    boothTape.begin({ chapterId: payload.chapterId });
    boothTapeContext = {
      folder: payload.folder,
      project: payload.project,
      chapterId: payload.chapterId,
    };
  }
  try {
    return await warmLiveTranscription();
  } catch (error) {
    // Starting narration must remain usable with the existing CLI fallback.
    // The first live window will retry the persistent server path and then
    // fall back again if this machine has no server runtime.
    console.warn(`Persistent Whisper warm-up skipped: ${error?.message ?? error}`);
    return { persistent: false, acceleration: "CLI fallback" };
  }
});
ipcMain.handle("proof:stop-live", async () => {
  liveFollowStream.stop();
  liveFollowServer.stop();
  liveAsrServer.stop();
  let saved = { stopped: true };
  if (boothTape.shouldKeep() && boothTapeContext) {
    try {
      const wav = boothTape.encode();
      const result = await saveRecordingWav(boothTapeContext.folder, boothTapeContext.project, {
        kind: "live",
        chapterId: boothTapeContext.chapterId,
        wavBase64: Buffer.from(wav).toString("base64"),
      });
      saved = {
        stopped: true,
        live_audio_path: result.path,
        folder: result.folder,
        project: result.project,
      };
    } catch (error) {
      console.warn(`Booth tape save failed: ${error?.message ?? error}`);
      saved = { stopped: true, tapeError: String(error?.message ?? error) };
    }
  }
  boothTape.take();
  boothTapeContext = null;
  return saved;
});
ipcMain.handle("proof:transcribe-buffer", (_event, payload) => {
  if (!payload?.pcmBase64 && (!payload?.audioBase64 || !payload?.mimeType)) {
    throw new Error("Invalid listen-only transcription request");
  }
  return transcribeAudioBuffer(payload);
});
ipcMain.on("live:pcm", (_event, payload) => {
  if (!payload?.pcmBase64) {
    return;
  }
  try {
    const pcm = decodePcmBase64(payload.pcmBase64);
    boothTape.append(pcm);
    if (liveFollowStream.running) {
      liveFollowStream.write(pcm);
    }
  } catch (error) {
    // Dropping a block costs a moment of follow accuracy; throwing here would
    // surface as an unhandled rejection in the audio path.
    console.warn(`Live follow ingest failed: ${error?.message ?? error}`);
  }
});
ipcMain.handle("proof:model-status", async () => {
  const cached = await modelStatus(app.getPath("userData"));
  if (cached.available) {
    return cached;
  }
  const bundled = await modelStatusForFile(path.join(process.resourcesPath, "models", MODEL.fileName));
  return bundled.available ? { ...bundled, bundled: true } : cached;
});
ipcMain.handle("proof:download-model", async (event) => {
  return downloadModel(app.getPath("userData"), (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("proof:model-progress", progress);
    }
  });
});
const handleDeliveryExport = (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid delivery export request");
  }
  return exportDeliveryPack(payload.folder, payload.project);
};
const handleShowDeliveryPack = (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid delivery pack request");
  }
  return showDeliveryPack(payload.folder, payload.project);
};
ipcMain.handle("delivery:export", handleDeliveryExport);
ipcMain.handle("delivery:show-pack", handleShowDeliveryPack);
// Keep the old channels for installed renderers during a hot update.
ipcMain.handle("acx:export", handleDeliveryExport);
ipcMain.handle("acx:show-pack", handleShowDeliveryPack);
ipcMain.handle("project:review-pack", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid pack review request");
  }
  return reviewCollaboratorPack(payload.folder, payload.project);
});
ipcMain.handle("project:apply-pack", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.stagingId) {
    throw new Error("Invalid pack import request");
  }
  return applyCollaboratorPack(payload.folder, payload.project, payload.stagingId);
});
ipcMain.handle("project:discard-pack", (_event, payload) => {
  if (!payload?.stagingId) {
    throw new Error("Invalid pack discard request");
  }
  return discardImportStaging(payload.stagingId);
});
ipcMain.handle("project:share-zip", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid collaborator pack request");
  }
  return shareProjectZip(payload.folder, payload.project, payload.lightPack);
});
ipcMain.handle("project:share-seat-pack", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.seat) {
    throw new Error("Invalid seat pack request");
  }
  return shareSeatPack(payload.folder, payload.project, payload.seat);
});
ipcMain.handle("identity:get", (_event, payload) => {
  if (!payload?.projectId) {
    throw new Error("Invalid local identity request");
  }
  return loadIdentity(app.getPath("userData"), payload.projectId);
});
ipcMain.handle("identity:set", (_event, payload) => {
  if (!payload?.projectId) {
    throw new Error("Invalid local identity request");
  }
  return saveIdentity(app.getPath("userData"), payload);
});
ipcMain.handle("collab:ice-servers", async () => {
  const secrets = loadTurnSecrets([
    path.join(app.getPath("userData"), "cloudflare-turn.json"),
  ]);
  try {
    return await mintIceServers({ secrets });
  } catch {
    return mintIceServers({ secrets: null });
  }
});
ipcMain.handle("collab:encode-invite", (_event, payload) => {
  if (!payload?.project) {
    throw new Error("Open a book before inviting someone");
  }
  return collabDesk.encodeInvite(payload);
});
ipcMain.handle("collab:decode-invite", (_event, payload) => {
  return collabDesk.decodeInvite(payload?.text ?? "");
});
ipcMain.handle("collab:encode-reply", (_event, payload) => {
  return collabDesk.encodeReply(payload ?? {});
});
ipcMain.handle("collab:decode-reply", (_event, payload) => {
  return collabDesk.decodeReply(payload?.text ?? "");
});
ipcMain.handle("collab:attach", (event, payload) => {
  return collabDesk.attach({
    folder: payload?.folder,
    project: payload?.project,
    identity: payload?.identity,
    send: (text) => event.sender.send("collab:outbound", text),
  });
});
ipcMain.handle("collab:inbound", (_event, text) => collabDesk.inbound(text));
ipcMain.handle("collab:announce", () => collabDesk.announce());
ipcMain.handle("collab:start", () => collabDesk.start());
ipcMain.handle("collab:status", () => collabDesk.snapshot());
ipcMain.handle("collab:disconnect", () => collabDesk.disconnect());
ipcMain.handle("project:save", (_event, payload) => {
  if (!payload || typeof payload.folder !== "string" || !payload.project) {
    throw new Error("Invalid project save request");
  }
  return saveProjectFolder(payload.folder, payload.project);
});

let appUpdater = null;

function broadcastAppUpdate(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("app:update", status);
    }
  }
}

ipcMain.handle("app:update-status", () => appUpdater?.getStatus() ?? {
  phase: "idle",
  skipped: true,
  showBanner: false,
  canInstall: false,
  text: "",
  releasePage: RELEASE_PAGE,
});
ipcMain.handle("app:update-check", () => (appUpdater ? appUpdater.check() : null));
ipcMain.handle("app:update-install", () => (appUpdater ? appUpdater.install() : { installed: false }));
ipcMain.handle("app:open-release", () => shell.openExternal(RELEASE_PAGE));

app.whenReady().then(async () => {
  protocol.handle("booth-audio", handleAudioStreamRequest);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isMicrophonePermission(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => (
    isMicrophonePermission(permission) || permission !== "media"
  ));
  await ensureMicrophoneAccess(systemPreferences);
  createWindow();

  try {
    const { autoUpdater } = require("electron-updater");
    appUpdater = createAppUpdater({
      autoUpdater,
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      send: broadcastAppUpdate,
    });
  } catch {
    appUpdater = null;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  appUpdater?.dispose();
  liveFollowStream.stop();
  liveFollowServer.stop();
  liveAsrServer.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
