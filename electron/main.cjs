const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { transcribeAudio } = require("./asr.cjs");
const { downloadModel, modelStatus } = require("./model.cjs");
const { zipProjectFolder } = require("./share.cjs");
const { loadIdentity, saveIdentity } = require("./identity.cjs");

const isDevelopment = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: "Booth Desk",
    backgroundColor: "#171614",
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
    title: "Choose a folder for the Booth Desk project",
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
    id: `project-${Date.now().toString(36)}`,
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
    created_at: now,
    updated_at: now,
  };
  await ensureProjectLayout(folder);
  await fs.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await writeBundledSpec(folder);
  await rememberRecentProject(folder);
  return { folder, project };
}

async function openProjectFolder() {
  const result = await dialog.showOpenDialog({
    title: "Open a Booth Desk project",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folder = result.filePaths[0];
  const opened = await readProjectFolder(folder);
  await rememberRecentProject(folder);
  return opened;
}

async function readProjectFolder(folder) {
  const project = JSON.parse(await fs.readFile(path.join(folder, "project.json"), "utf8"));
  const normalized = {
    ...project,
    glossary: Array.isArray(project.glossary) ? project.glossary : [],
    chapter_notes: Array.isArray(project.chapter_notes) ? project.chapter_notes : [],
    punch_recordings: Array.isArray(project.punch_recordings) ? project.punch_recordings : [],
  };
  return { folder, project: normalized };
}

async function saveProjectFolder(folder, project) {
  await assertProjectFolder(folder);
  await fs.writeFile(
    path.join(folder, "project.json"),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8",
  );
  await rememberRecentProject(folder);
  return { folder, project };
}

async function importTextFile(folder, project) {
  await assertProjectFolder(folder);
  const result = await dialog.showOpenDialog({
    title: "Import a chapter manuscript",
    properties: ["openFile"],
    filters: [{ name: "Manuscript", extensions: ["txt", "md", "markdown", "docx", "epub", "pdf"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const sourcePath = result.filePaths[0];
  const bytes = await fs.readFile(sourcePath);
  const manuscriptCore = loadCoreModule("manuscript");
  let imported;
  if (path.extname(sourcePath).toLowerCase() === ".pdf") {
    let extracted;
    try {
      extracted = await runCommand("pdftotext", ["-layout", sourcePath, "-"]);
    } catch (error) {
      throw new Error(`Could not extract a PDF text layer. Scanned PDFs are not supported (${String(error)}).`);
    }
    imported = manuscriptCore.fromPlainText(extracted.toString("utf8"), "pdf");
  } else {
    imported = manuscriptCore.importManuscriptBytes(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      path.extname(sourcePath),
    );
  }
  return writeImportedManuscript(folder, project, sourcePath, imported);
}

async function writePastedText(folder, project, title, text) {
  await assertProjectFolder(folder);
  if (typeof title !== "string" || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("A chapter needs a title and some text");
  }
  return writeChapterText(folder, project, title, text);
}

async function loadProofExample(folder, project) {
  await assertProjectFolder(folder);
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
  const destinationRelative = `audio/${String(chapter.index).padStart(2, "0")}_raw.wav`;
  await fs.copyFile(path.join(sourceRoot, "on_vs_in.wav"), path.join(folder, destinationRelative));
  const nextProject = {
    ...created.project,
    chapters: created.project.chapters.map((candidate) => candidate.id === chapter.id
      ? { ...candidate, audio_path: destinationRelative }
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
  await fs.writeFile(
    path.join(folder, chapter.text_path),
    `${JSON.stringify({ schema: 1, spans: [{ text, seat: "narration", style: [] }] }, null, 2)}\n`,
    "utf8",
  );
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, chapter };
}

async function writeImportedManuscript(folder, project, sourcePath, imported) {
  const manuscriptCore = loadCoreModule("manuscript");
  const glossaryCore = loadCoreModule("glossary");
  const sections = manuscriptCore.splitManuscript(imported.text, { idPrefix: "ch" });
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("The manuscript is empty; add some text before importing.");
  }

  await fs.mkdir(path.join(folder, "manuscript", "originals"), { recursive: true });
  await fs.copyFile(
    sourcePath,
    path.join(folder, "manuscript", "originals", path.basename(sourcePath)),
  );

  const firstIndex = nextChapterIndex(project);
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
    const spans = styledSpans.length > 0
      ? styledSpans
      : [{ text: section.text, seat: "narration", style: [] }];
    await fs.writeFile(
      path.join(folder, chapter.text_path),
      `${JSON.stringify({ schema: 1, spans }, null, 2)}\n`,
      "utf8",
    );
    createdChapters.push(chapter);
  }

  const existingUserGlossary = (project.glossary ?? []).filter(
    (entry) => entry.source === "user",
  );
  const autoGlossary = glossaryCore.candidatesToGlossary(
    glossaryCore.extractGlossaryCandidates(imported.text),
  );
  const nextProject = {
    ...project,
    chapters: [...(project.chapters ?? []), ...createdChapters].sort((a, b) => a.index - b.index),
    glossary: [...existingUserGlossary, ...autoGlossary],
    chapter_notes: Array.isArray(project.chapter_notes) ? project.chapter_notes : [],
    updated_at: new Date().toISOString(),
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, chapters: createdChapters, sourcePath, format: imported.format };
}

async function renameChapterFile(folder, project, chapterId, title) {
  await assertProjectFolder(folder);
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
  await assertProjectFolder(folder);
  const manuscriptCore = loadCoreModule("manuscript");
  const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
  const position = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (position < 0) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  const chapter = chapters[position];
  if (chapter.audio_path) {
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
    ...chapter,
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
  await writeChapterDocument(folder, newPath, { ...document, spans: rightSpans });
  const saved = await saveProjectFolder(folder, {
    ...project,
    chapters: renumbered,
    updated_at: now,
  });
  return { ...saved, chapter: created };
}

async function mergeChapterFiles(folder, project, firstChapterId, secondChapterId) {
  await assertProjectFolder(folder);
  const manuscriptCore = loadCoreModule("manuscript");
  const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
  const firstPosition = chapters.findIndex((chapter) => chapter.id === firstChapterId);
  const secondPosition = chapters.findIndex((chapter) => chapter.id === secondChapterId);
  if (firstPosition < 0 || secondPosition !== firstPosition + 1) {
    throw new Error("Only adjacent chapters can be merged in manuscript order.");
  }
  const first = chapters[firstPosition];
  const second = chapters[secondPosition];
  if (first.audio_path || second.audio_path) {
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
    ...first,
    word_count: wordCount,
    estimated_duration_minutes: minutes,
    duration_warning: durationWarning(minutes),
    author_status: "draft",
    updated_at: now,
  };
  chapters.splice(secondPosition, 1);
  const renumbered = chapters.map((candidate, index) => ({ ...candidate, index: index + 1 }));
  await writeChapterDocument(folder, first.text_path, { ...firstDocument, spans });
  const saved = await saveProjectFolder(folder, {
    ...project,
    chapters: renumbered,
    updated_at: now,
  });
  return { ...saved, preservedSourcePath: second.text_path };
}

async function setChapterSeat(folder, project, chapterId, seat) {
  await assertProjectFolder(folder);
  if (seat !== "narration" && seat !== "N1" && seat !== "N2") {
    throw new Error("Seat must be narration, N1, or N2");
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
  const now = new Date().toISOString();
  return saveProjectFolder(folder, {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? { ...candidate, updated_at: now }
      : candidate),
    updated_at: now,
  });
}

async function readChapterDocument(folder, chapter) {
  const value = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.text_path), "utf8"));
  if (!Array.isArray(value.spans)) {
    throw new Error(`Chapter script is missing spans: ${chapter.title}`);
  }
  return value;
}

async function writeChapterDocument(folder, relativePath, value) {
  const destination = projectAssetPath(folder, relativePath);
  await writeJsonAtomic(destination, value);
}

async function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, destination);
}

function nextSplitChapterId(project, baseId) {
  const ids = new Set((project.chapters ?? []).map((chapter) => chapter.id));
  let suffix = 2;
  while (ids.has(`${baseId}-part${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-part${suffix}`;
}

function durationWarning(minutes) {
  return minutes > 120
    ? "Estimated narration is over 120 minutes; ACX requires a chapter split."
    : undefined;
}

async function attachAudioFile(folder, project, chapterId) {
  await assertProjectFolder(folder);
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
  const destinationRelative = `audio/${String(chapter.index).padStart(2, "0")}_raw${extension}`;
  await fs.copyFile(sourcePath, path.join(folder, destinationRelative));
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? { ...candidate, audio_path: destinationRelative }
      : candidate),
    updated_at: new Date().toISOString(),
  };
  const saved = await saveProjectFolder(folder, nextProject);
  return { ...saved, sourcePath, audioPath: path.join(folder, destinationRelative) };
}

async function attachGlossaryClip(folder, project, glossaryId) {
  await assertProjectFolder(folder);
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
  let destinationRelative = `${base}${extension}`;
  let suffix = 2;
  while (await fileExists(path.join(folder, destinationRelative))) {
    destinationRelative = `${base}-${suffix}${extension}`;
    suffix += 1;
  }
  await fs.copyFile(sourcePath, path.join(folder, destinationRelative));
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

async function readChapterText(folder, project, chapterId) {
  await assertProjectFolder(folder);
  const chapter = project.chapters?.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const value = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.text_path), "utf8"));
  const text = Array.isArray(value.spans) ? value.spans.map((span) => span.text).join("") : "";
  return { chapterId, text, spans: value.spans ?? [] };
}

