const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, BrowserWindow, dialog, ipcMain, screen, session, shell, systemPreferences } = require("electron");
const { isMicrophonePermission, ensureMicrophoneAccess } = require("./media-access.cjs");
const { downloadModel, proofModelStatus } = require("./model.cjs");
const {
  alignImportedAudioWithWhisperX,
  transcribeImportedAudio,
} = require("./whisperx.cjs");
const { PersistentParakeetServer } = require("./parakeet-server.cjs");
const { PersistentParakeetLive } = require("./parakeet-live.cjs");
const { transcribeAudio, findLiveModel } = require("./asr.cjs");
const { resolveRuntimeBinary } = require("./runtime.cjs");
const {
  applyPunch,
  previewPunch,
  undoLatestPunch,
  masterWorkingFile,
  measureChapterAudio,
  measureSilences,
  exportDeliveryPack,
  transcodeToWav,
  isWavBuffer,
} = require("./labs-audio.cjs");
const { createAppUpdater, RELEASE_PAGE } = require("./app-update.cjs");
const { terminateActiveCommands } = require("./process.cjs");
const { isTrustedRenderer, secureRendererWindow } = require("./window-security.cjs");

const execFileAsync = promisify(execFile);

/** Shared GitHub Releases updater; reuses the same feed as the original app. */
let labsAppUpdater = null;

function bindHandle(channel, listener) {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // First registration in this process.
  }
  ipcMain.handle(channel, listener);
}

function bindChapterDelete() {
  bindHandle("labs:chapter-delete", (_event, payload) =>
    deleteChapterFiles(payload?.folder, payload?.chapterId),
  );
}

let pronunciationLexicon;

function loadGlossaryCore() {
  const candidates = [
    path.join(app.getAppPath(), "dist-core", "glossary.cjs"),
    path.join(__dirname, "..", "dist-core", "glossary.cjs"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next build location.
    }
  }
  throw new Error("The glossary core is not bundled. Run npm run build:core first.");
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
  pronunciationLexicon = loadGlossaryCore().parsePronouncingDictionary(fsSync.readFileSync(source, "utf8"));
  return pronunciationLexicon;
}

function suggestGlossaryRespells(glossary) {
  const list = Array.isArray(glossary) ? glossary : [];
  const lexicon = loadPronunciationLexicon();
  if (!lexicon) {
    return { ok: false, reason: "The pronouncing dictionary is not bundled with this build.", glossary: list, filled: 0, unknown: [] };
  }
  const result = loadGlossaryCore().fillGlossaryRespells(list, lexicon);
  return { ok: true, glossary: result.glossary, filled: result.filled, unknown: result.unknown };
}

bindHandle("labs:glossary-suggest", (_event, payload) => suggestGlossaryRespells(payload?.glossary));

function broadcastLabsUpdate(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("labs:app-update", status);
    }
  }
}

function ensureLabsUpdater() {
  if (labsAppUpdater) {
    return labsAppUpdater;
  }
  try {
    const { autoUpdater } = require("electron-updater");
    labsAppUpdater = createAppUpdater({
      autoUpdater,
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      send: broadcastLabsUpdate,
    });
  } catch {
    labsAppUpdater = null;
  }
  return labsAppUpdater;
}

function idleUpdateStatus() {
  return {
    phase: "idle",
    currentVersion: app.getVersion(),
    skipped: true,
    showBanner: false,
    canInstall: false,
    text: "",
    releasePage: RELEASE_PAGE,
  };
}

let liquidGlass = null;
try {
  liquidGlass = require("electron-liquid-glass").default ?? require("electron-liquid-glass");
} catch (error) {
  console.warn("[labs] electron-liquid-glass unavailable", error);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.setName("Kosmos Labs");
app.setPath("userData", path.join(app.getPath("appData"), "booth-desk-labs"));

/** Same cache Kosmos uses for proofreading speech models. */
function mainUserDataPath() {
  return path.join(app.getPath("appData"), "booth-desk");
}

/**
 * The workspace is the folder chosen during onboarding. Every book project is a
 * subfolder inside it, marked by a project.json. We persist the choice so the
 * shelf reopens the same workspace across launches.
 */
let grantedFolderPath = null;
let micSessionCleared = false;

function workspaceSettingsPath() {
  return path.join(app.getPath("userData"), "labs-workspace.json");
}

async function loadWorkspacePath() {
  try {
    const raw = await fs.readFile(workspaceSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.workspace === "string") {
      grantedFolderPath = parsed.workspace;
    }
  } catch {
    // No saved workspace yet; onboarding will set one.
  }
  return grantedFolderPath;
}

async function persistWorkspacePath(next) {
  try {
    if (next) {
      await fs.writeFile(workspaceSettingsPath(), JSON.stringify({ workspace: next }), "utf8");
    } else {
      await fs.rm(workspaceSettingsPath(), { force: true });
    }
  } catch {
    // Non-fatal; the workspace just won't be remembered next launch.
  }
}

function getMicrophoneStatus() {
  if (typeof systemPreferences.getMediaAccessStatus === "function") {
    return systemPreferences.getMediaAccessStatus("microphone");
  }
  return "unknown";
}

async function requestMicrophoneAccess() {
  micSessionCleared = false;
  await ensureMicrophoneAccess(systemPreferences);
  const status = getMicrophoneStatus();
  return {
    granted: status === "granted",
    status,
  };
}

function getMicrophoneAccess() {
  if (micSessionCleared) {
    return { granted: false, status: "prompt" };
  }
  const status = getMicrophoneStatus();
  return {
    granted: status === "granted",
    status,
  };
}

async function requestFolderAccess() {
  if (!labWindow || labWindow.isDestroyed()) {
    return { granted: Boolean(grantedFolderPath), path: grantedFolderPath || undefined };
  }
  const result = await dialog.showOpenDialog(labWindow, {
    title: "Choose your Kosmos workspace",
    message: "Pick the folder where Kosmos stores and opens your audiobook projects.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { granted: Boolean(grantedFolderPath), path: grantedFolderPath || undefined };
  }
  grantedFolderPath = result.filePaths[0];
  await persistWorkspacePath(grantedFolderPath);
  return { granted: true, path: grantedFolderPath };
}

function getFolderAccess() {
  return {
    granted: Boolean(grantedFolderPath),
    path: grantedFolderPath || undefined,
  };
}

// ── Workspace projects (folder-per-book) ──────────────────────

const PROJECT_MARKER = "project.json";

function getWorkspace() {
  return { workspace: grantedFolderPath || null };
}

function safeFolderName(title) {
  const cleaned = String(title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Untitled book";
}

async function uniqueProjectDir(workspace, base) {
  let name = base;
  let counter = 2;
  // Append a counter until the folder name is free.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(workspace, name);
    try {
      await fs.access(candidate);
      name = `${base} ${counter++}`;
    } catch {
      return candidate;
    }
  }
}

async function readProjectMarker(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, PROJECT_MARKER), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.chapters)) {
      return parsed;
    }
  } catch {
    // Not a Kosmos project folder.
  }
  return null;
}

