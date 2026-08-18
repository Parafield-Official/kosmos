const { contextBridge, ipcRenderer } = require("electron");

const modelProgressListeners = new Set();
ipcRenderer.on("proof:model-progress", (_event, progress) => {
  for (const listener of modelProgressListeners) {
    listener(progress);
  }
});

contextBridge.exposeInMainWorld("boothDesk", {
  platform: process.platform,
  desktop: true,
  newProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  reopenRecentProject: () => ipcRenderer.invoke("project:recent"),
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  importText: (payload) => ipcRenderer.invoke("project:import-text", payload),
  pasteText: (payload) => ipcRenderer.invoke("project:paste-text", payload),
  renameChapter: (payload) => ipcRenderer.invoke("project:rename-chapter", payload),
  splitChapter: (payload) => ipcRenderer.invoke("project:split-chapter", payload),
  mergeChapters: (payload) => ipcRenderer.invoke("project:merge-chapters", payload),
  setChapterSeat: (payload) => ipcRenderer.invoke("project:set-chapter-seat", payload),
  loadExample: (payload) => ipcRenderer.invoke("project:example", payload),
  attachAudio: (payload) => ipcRenderer.invoke("project:attach-audio", payload),
  attachGlossaryClip: (payload) => ipcRenderer.invoke("glossary:attach-clip", payload),
  readChapterText: (payload) => ipcRenderer.invoke("project:chapter-text", payload),
  readAudio: (payload) => ipcRenderer.invoke("audio:read", payload),
  decodeAudio: (payload) => ipcRenderer.invoke("audio:decode", payload),
  transcribe: (payload) => ipcRenderer.invoke("proof:transcribe", payload),
  modelStatus: () => ipcRenderer.invoke("proof:model-status"),
  downloadModel: () => ipcRenderer.invoke("proof:download-model"),
  onModelProgress: (listener) => {
    modelProgressListeners.add(listener);
    return () => modelProgressListeners.delete(listener);
  },
  exportAcx: (payload) => ipcRenderer.invoke("acx:export", payload),
  shareZip: (payload) => ipcRenderer.invoke("project:share-zip", payload),
  getIdentity: (projectId) => ipcRenderer.invoke("identity:get", { projectId }),
  setIdentity: (identity) => ipcRenderer.invoke("identity:set", identity),
});