async function saveAlignment(folder, project, chapterId, pickups, transcript) {
  await assertProjectFolder(folder);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  if (!Array.isArray(pickups)) {
    throw new Error("Alignment pickups must be an array");
  }
  const relativePath = chapter.pickups_path || `alignment/${String(chapter.index).padStart(2, "0")}.json`;
  const value = {
    schema: 1,
    chapter_id: chapterId,
    updated_at: new Date().toISOString(),
    transcript: Array.isArray(transcript) ? transcript : [],
    pickups,
  };
  await writeJsonAtomic(projectAssetPath(folder, relativePath), value);
  const now = new Date().toISOString();
  const nextProject = {
    ...project,
    chapters: project.chapters.map((candidate) => candidate.id === chapterId
      ? { ...candidate, pickups_path: relativePath, updated_at: now }
      : candidate),
    updated_at: now,
  };
  return saveProjectFolder(folder, nextProject);
}

async function readAlignment(folder, project, chapterId) {
  await assertProjectFolder(folder);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter?.pickups_path) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.pickups_path), "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function exportMarkerFiles(folder, project, chapterId, pickups) {
  await assertProjectFolder(folder);
  const chapter = (project.chapters ?? []).find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const markersCore = loadCoreModule("markers");
  const outputFolder = path.join(folder, "export", "markers");
  await fs.mkdir(outputFolder, { recursive: true });
  const baseName = `${String(chapter.index).padStart(2, "0")}_${slugFileName(chapter.title)}`;
  const files = markersCore.markerFileSet(baseName, Array.isArray(pickups) ? pickups : []);
  for (const file of files) {
    await fs.writeFile(path.join(outputFolder, file.fileName), file.contents, "utf8");
  }
  return {
    folder: outputFolder,
    files: files.map((file) => file.fileName),
  };
}

