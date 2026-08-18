const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { transcribeAudio } = require("./asr.cjs");
const { downloadModel, modelStatus } = require("./model.cjs");

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
  return { folder, project };
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
    filters: [{ name: "Plain text", extensions: ["txt", "md", "markdown"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const sourcePath = result.filePaths[0];
  const text = await fs.readFile(sourcePath, "utf8");
  return writeChapterText(folder, project, path.basename(sourcePath, path.extname(sourcePath)), text);
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
  const chapter = {
    id: chapterId,
    index,
    title: title.trim() || `Chapter ${index}`,
    text_path: `manuscript/chapters/${fileName}`,
    pickups_path: `alignment/${String(index).padStart(2, "0")}.json`,
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

async function readChapterText(folder, project, chapterId) {
  await assertProjectFolder(folder);
  const chapter = project.chapters?.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }
  const value = JSON.parse(await fs.readFile(projectAssetPath(folder, chapter.text_path), "utf8"));
  const text = Array.isArray(value.spans) ? value.spans.map((span) => span.text).join("\n") : "";
  return { chapterId, text, spans: value.spans ?? [] };
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
ipcMain.handle("project:chapter-text", (_event, payload) => {
  if (!payload?.folder || !payload?.project || !payload?.chapterId) {
    throw new Error("Invalid chapter read request");
  }
  return readChapterText(payload.folder, payload.project, payload.chapterId);
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
