const { contextBridge, ipcRenderer } = require("electron");


// Kept in the sandbox preload: no Node imports or renderer-owned shutdown IPC.
const unsavedWork = new Map();
const failedSaves = new Set();
let pendingCalls = 0;
let shutdownFrozen = false;
function shutdownReason() {
  return unsavedWork.values().next().value
    || (pendingCalls ? "Kosmos is still saving or processing audio. Wait for it to finish." : "")
    || (failedSaves.size ? "A save failed. Retry the save before closing Kosmos." : "");
}
async function invokeTracked(channel, ...args) {
  if (channel === "labs:update-install") return ipcRenderer.invoke(channel, ...args);
  if (shutdownFrozen) throw new Error("Kosmos is closing. Please wait.");
  const isSave = /^(labs:project-save|labs:project-write-manuscript|labs:chapter-write(?:-many|-audio)?)$/.test(channel);
  const payload = args[0] || {};
  const key = `${channel}:${payload.folder || ""}:${payload.chapterId || ""}:${payload.slot || ""}`;
  pendingCalls += 1;
  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (isSave) {
      if (result?.ok === false) failedSaves.add(key);
      else failedSaves.delete(key);
    }
    return result;
  } catch (error) {
    if (isSave) failedSaves.add(key);
    throw error;
  } finally { pendingCalls -= 1; }
}
ipcRenderer.on("labs:shutdown-request", (_event, token) => {
  const reason = shutdownReason();
  if (!reason) shutdownFrozen = true;
  ipcRenderer.send("labs:shutdown-reply", token, reason ? { ok: false, reason } : { ok: true });
});
ipcRenderer.on("labs:shutdown-release", () => { shutdownFrozen = false; });
window.addEventListener("beforeunload", (event) => {
  if (shutdownReason()) { event.preventDefault(); event.returnValue = ""; }
});