async function saveRecordingWav(folder, project, payload) {
  await assertProjectFolder(folder);
  const kind = payload?.kind;
  if (kind !== "chapter" && kind !== "punch" && kind !== "room") {
    throw new Error("Recording kind must be chapter, punch, or room");
  }
  if (typeof payload?.wavBase64 !== "string" || payload.wavBase64.length < 44) {
    throw new Error("Recording did not contain a WAV file");
  }
  const bytes = Buffer.from(payload.wavBase64, "base64");
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Recorder output is not a RIFF/WAVE file");
  }
  const chapter = payload.chapterId
    ? (project.chapters ?? []).find((candidate) => candidate.id === payload.chapterId)
    : null;
  if (kind !== "room" && !chapter) {
    throw new Error("Choose a chapter before saving this recording");
  }
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  let relativePath;
  if (kind === "room") {
    relativePath = `audio/room_test_${stamp}.wav`;
  } else if (kind === "punch") {
    const pickup = typeof payload.pickupId === "string" ? payload.pickupId : "manual";
    relativePath = `audio/pickups/${chapter.id}-${slugFileName(pickup)}-${stamp}.wav`;
  } else {
    relativePath = `audio/${String(chapter.index).padStart(2, "0")}_recorded_${stamp}.wav`;
  }
  const destination = projectAssetPath(folder, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  const now = new Date().toISOString();
  let nextProject = { ...project, updated_at: now };
  if (kind === "room") {
    nextProject.room_test_path = relativePath;
  } else if (kind === "chapter") {
    nextProject.chapters = project.chapters.map((candidate) => candidate.id === chapter.id
      ? { ...candidate, audio_path: relativePath, updated_at: now }
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

async function readAudioFile(folder, relativePath) {
  await assertProjectFolder(folder);
  const audioPath = projectAssetPath(folder, relativePath);
  const bytes = await fs.readFile(audioPath);
  return {
    mime: mimeForExtension(path.extname(audioPath)),
    base64: bytes.toString("base64"),
  };
}

async function decodeAudioFile(folder, relativePath) {
  await assertProjectFolder(folder);
  const audioPath = projectAssetPath(folder, relativePath);
  const metadata = await probeAudio(audioPath);
  const channels = Math.max(1, metadata.channels || 1);
  const sampleRate = Math.max(8000, metadata.sampleRate || 44100);
  const pcm = await runFfmpeg([
    "-v", "error", "-i", audioPath,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", String(channels), "-ar", String(sampleRate), "pipe:1",
  ]);
  return {
    sampleRate,
    channels,
    format: path.extname(audioPath).slice(1).toLowerCase() || "unknown",
    durationSeconds: metadata.duration,
    pcmBase64: pcm.toString("base64"),
  };
}

async function exportAcxPack(folder, project) {
  await assertProjectFolder(folder);
  const masterCore = loadCoreModule("master");
  const exportCore = loadCoreModule("export");
  const outputFolder = path.join(folder, "export", "acx");
  await fs.rm(outputFolder, { recursive: true, force: true });
  await fs.mkdir(outputFolder, { recursive: true });
  const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-desk-export-"));
  const entries = [];
  const outputFiles = [];
  let retailPcm = null;

  try {
    const chapters = [...(project.chapters ?? [])].sort((a, b) => a.index - b.index);
    if (chapters.length === 0) {
      throw new Error("Add at least one chapter before exporting an ACX pack");
    }

    for (const chapter of chapters) {
      if (!chapter.audio_path) {
        entries.push({
          fileName: `chapter_${String(chapter.index).padStart(2, "0")}.mp3`,
          status: "not_measured",
          note: "No audio is attached to this chapter.",
        });
        continue;
      }

      const decoded = await decodeAudioFile(folder, chapter.audio_path);
      const samples = float32FromBase64(decoded.pcmBase64);
      const master = masterCore.masterPcm({
        samples,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
      });
      const fileName = exportCore.chapterFileName(chapter);
      if (master.status !== "ok") {
        entries.push({
          fileName,
          before: master.before,
          status: "fail",
          note: master.abort_reason,
        });
        continue;
      }

      if (!retailPcm) {
        retailPcm = master.samples;
      }

      const temporaryPcm = path.join(temporaryFolder, `${chapter.id}.f32le`);
      await fs.writeFile(temporaryPcm, Buffer.from(master.samples.buffer, master.samples.byteOffset, master.samples.byteLength));
      const destination = path.join(outputFolder, fileName);
      await encodeCbrMp3(temporaryPcm, destination, 0, master.samples.length / 44100);
      const measured = await decodeAudioFile(folder, path.relative(folder, destination));
      const measuredSamples = float32FromBase64(measured.pcmBase64);
      const after = masterCore.measurePcm({
        samples: measuredSamples,
        sampleRate: measured.sampleRate,
        channels: measured.channels,
        format: "mp3",
        bitrate_kbps: 192,
        vbr: false,
      });
      entries.push({ fileName, before: master.before, after, status: after.traffic_light === "red" ? "fail" : "pass" });
      outputFiles.push(fileName);
    }

    const plan = exportCore.buildExportPlan(project);
    for (const readme of plan.readmeFiles) {
      await fs.writeFile(path.join(outputFolder, readme.fileName), readme.contents, "utf8");
    }

    const firstChapter = chapters.find((chapter) => chapter.audio_path);
    if (firstChapter && retailPcm) {
      const samples = retailPcm;
      const start = Math.min(samples.length, Math.round(1.5 * 44100));
      const sampleLength = Math.min(samples.length - start, Math.round(180 * 44100));
      const samplePath = path.join(temporaryFolder, "retail.f32le");
      const sampleBytes = samples.slice(start, start + sampleLength);
      await fs.writeFile(samplePath, Buffer.from(sampleBytes.buffer, sampleBytes.byteOffset, sampleBytes.byteLength));
      await encodeCbrMp3(samplePath, path.join(outputFolder, "99_retail_sample.mp3"), 0, sampleLength / 44100);
      outputFiles.push("99_retail_sample.mp3");
      entries.push({ fileName: "99_retail_sample.mp3", status: "pass", note: "Starts after the chapter lead-in; review the selected range." });
    } else {
      entries.push({ fileName: "99_retail_sample.mp3", status: "not_measured", note: "Attach chapter audio to create a retail sample." });
    }

    const report = exportCore.reportText(entries);
    await fs.writeFile(path.join(outputFolder, "REPORT.txt"), report, "utf8");
    return { folder: outputFolder, files: outputFiles, entries, report };
  } finally {
    await fs.rm(temporaryFolder, { recursive: true, force: true });
  }
}

async function shareProjectZip(folder, project, lightPack) {
  await assertProjectFolder(folder);
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
  const outputRelative = path.relative(folder, result.filePath);
  const filtered = outputRelative && !outputRelative.startsWith("..") && !path.isAbsolute(outputRelative)
    ? available.filter((relativePath) => relativePath !== outputRelative)
    : available;
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
  await assertProjectFolder(folder);
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
      const subset = {
        ...chapter,
        audio_path: undefined,
        overdub_audio_path: undefined,
        duet_mix_path: undefined,
      };
      if (chapter.bed_audio_path) {
        await copyProjectAsset(folder, staging, chapter.bed_audio_path);
      }
      if (chapter.pickups_path) {
        try {
          const alignment = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.pickups_path), "utf8"));
          const pickups = (alignment.pickups ?? []).filter((pickup) =>
            pickup.seat === seat || (seat === "N1" && pickup.seat === "narration"),
          );
          await writeJsonAtomic(projectAssetPath(staging, chapter.pickups_path), { ...alignment, pickups });
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
      people: (project.people ?? []).filter((person) => person.role === "author" || person.seat === seat),
      glossary,
      chapter_notes: (project.chapter_notes ?? []).filter((note) =>
        includedChapters.some((chapter) => chapter.id === note.chapter_id),
      ),
      punch_recordings: [],
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(staging, "project.json"), `${JSON.stringify(subsetProject, null, 2)}\n`, "utf8");
    await copyProjectAsset(folder, staging, "acx_spec.json", true);
    await fs.writeFile(
      path.join(staging, "SEAT_PACK_README.txt"),
      [
        `Booth Desk ${seat} seat pack`,
        "",
        "Duet means each character keeps the same narrator inside every POV.",
        "This subset contains only your assigned lines (plus narration for N1), author notes, glossary clips, and any bed audio.",
        "Return recorded audio through the shared full .booth project; this ZIP is not a cloud invitation.",
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
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
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

async function encodeCbrMp3(inputPath, outputPath, startSeconds, durationSeconds) {
  const args = [
    "-y", "-v", "error",
    "-f", "f32le", "-ar", "44100", "-ac", "1",
    "-ss", String(Math.max(0, startSeconds)),
    "-t", String(Math.max(0, durationSeconds)),
    "-i", inputPath,
    "-map_metadata", "-1",
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "1",
    "-write_xing", "0",
    outputPath,
  ];
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

function float32FromBase64(base64) {
  const bytes = Buffer.from(base64, "base64");
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

async function probeAudio(audioPath) {
  try {
    const output = await runCommand("ffprobe", [
      "-v", "error", "-show_entries", "stream=channels,sample_rate:format=duration",
      "-of", "json", audioPath,
    ]);
    const value = JSON.parse(output.toString("utf8"));
    return {
      channels: Number(value.streams?.[0]?.channels ?? 1),
      sampleRate: Number(value.streams?.[0]?.sample_rate ?? 44100),
      duration: Number(value.format?.duration ?? 0),
    };
  } catch {
    return { channels: 1, sampleRate: 44100, duration: 0 };
  }
}

function runFfmpeg(args) {
  return runCommand(process.env.FFMPEG_PATH || "ffmpeg", args);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
      }
    });
  });
}

async function assertProjectFolder(folder) {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) {
    throw new Error("Project folder must be an absolute path");
  }
  await fs.access(path.join(folder, "project.json"));
}