function isInsideWorkspace(folder) {
  if (!grantedFolderPath || typeof folder !== "string") {
    return false;
  }
  const ws = path.resolve(grantedFolderPath);
  const target = path.resolve(folder);
  return target === ws || target.startsWith(ws + path.sep);
}

/**
 * Books kept outside the workspace ("linked" / extended branch) are tracked by
 * absolute path here so they still show on the shelf.
 */
function externalRegistryPath() {
  return path.join(app.getPath("userData"), "labs-external-projects.json");
}

async function readExternalPaths() {
  try {
    const raw = await fs.readFile(externalRegistryPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

async function writeExternalPaths(paths) {
  try {
    await fs.writeFile(externalRegistryPath(), JSON.stringify(paths, null, 2), "utf8");
  } catch {
    // Non-fatal; linked books just won't persist across launches.
  }
}

async function listWorkspaceProjects() {
  const workspace = grantedFolderPath;
  const projects = [];
  const seenIds = new Set();

  if (workspace) {
    let entries = [];
    try {
      entries = await fs.readdir(workspace, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dir = path.join(workspace, entry.name);
      const marker = await readProjectMarker(dir);
      if (marker) {
        projects.push({ ...marker, folder: dir, external: false });
        if (typeof marker.id === "string") {
          seenIds.add(marker.id);
        }
      }
    }
  }

  // Merge linked (external) books, pruning any that moved into the workspace,
  // duplicate an existing id, or no longer exist.
  const external = await readExternalPaths();
  const keptExternal = [];
  for (const dir of external) {
    if (isInsideWorkspace(dir)) {
      continue;
    }
    const marker = await readProjectMarker(dir);
    if (!marker) {
      continue;
    }
    if (typeof marker.id === "string" && seenIds.has(marker.id)) {
      continue;
    }
    if (typeof marker.id === "string") {
      seenIds.add(marker.id);
    }
    projects.push({ ...marker, folder: dir, external: true });
    keptExternal.push(dir);
  }
  if (keptExternal.length !== external.length) {
    await writeExternalPaths(keptExternal);
  }

  return { workspace: workspace || null, projects };
}

async function moveProjectIntoWorkspace(folder) {
  if (!grantedFolderPath || typeof folder !== "string") {
    return { ok: false };
  }
  const marker = await readProjectMarker(folder);
  if (!marker) {
    return { ok: false, invalid: true };
  }
  if (isInsideWorkspace(folder)) {
    return { ok: true, project: { ...marker, folder, external: false } };
  }
  const dest = await uniqueProjectDir(grantedFolderPath, safeFolderName(marker.title || path.basename(folder)));
  try {
    await fs.rename(folder, dest);
  } catch {
    // Different volume: copy then remove.
    await fs.cp(folder, dest, { recursive: true });
    await fs.rm(folder, { recursive: true, force: true });
  }
  const external = await readExternalPaths();
  const next = external.filter((entry) => path.resolve(entry) !== path.resolve(folder));
  if (next.length !== external.length) {
    await writeExternalPaths(next);
  }
  const movedMarker = (await readProjectMarker(dest)) || marker;
  return { ok: true, project: { ...movedMarker, folder: dest, external: false } };
}

async function registerExternalProject(folder) {
  if (typeof folder !== "string") {
    return { ok: false };
  }
  const marker = await readProjectMarker(folder);
  if (!marker) {
    return { ok: false, invalid: true };
  }
  if (isInsideWorkspace(folder)) {
    return { ok: true, project: { ...marker, folder, external: false } };
  }
  const external = await readExternalPaths();
  if (!external.some((entry) => path.resolve(entry) === path.resolve(folder))) {
    external.push(folder);
    await writeExternalPaths(external);
  }
  return { ok: true, project: { ...marker, folder, external: true } };
}

async function writeProjectManuscript(folder, name, base64) {
  if (typeof folder !== "string" || typeof name !== "string" || typeof base64 !== "string") {
    return { ok: false };
  }
  const dir = path.join(folder, "manuscript");
  await fs.mkdir(dir, { recursive: true });
  const safe = path.basename(name) || "manuscript.txt";
  await fs.writeFile(path.join(dir, safe), Buffer.from(base64, "base64"));
  return { ok: true, manuscript: safe };
}

function chaptersDir(folder) {
  return path.join(folder, "manuscript", "chapters");
}

async function writeChapterContents(folder, chapters) {
  if (typeof folder !== "string" || !Array.isArray(chapters)) {
    return { ok: false };
  }
  const dir = chaptersDir(folder);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    chapters.map((chapter) =>
      chapter && typeof chapter.id === "string" && typeof chapter.html === "string"
        ? fs.writeFile(path.join(dir, `${chapter.id}.html`), chapter.html, "utf8")
        : Promise.resolve(),
    ),
  );
  return { ok: true };
}

async function writeChapterContent(folder, chapterId, html) {
  if (typeof folder !== "string" || typeof chapterId !== "string" || typeof html !== "string") {
    return { ok: false };
  }
  const dir = chaptersDir(folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${path.basename(chapterId)}.html`), html, "utf8");
  return { ok: true };
}

async function deleteChapterFiles(folder, chapterId) {
  if (typeof folder !== "string" || typeof chapterId !== "string") {
    return { ok: false };
  }
  const id = path.basename(chapterId);
  if (!id) {
    return { ok: false };
  }
  await fs.rm(path.join(chaptersDir(folder), `${id}.html`), { force: true });
  const audioRoot = path.join(folder, "audio");
  const pickupRoot = path.join(audioRoot, "pickups");
  for (const dir of [audioRoot, pickupRoot]) {
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    await Promise.all(
      names
        .filter((name) => name === `${id}.wav` || name.startsWith(`${id}-`))
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  }
  return { ok: true };
}

bindChapterDelete();

async function readChapterContent(folder, chapterId) {
  if (typeof folder !== "string" || typeof chapterId !== "string") {
    return { ok: false, html: "" };
  }
  try {
    const html = await fs.readFile(path.join(chaptersDir(folder), `${path.basename(chapterId)}.html`), "utf8");
    return { ok: true, html };
  } catch {
    return { ok: true, html: "" };
  }
}

async function writeChapterAudio(folder, chapterId, base64, mime, slot) {
  if (typeof folder !== "string" || typeof chapterId !== "string" || typeof base64 !== "string") {
    return { ok: false };
  }
  const kind = slot === "working" || slot === "mastered" ? slot : "original";
  const dir = path.join(folder, "audio");
  await fs.mkdir(dir, { recursive: true });
  // The chapter tape model is original + working (punches) + mastered (pipeline).
  // Booth takes already arrive as WAV; imported mp3/m4a/ogg/webm takes are normalized
  // to WAV so the slot is an honest `.wav` file rather than mislabeled bytes.
  const bytes = Buffer.from(base64, "base64");
  const file = `${path.basename(chapterId)}-${kind}.wav`;
  const alreadyWav = isWavBuffer(bytes) || (typeof mime === "string" && mime.includes("wav"));
  try {
    const wav = alreadyWav ? bytes : await transcodeToWav(bytes);
    await fs.writeFile(path.join(dir, file), wav);
    return { ok: true, file };
  } catch (error) {
    console.warn(`[labs] write chapter audio failed: ${error?.message ?? error}`);
    return { ok: false };
  }
}

async function readChapterAudio(folder, file) {
  if (typeof folder !== "string" || typeof file !== "string") {
    return { ok: false };
  }
  try {
    const bytes = await fs.readFile(path.join(folder, "audio", path.basename(file)));
    return { ok: true, base64: bytes.toString("base64") };
  } catch {
    return { ok: false };
  }
}

async function transcribeChapterAudio(folder, file) {
  if (typeof folder !== "string" || typeof file !== "string") {
    return { ok: false, words: [] };
  }
  const audioPath = path.join(folder, "audio", path.basename(file));
  try {
    const transcription = await transcribeImportedAudio({
      alignWithWhisperX: () => alignImportedAudioWithWhisperX({
        audioPath,
        userDataPath: mainUserDataPath(),
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        language: "en",
      }),
      transcribeWithWhisper: () => transcribeAudio({
        audioPath,
        userDataPath: mainUserDataPath(),
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        language: "en",
        requireBundled: app.isPackaged,
      }),
      onFallback: (error) => {
        console.warn(`[labs] WhisperX alignment unavailable; using Whisper timestamps: ${error?.message ?? error}`);
      },
    });
    let silences = [];
    try {
      silences = await measureSilences(audioPath);
    } catch (error) {
      // Word proofing still works when silence measurement is unavailable;
      // long-pause detection then falls back to recognizer timings.
      console.warn(`[labs] silence measurement skipped: ${error?.message ?? error}`);
    }
    return { ok: true, ...transcription, words: transcription.words ?? [], silences };
  } catch (error) {
    console.warn(`[labs] proof transcribe failed: ${error?.message ?? error}`);
    return { ok: false, words: [], reason: String(error?.message ?? error) };
  }
}

async function copyToWorking(folder, chapterId, file) {
  if (typeof folder !== "string" || typeof chapterId !== "string" || typeof file !== "string") {
    return { ok: false };
  }
  const dir = path.join(folder, "audio");
  const src = path.join(dir, path.basename(file));
  const ext = path.extname(file) || ".wav";
  const destName = `${path.basename(chapterId)}-working${ext}`;
  try {
    await fs.copyFile(src, path.join(dir, destName));
    return { ok: true, file: destName };
  } catch (error) {
    console.warn(`[labs] copy working failed: ${error?.message ?? error}`);
    return { ok: false };
  }
}

async function readProjectManuscriptFile(folder, name) {
  if (typeof folder !== "string") {
    return { ok: false };
  }
  const dir = path.join(folder, "manuscript");
  let target = typeof name === "string" && name ? path.join(dir, path.basename(name)) : null;
  if (!target) {
    try {
      const entries = await fs.readdir(dir);
      const found = entries.find((entry) => /\.(txt|md|markdown|docx|epub|pdf)$/i.test(entry));
      target = found ? path.join(dir, found) : null;
    } catch {
      target = null;
    }
  }
  if (!target) {
    return { ok: false };
  }
  try {
    const bytes = await fs.readFile(target);
    return { ok: true, name: path.basename(target), base64: bytes.toString("base64") };
  } catch {
    return { ok: false };
  }
}

async function createWorkspaceProject(input) {
  const parent =
    typeof input?.parentFolder === "string" && input.parentFolder.trim()
      ? input.parentFolder.trim()
      : grantedFolderPath;
  if (!parent) {
    throw new Error("Choose a folder for this book.");
  }
  const dir = await uniqueProjectDir(parent, safeFolderName(input?.title));
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.mkdir(path.join(dir, "manuscript"), { recursive: true }),
    fs.mkdir(path.join(dir, "audio"), { recursive: true }),
    fs.mkdir(path.join(dir, "export"), { recursive: true }),
  ]);
  const nowIso = new Date().toISOString();
  const project = {
    app: "kosmos-labs",
    schema: 1,
    id: `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: typeof input?.title === "string" && input.title.trim() ? input.title.trim() : "Untitled book",
    author: typeof input?.author === "string" ? input.author : "",
    coverDataUrl: typeof input?.coverDataUrl === "string" ? input.coverDataUrl : undefined,
    chapters: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await fs.writeFile(path.join(dir, PROJECT_MARKER), JSON.stringify(project), "utf8");
  return { ...project, folder: dir, external: !isInsideWorkspace(dir) };
}

async function saveWorkspaceProject(project) {
  if (!project || typeof project.folder !== "string") {
    throw new Error("Missing project folder.");
  }
  const { folder, ...rest } = project;
  const next = { ...rest, updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(folder, PROJECT_MARKER), JSON.stringify(next), "utf8");
  return { ...next, folder };
}

async function pickProjectParent() {
  if (!labWindow || labWindow.isDestroyed()) {
    return { ok: false };
  }
  const result = await dialog.showOpenDialog(labWindow, {
    title: "Where should this book live?",
    message: "Kosmos will create a folder here for the manuscript and recordings.",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: grantedFolderPath || undefined,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
}

async function openWorkspaceProject() {
  if (!labWindow || labWindow.isDestroyed()) {
    return { ok: false };
  }
  const result = await dialog.showOpenDialog(labWindow, {
    title: "Open Kosmos project",
    message: "Pick a project folder (it contains project.json).",
    properties: ["openDirectory"],
    defaultPath: grantedFolderPath || undefined,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const dir = result.filePaths[0];
  const marker = await readProjectMarker(dir);
  if (!marker) {
    return { ok: false, invalid: true, folder: dir };
  }
  return { ok: true, project: { ...marker, folder: dir }, external: !isInsideWorkspace(dir) };
}

async function deleteWorkspaceProject(folder) {
  if (typeof folder !== "string" || !grantedFolderPath) {
    return { ok: false };
  }
  // Only allow deleting inside the workspace, and only real project folders.
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(path.resolve(grantedFolderPath) + path.sep)) {
    return { ok: false };
  }
  if (!(await readProjectMarker(resolved))) {
    return { ok: false };
  }
  await fs.rm(resolved, { recursive: true, force: true });
  return { ok: true };
}

async function importManuscriptFile(folder) {
  if (!labWindow || labWindow.isDestroyed() || typeof folder !== "string") {
    return { ok: false };
  }
  const result = await dialog.showOpenDialog(labWindow, {
    title: "Choose a manuscript",
    properties: ["openFile"],
    filters: [{ name: "Manuscript", extensions: ["txt", "md", "docx", "epub", "pdf"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const source = result.filePaths[0];
  const base = path.basename(source);
  const dest = path.join(folder, "manuscript", base);
  await fs.mkdir(path.join(folder, "manuscript"), { recursive: true });
  await fs.copyFile(source, dest);
  return { ok: true, manuscript: base };
}

async function getSpeechModelAccess() {
  const proof = await proofModelStatus({
    userDataPath: mainUserDataPath(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
  });
  const liveModelPath = await findLiveModel({
    userDataPath: mainUserDataPath(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  return {
    granted: Boolean(proof.available && liveModelPath),
    bytes: proof.bytes,
    bundled: Boolean(proof.bundled),
    proofReady: Boolean(proof.available),
    liveReady: Boolean(liveModelPath),
  };
}

async function downloadSpeechModel(event) {
  await downloadModel(mainUserDataPath(), (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("labs:speech-model-progress", progress);
    }
  });
  return getSpeechModelAccess();
}

async function resetAccessState() {
  grantedFolderPath = null;
  await persistWorkspacePath(null);
  micSessionCleared = true;
  const snapshot = {
    mic: getMicrophoneAccess(),
    folder: getFolderAccess(),
    speechModel: await getSpeechModelAccess(),
  };
  if (labWindow && !labWindow.isDestroyed()) {
    labWindow.webContents.send("labs:access-reset", snapshot);
  }
  return snapshot;
}

function openMicrophoneSettings() {
  if (process.platform === "darwin") {
    void shell.openExternal(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
    );
    return { ok: true };
  }
  if (process.platform === "win32") {
    void shell.openExternal("ms-settings:privacy-microphone");
    return { ok: true };
  }
  return { ok: false };
}

const DISCORD_INVITE_APP = "discord://-/invite/g4aVz59mQ9";
const DISCORD_INVITE_WEB = "https://discord.gg/g4aVz59mQ9";

async function openDiscordInvite() {
  if (process.platform === "darwin") {
    try {
      await execFileAsync("open", ["-a", "Discord", DISCORD_INVITE_APP]);
      return { ok: true, via: "app" };
    } catch {
      // Discord is not installed; fall through to the browser invite.
    }
  } else {
    try {
      await shell.openExternal(DISCORD_INVITE_APP);
      return { ok: true, via: "app" };
    } catch {
      // No Discord protocol handler; fall through to the browser invite.
    }
  }

  await shell.openExternal(DISCORD_INVITE_WEB);
  return { ok: true, via: "web" };
}

function notifyDebugPlace(place) {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send("labs:place-changed", place);
  }
}

function jumpLab(place) {
  if (!JUMP_PLACES.has(place) || !labWindow || labWindow.isDestroyed()) {
    return { ok: false };
  }
  updateLabPlace(place);
  syncWindowChrome(place);
  labWindow.webContents.send("labs:jump", place);
  notifyDebugPlace(place);
  return { ok: true };
}

const START_SIZE = { width: 520, height: 360 };
const APP_FRAME = { width: 1180, height: 760 };
const APP_ASPECT = APP_FRAME.width / APP_FRAME.height;
const DEBUG_SIZE = { width: 176, height: 400 };
const TRAFFIC_LIGHTS = { x: 20, y: 32 };
const OFFSCREEN_LIGHTS = { x: -100, y: -100 };

function trafficLightsForSize(width, height) {
  const w = width || APP_FRAME.width;
  const h = height || APP_FRAME.height;
  const stillIntro = ROOM_PLACES.has(labPlace) && (w < 800 || h < 520);
  const useW = stillIntro ? APP_FRAME.width : w;
  const useH = stillIntro ? APP_FRAME.height : h;
  const scale = Math.min(useW / APP_FRAME.width, useH / APP_FRAME.height);
  return {
    x: Math.max(12, Math.round(TRAFFIC_LIGHTS.x * scale)),
    y: Math.max(18, Math.round(TRAFFIC_LIGHTS.y * scale)),
  };
}

function trafficLightsForWindow(win) {
  const size = typeof win.getContentSize === "function" ? win.getContentSize() : [APP_FRAME.width, APP_FRAME.height];
  return trafficLightsForSize(size[0], size[1]);
}

function pinTrafficLights(intended) {
  if (!labWindow || labWindow.isDestroyed() || process.platform !== "darwin") {
    return;
  }
  const chrome = windowChromeState();
  labWindow.setWindowButtonVisibility(chrome.showTrafficChrome);
  if (typeof labWindow.setTrafficLightPosition !== "function") {
    return;
  }
  if (!chrome.showTrafficChrome) {
    labWindow.setTrafficLightPosition(OFFSCREEN_LIGHTS);
    return;
  }
  const next = intended?.width && intended?.height
    ? trafficLightsForSize(intended.width, intended.height)
    : trafficLightsForWindow(labWindow);
  labWindow.setTrafficLightPosition(next);
}
const WINDOW_EDGE_SLOP = 4;
const JUMP_PLACES = new Set(["mark", "intro", "brand", "welcome", "access", "community", "theme", "app"]);
const ROOM_PLACES = new Set(["app"]);
const FRAMED_PLATFORM = process.platform === "win32" || process.platform === "linux";
const GLASS_BLUR_MAX = 48;
/** @type {import("electron").BrowserWindow | null} */
let labWindow = null;
/** @type {import("electron").BrowserWindow | null} */
let debugWindow = null;
/** @type {{ startX: number, startY: number, originX: number, originY: number } | null} */
let labWindowDrag = null;
/** @type {number} */
let labGlassId = -1;
let nativeGlassTimer = null;
let lastNativeKey = "";
/** @type {string} */
let labPlace = "mark";

const liveFollowStream = new PersistentParakeetLive();
const liveFollowServer = new PersistentParakeetServer();
let liveWordsUnsub = null;
let liveFollowServerReady = false;
let liveFollowModelPath = null;
let liveFollowServerPath = null;

function emitLiveWords(words) {
  if (labWindow && !labWindow.isDestroyed()) {
    labWindow.webContents.send("labs:live-words", words);
  }
}

async function startLiveFollow() {
  const modelPath = await findLiveModel({
    userDataPath: mainUserDataPath(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!modelPath) {
    return { ok: true, streaming: false, engine: "whisper.cpp", reason: "no-live-model" };
  }
  liveFollowModelPath = modelPath;
  try {
    const serverPath = resolveRuntimeBinary({
      name: "parakeet-live",
      envVar: "PARAKEET_LIVE_PATH",
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: false,
    });
    await liveFollowStream.start({ serverPath, modelPath });
    if (!liveWordsUnsub) {
      liveWordsUnsub = liveFollowStream.onWords(emitLiveWords);
    }
    return { ok: true, streaming: true, engine: "parakeet-live" };
  } catch (error) {
    console.warn(`[labs] Parakeet live stream unavailable; using clip server: ${error?.message ?? error}`);
  }

  try {
    liveFollowServerPath = resolveRuntimeBinary({
      name: "parakeet-server",
      envVar: "PARAKEET_SERVER_PATH",
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      requireBundled: false,
    });
    const warmed = await liveFollowServer.warm({
      serverPath: liveFollowServerPath,
      modelPath,
    });
    liveFollowServerReady = true;
    return { ok: true, streaming: false, engine: warmed.engine };
  } catch (error) {
    liveFollowServerReady = false;
    console.warn(`[labs] Parakeet clip server unavailable; using Whisper windows: ${error?.message ?? error}`);
    return { ok: true, streaming: false, engine: "whisper.cpp", reason: String(error?.message ?? error) };
  }
}

function sendLivePcm(payload) {
  if (!payload?.pcmBase64 || !liveFollowStream.running) {
    return;
  }
  try {
    const buf = Buffer.from(payload.pcmBase64, "base64");
    const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    liveFollowStream.write(new Float32Array(copy));
  } catch (error) {
    console.warn(`[labs] live pcm failed: ${error?.message ?? error}`);
  }
}

function stopLiveFollow({ force = false } = {}) {
  try {
    liveFollowStream.stop({ force });
  } catch {
    // Already stopped.
  }
  liveFollowServer.stop({ force });
  liveFollowServerReady = false;
  liveFollowModelPath = null;
  liveFollowServerPath = null;
  return { ok: true };
}

function updateLabPlace(place) {
  if (!JUMP_PLACES.has(place)) {
    return;
  }
  const leftRecordingRoom = ROOM_PLACES.has(labPlace) && !ROOM_PLACES.has(place);
  labPlace = place;
  if (leftRecordingRoom) {
    // Top-level place changes are renderer-owned, so the BrowserWindow stays
    // alive. Release recording models when leaving the app room entirely.
    stopLiveFollow();
  }
}

async function restartLiveFollow(payload) {
  const truncateToSeconds = Number(payload?.truncateToSeconds);
  if (!Number.isFinite(truncateToSeconds) || truncateToSeconds < 0) {
    return { ok: false, reason: "invalid-boundary" };
  }
  // Fresh recognizer clock. The renderer adds the retained tape duration back.
  stopLiveFollow();
  const started = await startLiveFollow();
  return { ...started, truncatedToSeconds: truncateToSeconds };
}

async function transcribeHop(payload) {
  if (typeof payload?.wavBase64 !== "string") {
    return { ok: false, words: [] };
  }
  const wavBytes = Buffer.from(payload.wavBase64, "base64");
  if (liveFollowServerReady && liveFollowModelPath && liveFollowServerPath) {
    try {
      const result = await liveFollowServer.transcribe({
        serverPath: liveFollowServerPath,
        modelPath: liveFollowModelPath,
        wavBytes,
      });
      return { ok: true, words: result.words ?? [], engine: result.engine };
    } catch (error) {
      liveFollowServerReady = false;
      liveFollowServer.stop();
      console.warn(`[labs] Parakeet clip transcription failed; using Whisper: ${error?.message ?? error}`);
    }
  }
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "labs-live-"));
  const inputPath = path.join(temporaryRoot, "window.wav");
  try {
    await fs.writeFile(inputPath, wavBytes);
    const result = await transcribeAudio({
      audioPath: inputPath,
      userDataPath: mainUserDataPath(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      language: "en",
      live: true,
      inputIsPcmWav: true,
      quality: false,
    });
    return { ok: true, words: result.words ?? [] };
  } catch (error) {
    console.warn(`[labs] whisper hop failed: ${error?.message ?? error}`);
    return { ok: false, words: [] };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isWindowExpanded(win) {
  if (!win || win.isDestroyed()) {
    return false;
  }
  if (win.isFullScreen() || win.isMaximized()) {
    return true;
  }

  const bounds = win.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  return (
    bounds.x <= work.x + WINDOW_EDGE_SLOP &&
    bounds.y <= work.y + WINDOW_EDGE_SLOP &&
    bounds.x + bounds.width >= work.x + work.width - WINDOW_EDGE_SLOP &&
    bounds.y + bounds.height >= work.y + work.height - WINDOW_EDGE_SLOP
  );
}

function windowChromeState() {
  if (!labWindow || labWindow.isDestroyed()) {
    return {
      platform: process.platform,
      fullscreen: false,
      maximized: false,
      expanded: false,
      showTrafficChrome: false,
    };
  }
  const platform = process.platform;
  const fullscreen = labWindow.isFullScreen();
  const maximized = labWindow.isMaximized();
  const expanded = isWindowExpanded(labWindow);
  const onApp = ROOM_PLACES.has(labPlace);
  const showTrafficChrome = platform === "darwin" && onApp;
  return { platform, fullscreen, maximized, expanded, showTrafficChrome };
}

function notifyWindowChrome() {
  if (!labWindow || labWindow.isDestroyed()) {
    return;
  }
  labWindow.webContents.send("labs:window-chrome-changed", windowChromeState());
}

function syncWindowChrome(place) {
  if (!labWindow || labWindow.isDestroyed()) {
    return;
  }
  if (typeof place === "string" && JUMP_PLACES.has(place)) {
    updateLabPlace(place);
  }
  if (process.platform === "darwin") {
    pinTrafficLights();
  } else {
    labWindow.setWindowButtonVisibility(false);
  }
  notifyWindowChrome();
}

function vibrancyForBlur(blur) {
  const t = Math.min(1, Math.max(0, blur / GLASS_BLUR_MAX));
  if (t <= 0) {
    return { vibrancy: null, visualEffectState: "inactive" };
  }
  if (t < 0.28) {
    return { vibrancy: "hud", visualEffectState: "active" };
  }
  if (t < 0.55) {
    return { vibrancy: "sidebar", visualEffectState: "active" };
  }
  if (t < 0.8) {
    return { vibrancy: "under-window", visualEffectState: "active" };
  }
  return { vibrancy: "fullscreen-ui", visualEffectState: "active" };
}

function ensureLiquidGlass(win) {
  if (!liquidGlass || labGlassId >= 0 || !win || win.isDestroyed()) {
    return labGlassId;
  }
  if (typeof liquidGlass.isGlassSupported === "function" && !liquidGlass.isGlassSupported()) {
    return -1;
  }
  try {
    labGlassId = liquidGlass.addView(win.getNativeWindowHandle(), {
      cornerRadius: 36,
      tintColor: "#0a081228",
      opaque: false,
    });
    console.log("[labs] liquid glass view", labGlassId);
  } catch (error) {
    console.warn("[labs] liquid glass addView failed", error);
    labGlassId = -1;
  }
  return labGlassId;
}

function applyNativeGlass(win, material = {}) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.setBackgroundColor("#00000000");

  const blur = Number(material.blur ?? 0);
  const clear = material.clear === true || blur <= 0;
  const requestedVibrancy = material.vibrancy ?? vibrancyForBlur(blur).vibrancy;
  const requestedState = material.visualEffectState ?? vibrancyForBlur(blur).visualEffectState;
  const look = material.look === "transparent" ? "transparent" : "frosted";
  const key = `${clear}:${Math.round(blur)}:${requestedVibrancy}:${requestedState}:${look}`;
  if (key === lastNativeKey) {
    return;
  }
  lastNativeKey = key;

  if (clear) {
    try {
      win.setVibrancy(null);
      if (typeof win.setVisualEffectState === "function") {
        win.setVisualEffectState("inactive");
      }
      if (labGlassId >= 0 && liquidGlass) {
        liquidGlass.unstable_setSubdued?.(labGlassId, 1);
        liquidGlass.unstable_setScrim?.(labGlassId, 0);
      }
      console.log("[labs] glass clear — sharp desktop");
    } catch (error) {
      console.warn("[labs] clear glass failed", error);
    }
    return;
  }

  const glassId = ensureLiquidGlass(win);
  if (glassId >= 0 && liquidGlass) {
    const heavy = look === "frosted";
    try {
      liquidGlass.unstable_setSubdued?.(glassId, 0);
      // 1 = clear (edge refraction). 0 = regular frosted, no glassy rim.
      liquidGlass.unstable_setVariant?.(glassId, heavy ? 0 : 1);
      liquidGlass.unstable_setScrim?.(glassId, heavy ? 1 : 0);
      if (typeof win.setVibrancy === "function") {
        win.setVibrancy(null);
      }
      console.log(`[labs] liquid look — ${look} / blur ${blur}`);
      return;
    } catch (error) {
      console.warn("[labs] liquid frost failed, using vibrancy", error);
    }
  }

  try {
    win.setVibrancy(requestedVibrancy);
    if (typeof win.setVisualEffectState === "function") {
      win.setVisualEffectState(requestedState);
    }
    console.log(`[labs] glass look — ${requestedVibrancy} / ${requestedState} / blur ${blur}`);
  } catch (error) {
    console.warn("[labs] apply glass failed", error);
  }
}

function scheduleNativeGlass(win, material) {
  if (nativeGlassTimer) {
    clearTimeout(nativeGlassTimer);
  }
  nativeGlassTimer = setTimeout(() => {
    nativeGlassTimer = null;
    applyNativeGlass(win, material);
  }, 32);
}

function windowChrome(win) {
  if (!FRAMED_PLATFORM || typeof win.getContentSize !== "function") {
    return { width: 0, height: 0 };
  }
  const outer = win.getSize();
  const inner = win.getContentSize();
  return {
    width: Math.max(0, outer[0] - inner[0]),
    height: Math.max(0, outer[1] - inner[1]),
  };
}

function fitAppFrame(win, size) {
  const current = win.getBounds();
  const work = screen.getDisplayMatching(current).workArea;
  const chrome = windowChrome(win);
  const maxWidth = Math.max(320, work.width - 24 - chrome.width);
  const maxHeight = Math.max(300, work.height - 24 - chrome.height);
  let width = Math.round(size?.width ?? APP_FRAME.width);
  let height = Math.round(width / APP_ASPECT);
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / APP_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * APP_ASPECT);
  }
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / APP_ASPECT);
  }
  return {
    width: Math.max(320, width),
    height: Math.max(300, height),
  };
}

function applySize(win, size, animate) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const current = win.getBounds();
  const content = typeof win.getContentSize === "function" ? win.getContentSize() : [current.width, current.height];
  const work = screen.getDisplayMatching(current).workArea;
  let width;
  let height;
  if (ROOM_PLACES.has(labPlace)) {
    win.setResizable(true);
    win.setFullScreenable(true);
    const chrome = windowChrome(win);
    const minWidth = Math.min(APP_FRAME.width, Math.max(320, screen.getDisplayMatching(win.getBounds()).workArea.width - 24 - chrome.width));
    const minHeight = Math.round(minWidth / APP_ASPECT);
    win.setMinimumSize(minWidth + chrome.width, minHeight + chrome.height);
    if (typeof win.setMaximizable === "function") {
      win.setMaximizable(true);
    }
    if (typeof win.setAspectRatio === "function") {
      win.setAspectRatio(APP_ASPECT);
    }
    ({ width, height } = fitAppFrame(win, size));
  } else {
    win.setMinimumSize(320, 300);
    if (typeof win.setAspectRatio === "function") {
      win.setAspectRatio(0);
    }
    width = Math.max(320, Math.round(size?.width ?? START_SIZE.width));
    height = Math.max(300, Math.round(size?.height ?? START_SIZE.height));
  }
  const measuredWidth = FRAMED_PLATFORM ? content[0] : current.width;
  const measuredHeight = FRAMED_PLATFORM ? content[1] : current.height;
  if (ROOM_PLACES.has(labPlace)) {
    pinTrafficLights({ width, height });
  }
  if (measuredWidth === width && measuredHeight === height) {
    return;
  }
  let x = Math.round(current.x + (current.width - width) / 2);
  let y = Math.round(current.y + (current.height - height) / 2);
  x = Math.min(Math.max(work.x + 12, x), Math.max(work.x + 12, work.x + work.width - width - 12));
  y = Math.min(Math.max(work.y + 12, y), Math.max(work.y + 12, work.y + work.height - height - 12));
  if (FRAMED_PLATFORM && typeof win.setContentSize === "function") {
    win.setPosition(x, y, Boolean(animate));
    win.setContentSize(width, height, Boolean(animate));
  } else {
    win.setBounds({ x, y, width, height }, Boolean(animate));
  }
  if (ROOM_PLACES.has(labPlace)) {
    pinTrafficLights({ width, height });
    setImmediate(() => {
      if (labWindow && !labWindow.isDestroyed() && ROOM_PLACES.has(labPlace)) {
        pinTrafficLights({ width, height });
      }
    });
  }
}

function debugBoundsBesideLab() {
  const fallback = { x: 80, y: 60, width: START_SIZE.width, height: START_SIZE.height };
  const lab =
    labWindow && !labWindow.isDestroyed() ? labWindow.getBounds() : fallback;
  const work = screen.getDisplayMatching(lab).workArea;
  let x = lab.x + lab.width + 14;
  let y = lab.y;
  if (x + DEBUG_SIZE.width > work.x + work.width - 8) {
    x = lab.x - DEBUG_SIZE.width - 14;
  }
  if (x < work.x + 8) {
    x = work.x + 8;
  }
  if (y + DEBUG_SIZE.height > work.y + work.height - 8) {
    y = work.y + work.height - DEBUG_SIZE.height - 8;
  }
  if (y < work.y + 8) {
    y = work.y + 8;
  }
  return { x, y, width: DEBUG_SIZE.width, height: DEBUG_SIZE.height };
}

function placeDebugWindow() {
  if (!debugWindow || debugWindow.isDestroyed()) {
    return;
  }
  debugWindow.setBounds(debugBoundsBesideLab());
}

function openDebugWindow() {
  if (debugWindow && !debugWindow.isDestroyed()) {
    placeDebugWindow();
    debugWindow.show();
    debugWindow.moveTop();
    return;
  }

  const bounds = debugBoundsBesideLab();
  debugWindow = new BrowserWindow({
    ...bounds,
    title: "Kosmos Debug",
    frame: false,
    transparent: false,
    backgroundColor: "#3a3840",
    roundedCorners: true,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "labs-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secureRendererWindow(debugWindow, { allowedUrls: ["http://127.0.0.1:5174/debug.html"] });

  debugWindow.setAlwaysOnTop(true, "floating");
  const revealDebug = () => {
    if (!debugWindow || debugWindow.isDestroyed()) {
      return;
    }
    placeDebugWindow();
    debugWindow.show();
    debugWindow.moveTop();
    console.log("[labs] debug window ready", debugWindow.getBounds());
  };
  debugWindow.once("ready-to-show", revealDebug);
  debugWindow.webContents.once("did-finish-load", revealDebug);
  debugWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error("[labs] debug window failed to load", code, description, url);
  });
  debugWindow.on("closed", () => {
    debugWindow = null;
  });
  void debugWindow.loadURL("http://127.0.0.1:5174/debug.html");
}

function openLab() {
  labWindow = new BrowserWindow({
    width: START_SIZE.width,
    height: START_SIZE.height,
    minWidth: 320,
    minHeight: 300,
    x: 80,
    y: 60,
    title: "Kosmos",
    useContentSize: true,
    autoHideMenuBar: true,
    transparent: !FRAMED_PLATFORM,
    backgroundColor: FRAMED_PLATFORM ? "#111111" : "#00000000",
    roundedCorners: !FRAMED_PLATFORM,
    hasShadow: true,
    icon: path.join(__dirname, "..", "labs/next/public/brand/logo.png"),
    show: false,
    // Keep the macOS title bar hidden while retaining a native draggable
    // title region behind the glass UI. `hiddenInset` can leave the custom
    // app-region strips text-selectable instead of movable on macOS.
    titleBarStyle: FRAMED_PLATFORM ? "default" : "hidden",
    trafficLightPosition: FRAMED_PLATFORM ? undefined : TRAFFIC_LIGHTS,
    webPreferences: {
      preload: path.join(__dirname, "labs-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secureRendererWindow(labWindow, { allowedUrls: ["http://127.0.0.1:5174/"] });

  let revealed = false;
  const reveal = () => {
    if (revealed || labWindow.isDestroyed()) {
      return;
    }
    revealed = true;
    labWindow.show();
  };

  const onReady = (event, payload) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id) {
      return;
    }
    const size = payload?.width && payload?.height ? payload : START_SIZE;
    const place = typeof payload?.place === "string" ? payload.place : "mark";
    if (JUMP_PLACES.has(place)) {
      updateLabPlace(place);
    }
    applySize(labWindow, size, false);
    syncWindowChrome(place);
    reveal();
  };
  const onResize = (event, size) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id) {
      return;
    }
    applySize(labWindow, size, true);
  };

  const onWindowDragStart = (event, point) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id) {
      return;
    }
    const startX = Number(point?.screenX);
    const startY = Number(point?.screenY);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
      return;
    }
    const [originX, originY] = labWindow.getPosition();
    labWindowDrag = { startX, startY, originX, originY };
  };
  const onWindowDragMove = (event, point) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id || !labWindowDrag) {
      return;
    }
    const screenX = Number(point?.screenX);
    const screenY = Number(point?.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      return;
    }
    labWindow.setPosition(
      Math.round(labWindowDrag.originX + screenX - labWindowDrag.startX),
      Math.round(labWindowDrag.originY + screenY - labWindowDrag.startY),
      false,
    );
  };
  const onWindowDragEnd = (event) => {
    if (labWindow && !labWindow.isDestroyed() && event.sender.id !== labWindow.webContents.id) {
      return;
    }
    labWindowDrag = null;
  };

  const onPushTuning = (_event, values) => {
    if (labWindow && !labWindow.isDestroyed()) {
      labWindow.webContents.send("labs:apply-tuning", values);
    }
  };

  ipcMain.on("labs:ready", onReady);
  ipcMain.handle("labs:resize", onResize);
  ipcMain.on("labs:window-drag-start", onWindowDragStart);
  ipcMain.on("labs:window-drag-move", onWindowDragMove);
  ipcMain.on("labs:window-drag-end", onWindowDragEnd);
  ipcMain.handle("labs:place", (_event, place) => {
    if (!JUMP_PLACES.has(place)) {
      return;
    }
    updateLabPlace(place);
    if (ROOM_PLACES.has(place)) {
      pinTrafficLights(APP_FRAME);
      notifyWindowChrome();
    } else {
      syncWindowChrome(place);
    }
    notifyDebugPlace(place);
  });
  ipcMain.handle("labs:set-material", (_event, material) => {
    if (labWindow && !labWindow.isDestroyed()) {
      scheduleNativeGlass(labWindow, material);
    }
  });
  bindChapterDelete();
  ipcMain.on("labs:push-tuning", onPushTuning);

  labWindow.on("closed", () => {
    stopLiveFollow();
    terminateActiveCommands();
    ipcMain.removeListener("labs:ready", onReady);
    ipcMain.removeHandler("labs:resize");
    ipcMain.removeListener("labs:window-drag-start", onWindowDragStart);
    ipcMain.removeListener("labs:window-drag-move", onWindowDragMove);
    ipcMain.removeListener("labs:window-drag-end", onWindowDragEnd);
    ipcMain.removeHandler("labs:place");
    ipcMain.removeHandler("labs:set-material");
    ipcMain.removeListener("labs:push-tuning", onPushTuning);
    labWindow = null;
    labWindowDrag = null;
    labGlassId = -1;
    lastNativeKey = "";
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.close();
    }
  });

  syncWindowChrome("mark");
  const onWindowChromeChange = () => {
    syncWindowChrome();
  };
  labWindow.on("enter-full-screen", onWindowChromeChange);
  labWindow.on("leave-full-screen", onWindowChromeChange);
  labWindow.on("maximize", () => {
    if (!ROOM_PLACES.has(labPlace) || !labWindow || labWindow.isDestroyed()) {
      onWindowChromeChange();
      return;
    }
    labWindow.unmaximize();
    const fitted = fitAppFrame(labWindow, screen.getDisplayMatching(labWindow.getBounds()).workArea);
    applySize(labWindow, fitted, true);
    onWindowChromeChange();
    setImmediate(() => {
      if (labWindow && !labWindow.isDestroyed()) {
        syncWindowChrome();
      }
    });
  });
  labWindow.on("unmaximize", onWindowChromeChange);
  let aspectLock = false;
  labWindow.on("will-resize", (event, newBounds) => {
    if (aspectLock || !ROOM_PLACES.has(labPlace) || !labWindow || labWindow.isDestroyed() || labWindow.isFullScreen()) {
      return;
    }
    const min = labWindow.getMinimumSize();
    if (newBounds.width < min[0] - 1 || newBounds.height < min[1] - 1) {
      event.preventDefault();
      return;
    }
    const fitted = fitAppFrame(labWindow, newBounds);
    if (Math.abs(fitted.width - newBounds.width) > 2 || Math.abs(fitted.height - newBounds.height) > 2) {
      event.preventDefault();
      aspectLock = true;
      labWindow.setBounds({
        x: newBounds.x,
        y: newBounds.y,
        width: fitted.width,
        height: fitted.height,
      });
      aspectLock = false;
    }
  });
  labWindow.on("move", () => {
    syncWindowChrome(labPlace);
    placeDebugWindow();
  });
  labWindow.on("resize", () => {
    syncWindowChrome(labPlace);
    placeDebugWindow();
  });
  labWindow.on("show", () => {
    syncWindowChrome(labPlace);
    openDebugWindow();
  });
  labWindow.once("ready-to-show", () => {
    setTimeout(reveal, 400);
  });

  void labWindow.loadURL("http://127.0.0.1:5174/");
  labWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.warn("[labs] failed to load", { code, desc, url });
  });
  labWindow.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      stopLiveFollow();
      terminateActiveCommands();
    }
  });
  labWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[labs] renderer gone", details);
    stopLiveFollow();
    terminateActiveCommands();
  });
}

