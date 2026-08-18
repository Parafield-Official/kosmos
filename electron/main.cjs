const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

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
  await fs.writeFile(
    path.join(folder, "project.json"),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8",
  );
  await rememberRecentProject(folder);
  return { folder, project };
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