function nextChapterIndex(project) {
  return Math.max(0, ...(project.chapters ?? []).map((chapter) => Number(chapter.index) || 0)) + 1;
}

function countWords(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function estimateDurationMinutes(wordCount) {
  return wordCount > 0 ? (wordCount / 9300) * 60 : 0;
}

function projectAssetPath(folder, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error("Project asset path must be relative");
  }
  const root = path.resolve(folder);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Project asset path leaves the project folder");
  }
  return resolved;
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify({ recentProject: folder }, null, 2)}\n`, "utf8");
}

async function reopenRecentProject() {
  const statePath = path.join(app.getPath("userData"), "state.json");
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (typeof state.recentProject !== "string") {
      return null;
    }
    return await readProjectFolder(state.recentProject);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.name === "SyntaxError")) {
      return null;
    }
    throw error;
  }
}

async function ensureProjectLayout(folder) {
  await Promise.all(
    [
      "manuscript/chapters",
      "manuscript/originals",
      "audio/glossary",
      "alignment",
      "export",
    ].map((relative) => fs.mkdir(path.join(folder, relative), { recursive: true })),
  );
}

async function writeBundledSpec(folder) {
  const source = path.join(app.getAppPath(), "acx_spec.json");
  try {
    await fs.copyFile(source, path.join(folder, "acx_spec.json"));
  } catch {
    // Development and packaged builds both have the root spec. A missing copy
    // should not prevent the project itself from opening.
  }
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
ipcMain.handle("glossary:attach-clip", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.glossaryId) {
    throw new Error("Invalid glossary clip request");
  }
  return attachGlossaryClip(payload.folder, payload.project, payload.glossaryId);
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
ipcMain.handle("project:export-markers", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid marker export request");
  }
  return exportMarkerFiles(payload.folder, payload.project, payload.chapterId, payload.pickups);
});
ipcMain.handle("recording:save-wav", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid recording save request");
  }
  return saveRecordingWav(payload.folder, payload.project, payload);
});
ipcMain.handle("audio:read", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio read request");
  }
  return readAudioFile(payload.folder, payload.relativePath);
});
ipcMain.handle("audio:decode", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid audio decode request");
  }
  return decodeAudioFile(payload.folder, payload.relativePath);
});
ipcMain.handle("proof:transcribe", (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    throw new Error("Invalid transcription request");
  }
  return transcribeAudio({
    audioPath: projectAssetPath(payload.folder, payload.relativePath),
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    language: payload.language || "en",
  });
});
ipcMain.handle("proof:model-status", () => modelStatus(app.getPath("userData")));
ipcMain.handle("proof:download-model", async (event) => {
  return downloadModel(app.getPath("userData"), (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("proof:model-progress", progress);
    }
  });
});
ipcMain.handle("acx:export", (_event, payload) => {
  if (!payload?.folder || !payload?.project) {
    throw new Error("Invalid ACX export request");
  }
  return exportAcxPack(payload.folder, payload.project);
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
ipcMain.handle("project:save", (_event, payload) => {
  if (!payload || typeof payload.folder !== "string" || !payload.project) {
    throw new Error("Invalid project save request");
  }
  return saveProjectFolder(payload.folder, payload.project);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