app.whenReady().then(async () => {
  await loadWorkspacePath();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedRenderer(webContents) && isMicrophonePermission(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    isTrustedRenderer(webContents) && isMicrophonePermission(permission)
  ));

  ipcMain.handle("labs:access-microphone", () => requestMicrophoneAccess());
  ipcMain.handle("labs:access-microphone-status", () => getMicrophoneAccess());
  ipcMain.handle("labs:access-folder", () => requestFolderAccess());
  ipcMain.handle("labs:access-folder-status", () => getFolderAccess());
  ipcMain.handle("labs:speech-model-status", () => getSpeechModelAccess());
  ipcMain.handle("labs:download-speech-model", (event) => downloadSpeechModel(event));
  ipcMain.handle("labs:reset-access", () => resetAccessState());
  ipcMain.handle("labs:open-microphone-settings", () => openMicrophoneSettings());
  ipcMain.handle("labs:open-discord", () => openDiscordInvite());
  ipcMain.handle("labs:app-info", () => ({
    version: app.getVersion(),
    update: labsAppUpdater?.getStatus() ?? idleUpdateStatus(),
  }));
  ipcMain.handle("labs:update-check", () => (labsAppUpdater ? labsAppUpdater.check() : idleUpdateStatus()));
  ipcMain.handle("labs:update-install", () => (labsAppUpdater ? labsAppUpdater.install() : { installed: false }));
  ipcMain.handle("labs:open-release", () => shell.openExternal(RELEASE_PAGE));
  ipcMain.handle("labs:workspace-get", () => getWorkspace());
  ipcMain.handle("labs:projects-list", () => listWorkspaceProjects());
  ipcMain.handle("labs:project-create", (_event, input) => createWorkspaceProject(input));
  ipcMain.handle("labs:project-pick-parent", () => pickProjectParent());
  ipcMain.handle("labs:project-save", (_event, project) => saveWorkspaceProject(project));
  ipcMain.handle("labs:project-open", () => openWorkspaceProject());
  ipcMain.handle("labs:project-delete", (_event, folder) => deleteWorkspaceProject(folder));
  ipcMain.handle("labs:project-import-manuscript", (_event, folder) => importManuscriptFile(folder));
  ipcMain.handle("labs:project-move-in", (_event, folder) => moveProjectIntoWorkspace(folder));
  ipcMain.handle("labs:project-link-external", (_event, folder) => registerExternalProject(folder));
  ipcMain.handle("labs:project-write-manuscript", (_event, payload) =>
    writeProjectManuscript(payload?.folder, payload?.name, payload?.base64),
  );
  ipcMain.handle("labs:project-read-manuscript", (_event, payload) =>
    readProjectManuscriptFile(payload?.folder, payload?.name),
  );
  ipcMain.handle("labs:chapter-write-many", (_event, payload) =>
    writeChapterContents(payload?.folder, payload?.chapters),
  );
  ipcMain.handle("labs:chapter-write", (_event, payload) =>
    writeChapterContent(payload?.folder, payload?.chapterId, payload?.html),
  );
  bindChapterDelete();
  ipcMain.handle("labs:chapter-read", (_event, payload) =>
    readChapterContent(payload?.folder, payload?.chapterId),
  );
  ipcMain.handle("labs:chapter-write-audio", (_event, payload) =>
    writeChapterAudio(payload?.folder, payload?.chapterId, payload?.base64, payload?.mime, payload?.slot),
  );
  ipcMain.handle("labs:chapter-read-audio", (_event, payload) =>
    readChapterAudio(payload?.folder, payload?.file),
  );
  ipcMain.handle("labs:proof-transcribe", (_event, payload) =>
    transcribeChapterAudio(payload?.folder, payload?.file),
  );
  ipcMain.handle("labs:copy-working", (_event, payload) =>
    copyToWorking(payload?.folder, payload?.chapterId, payload?.file),
  );
  ipcMain.handle("labs:apply-punch", (_event, payload) => applyPunch(payload));
  ipcMain.handle("labs:preview-punch", (_event, payload) => previewPunch(payload));
  ipcMain.handle("labs:undo-punch", (_event, payload) => undoLatestPunch(payload));
  ipcMain.handle("labs:chapter-master", (_event, payload) => masterWorkingFile(payload));
  ipcMain.handle("labs:chapter-measure", (_event, payload) => measureChapterAudio(payload));
  ipcMain.handle("labs:delivery-export", (_event, payload) => exportDeliveryPack(payload));
  ipcMain.handle("labs:live-start", () => startLiveFollow());
  ipcMain.handle("labs:live-stop", () => stopLiveFollow());
  ipcMain.handle("labs:live-restart", (_event, payload) => restartLiveFollow(payload));
  ipcMain.on("labs:live-pcm", (_event, payload) => sendLivePcm(payload));
  ipcMain.handle("labs:live-transcribe-hop", (_event, payload) => transcribeHop(payload));
  ipcMain.handle("labs:window-chrome", () => windowChromeState());
  ipcMain.handle("labs:jump", (_event, place) => jumpLab(place));
  ipcMain.on("labs:report-place", (_event, place) => {
    if (typeof place === "string" && JUMP_PLACES.has(place)) {
      notifyDebugPlace(place);
    }
  });

  if (gotSingleInstanceLock) {
    openLab();
  }

  ensureLabsUpdater();
});

app.on("second-instance", () => {
  if (labWindow && !labWindow.isDestroyed()) {
    if (labWindow.isMinimized()) {
      labWindow.restore();
    }
    labWindow.focus();
    openDebugWindow();
    return;
  }
  openLab();
});

app.on("before-quit", () => {
  labsAppUpdater?.dispose();
  stopLiveFollow({ force: true });
  terminateActiveCommands({ force: true });
  liveWordsUnsub?.();
  liveWordsUnsub = null;
  if (nativeGlassTimer) {
    clearTimeout(nativeGlassTimer);
    nativeGlassTimer = null;
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