// Approval freezes edits as well as IPC while the native installer takes over.
for (const type of ["beforeinput", "click", "keydown"]) {
  window.addEventListener(type, (event) => {
    if (shutdownFrozen) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

const speechModelProgressListeners = new Set();
ipcRenderer.on("labs:speech-model-progress", (_event, progress) => {
  for (const listener of speechModelProgressListeners) {
    listener(progress);
  }
});

contextBridge.exposeInMainWorld("kosmosNext", {
  platform: process.platform,
  getUnsavedWork: (scope) => scope === "navigation"
    ? [...unsavedWork.entries()].find(([key]) => /^(recording|manuscript):/.test(key))?.[1] || null
    : shutdownReason() || null,
  setUnsavedWork: (key, reason) => {
    if (shutdownFrozen) throw new Error("Kosmos is closing. Please wait.");
    if (typeof key !== "string") return;
    if (typeof reason === "string" && reason) unsavedWork.set(key, reason);
    else unsavedWork.delete(key);
  },
  ready: (payload) => ipcRenderer.send("labs:ready", payload),
  resize: (size) => invokeTracked("labs:resize", size),
  startWindowDrag: (point) => ipcRenderer.send("labs:window-drag-start", point),
  moveWindowDrag: (point) => ipcRenderer.send("labs:window-drag-move", point),
  endWindowDrag: () => ipcRenderer.send("labs:window-drag-end"),
  setPlace: (place) => invokeTracked("labs:place", place),
  setMaterial: (material) => invokeTracked("labs:set-material", material),
  pushTuning: (values) => ipcRenderer.send("labs:push-tuning", values),
  jump: (place) => invokeTracked("labs:jump", place),
  reportPlace: (place) => ipcRenderer.send("labs:report-place", place),
  onJump: (callback) => {
    const listener = (_event, place) => {
      callback(place);
    };
    ipcRenderer.on("labs:jump", listener);
    return () => {
      ipcRenderer.removeListener("labs:jump", listener);
    };
  },
  onPlace: (callback) => {
    const listener = (_event, place) => {
      callback(place);
    };
    ipcRenderer.on("labs:place-changed", listener);
    return () => {
      ipcRenderer.removeListener("labs:place-changed", listener);
    };
  },
  getWindowChrome: () => invokeTracked("labs:window-chrome"),
  onWindowChrome: (callback) => {
    const listener = (_event, state) => {
      callback(state);
    };
    ipcRenderer.on("labs:window-chrome-changed", listener);
    return () => {
      ipcRenderer.removeListener("labs:window-chrome-changed", listener);
    };
  },
  requestMicrophoneAccess: () => invokeTracked("labs:access-microphone"),
  getMicrophoneAccess: () => invokeTracked("labs:access-microphone-status"),
  requestFolderAccess: () => invokeTracked("labs:access-folder"),
  getFolderAccess: () => invokeTracked("labs:access-folder-status"),
  getSpeechModelAccess: () => invokeTracked("labs:speech-model-status"),
  downloadSpeechModel: () => invokeTracked("labs:download-speech-model"),
  onSpeechModelProgress: (callback) => {
    speechModelProgressListeners.add(callback);
    return () => speechModelProgressListeners.delete(callback);
  },
  resetAccess: () => invokeTracked("labs:reset-access"),
  onAccessReset: (callback) => {
    const listener = (_event, snapshot) => {
      callback(snapshot);
    };
    ipcRenderer.on("labs:access-reset", listener);
    return () => {
      ipcRenderer.removeListener("labs:access-reset", listener);
    };
  },
  openMicrophoneSettings: () => invokeTracked("labs:open-microphone-settings"),
  getAppInfo: () => invokeTracked("labs:app-info"),
  checkForUpdates: () => invokeTracked("labs:update-check"),
  installAppUpdate: () => invokeTracked("labs:update-install"),
  openReleasePage: () => invokeTracked("labs:open-release"),
  openThirdPartyNotices: () => invokeTracked("labs:open-third-party-notices"),
  onAppUpdate: (callback) => {
    const listener = (_event, status) => {
      callback(status);
    };
    ipcRenderer.on("labs:app-update", listener);
    return () => {
      ipcRenderer.removeListener("labs:app-update", listener);
    };
  },
  openDiscord: (payload) => invokeTracked("labs:open-discord", payload),
  getWorkspace: () => invokeTracked("labs:workspace-get"),
  listProjects: () => invokeTracked("labs:projects-list"),
  createProject: (input) => invokeTracked("labs:project-create", input),
  pickProjectParent: () => invokeTracked("labs:project-pick-parent"),
  saveProjectFile: (project) => invokeTracked("labs:project-save", project),
  openProjectFolder: () => invokeTracked("labs:project-open"),
  deleteProjectFolder: (folder) => invokeTracked("labs:project-delete", folder),
  importManuscript: (folder) => invokeTracked("labs:project-import-manuscript", folder),
  moveProjectIntoWorkspace: (folder) => invokeTracked("labs:project-move-in", folder),
  linkExternalProject: (folder) => invokeTracked("labs:project-link-external", folder),
  writeManuscript: (payload) => invokeTracked("labs:project-write-manuscript", payload),
  readManuscript: (payload) => invokeTracked("labs:project-read-manuscript", payload),
  writeChapterContents: (payload) => invokeTracked("labs:chapter-write-many", payload),
  writeChapterContent: (payload) => invokeTracked("labs:chapter-write", payload),
  deleteChapterFiles: (payload) => invokeTracked("labs:chapter-delete", payload),
  readChapterContent: (payload) => invokeTracked("labs:chapter-read", payload),
  writeChapterAudio: (payload) => invokeTracked("labs:chapter-write-audio", payload),
  readChapterAudio: (payload) => invokeTracked("labs:chapter-read-audio", payload),
  transcribeChapter: (payload) => invokeTracked("labs:proof-transcribe", payload),
  copyToWorking: (payload) => invokeTracked("labs:copy-working", payload),
  applyPunch: (payload) => invokeTracked("labs:apply-punch", payload),
  previewPunch: (payload) => invokeTracked("labs:preview-punch", payload),
  undoLatestPunch: (payload) => invokeTracked("labs:undo-punch", payload),
  masterChapter: (payload) => invokeTracked("labs:chapter-master", payload),
  measureChapter: (payload) => invokeTracked("labs:chapter-measure", payload),
  exportDelivery: (payload) => invokeTracked("labs:delivery-export", payload),
  startLiveFollow: () => invokeTracked("labs:live-start"),
  stopLiveFollow: () => invokeTracked("labs:live-stop"),
  restartLiveFollow: (payload) => invokeTracked("labs:live-restart", payload),
  sendLivePcm: (payload) => ipcRenderer.send("labs:live-pcm", payload),
  transcribeHop: (payload) => invokeTracked("labs:live-transcribe-hop", payload),
  suggestGlossaryRespells: (payload) => invokeTracked("labs:glossary-suggest", payload),
  onLiveWords: (callback) => {
    const listener = (_event, words) => {
      callback(words);
    };
    ipcRenderer.on("labs:live-words", listener);
    return () => {
      ipcRenderer.removeListener("labs:live-words", listener);
    };
  },
});
