const { contextBridge, ipcRenderer } = require("electron");

const speechModelProgressListeners = new Set();
ipcRenderer.on("labs:speech-model-progress", (_event, progress) => {
  for (const listener of speechModelProgressListeners) {
    listener(progress);
  }
});

contextBridge.exposeInMainWorld("kosmosNext", {
  platform: process.platform,
  ready: (payload) => ipcRenderer.send("labs:ready", payload),
  resize: (size) => ipcRenderer.invoke("labs:resize", size),
  startWindowDrag: (point) => ipcRenderer.send("labs:window-drag-start", point),
  moveWindowDrag: (point) => ipcRenderer.send("labs:window-drag-move", point),
  endWindowDrag: () => ipcRenderer.send("labs:window-drag-end"),
  setPlace: (place) => ipcRenderer.invoke("labs:place", place),
  setMaterial: (material) => ipcRenderer.invoke("labs:set-material", material),
  pushTuning: (values) => ipcRenderer.send("labs:push-tuning", values),
  jump: (place) => ipcRenderer.invoke("labs:jump", place),
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
  getWindowChrome: () => ipcRenderer.invoke("labs:window-chrome"),
  onWindowChrome: (callback) => {
    const listener = (_event, state) => {
      callback(state);
    };
    ipcRenderer.on("labs:window-chrome-changed", listener);
    return () => {
      ipcRenderer.removeListener("labs:window-chrome-changed", listener);
    };
  },
  requestMicrophoneAccess: () => ipcRenderer.invoke("labs:access-microphone"),
  getMicrophoneAccess: () => ipcRenderer.invoke("labs:access-microphone-status"),
  requestFolderAccess: () => ipcRenderer.invoke("labs:access-folder"),
  getFolderAccess: () => ipcRenderer.invoke("labs:access-folder-status"),
  getSpeechModelAccess: () => ipcRenderer.invoke("labs:speech-model-status"),
  downloadSpeechModel: () => ipcRenderer.invoke("labs:download-speech-model"),
  onSpeechModelProgress: (callback) => {
    speechModelProgressListeners.add(callback);
    return () => speechModelProgressListeners.delete(callback);
  },
  resetAccess: () => ipcRenderer.invoke("labs:reset-access"),
  onAccessReset: (callback) => {
    const listener = (_event, snapshot) => {
      callback(snapshot);
    };
    ipcRenderer.on("labs:access-reset", listener);
    return () => {
      ipcRenderer.removeListener("labs:access-reset", listener);
    };
  },
  openMicrophoneSettings: () => ipcRenderer.invoke("labs:open-microphone-settings"),
  getAppInfo: () => ipcRenderer.invoke("labs:app-info"),
  checkForUpdates: () => ipcRenderer.invoke("labs:update-check"),
  installAppUpdate: () => ipcRenderer.invoke("labs:update-install"),
  openReleasePage: () => ipcRenderer.invoke("labs:open-release"),
  openThirdPartyNotices: () => ipcRenderer.invoke("labs:open-third-party-notices"),
  onAppUpdate: (callback) => {
    const listener = (_event, status) => {
      callback(status);
    };
    ipcRenderer.on("labs:app-update", listener);
    return () => {
      ipcRenderer.removeListener("labs:app-update", listener);
    };
  },
  openDiscord: (payload) => ipcRenderer.invoke("labs:open-discord", payload),
  getWorkspace: () => ipcRenderer.invoke("labs:workspace-get"),
  listProjects: () => ipcRenderer.invoke("labs:projects-list"),
  createProject: (input) => ipcRenderer.invoke("labs:project-create", input),
  pickProjectParent: () => ipcRenderer.invoke("labs:project-pick-parent"),
  saveProjectFile: (project) => ipcRenderer.invoke("labs:project-save", project),
  openProjectFolder: () => ipcRenderer.invoke("labs:project-open"),
  deleteProjectFolder: (folder) => ipcRenderer.invoke("labs:project-delete", folder),
  importManuscript: (folder) => ipcRenderer.invoke("labs:project-import-manuscript", folder),
  moveProjectIntoWorkspace: (folder) => ipcRenderer.invoke("labs:project-move-in", folder),
  linkExternalProject: (folder) => ipcRenderer.invoke("labs:project-link-external", folder),
  writeManuscript: (payload) => ipcRenderer.invoke("labs:project-write-manuscript", payload),
  readManuscript: (payload) => ipcRenderer.invoke("labs:project-read-manuscript", payload),
  writeChapterContents: (payload) => ipcRenderer.invoke("labs:chapter-write-many", payload),
  writeChapterContent: (payload) => ipcRenderer.invoke("labs:chapter-write", payload),
  deleteChapterFiles: (payload) => ipcRenderer.invoke("labs:chapter-delete", payload),
  readChapterContent: (payload) => ipcRenderer.invoke("labs:chapter-read", payload),
  writeChapterAudio: (payload) => ipcRenderer.invoke("labs:chapter-write-audio", payload),
  readChapterAudio: (payload) => ipcRenderer.invoke("labs:chapter-read-audio", payload),
  transcribeChapter: (payload) => ipcRenderer.invoke("labs:proof-transcribe", payload),
  copyToWorking: (payload) => ipcRenderer.invoke("labs:copy-working", payload),
  applyPunch: (payload) => ipcRenderer.invoke("labs:apply-punch", payload),
  previewPunch: (payload) => ipcRenderer.invoke("labs:preview-punch", payload),
  undoLatestPunch: (payload) => ipcRenderer.invoke("labs:undo-punch", payload),
  masterChapter: (payload) => ipcRenderer.invoke("labs:chapter-master", payload),
  measureChapter: (payload) => ipcRenderer.invoke("labs:chapter-measure", payload),
  exportDelivery: (payload) => ipcRenderer.invoke("labs:delivery-export", payload),
  startLiveFollow: () => ipcRenderer.invoke("labs:live-start"),
  stopLiveFollow: () => ipcRenderer.invoke("labs:live-stop"),
  restartLiveFollow: (payload) => ipcRenderer.invoke("labs:live-restart", payload),
  sendLivePcm: (payload) => ipcRenderer.send("labs:live-pcm", payload),
  transcribeHop: (payload) => ipcRenderer.invoke("labs:live-transcribe-hop", payload),
  suggestGlossaryRespells: (payload) => ipcRenderer.invoke("labs:glossary-suggest", payload),
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
