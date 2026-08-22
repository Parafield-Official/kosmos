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
  setProjectMode: (payload) => ipcRenderer.invoke("project:set-mode", payload),
  setChapterSpans: (payload) => ipcRenderer.invoke("project:set-chapter-spans", payload),
  loadExample: (payload) => ipcRenderer.invoke("project:example", payload),
  attachAudio: (payload) => ipcRenderer.invoke("project:attach-audio", payload),
  attachDuetTrack: (payload) => ipcRenderer.invoke("duet:attach-track", payload),
  attachGlossaryClip: (payload) => ipcRenderer.invoke("glossary:attach-clip", payload),
  relinkGlossary: (payload) => ipcRenderer.invoke("glossary:relink", payload),
  refreshGlossary: (payload) => ipcRenderer.invoke("glossary:refresh", payload),
  suggestGlossaryRespells: (payload) => ipcRenderer.invoke("glossary:suggest-respells", payload),
  exportVoiceGuide: (payload) => ipcRenderer.invoke("glossary:export-guide", payload),
  readChapterText: (payload) => ipcRenderer.invoke("project:chapter-text", payload),
  saveAlignment: (payload) => ipcRenderer.invoke("project:save-alignment", payload),
  readAlignment: (payload) => ipcRenderer.invoke("project:read-alignment", payload),
  exportMarkers: (payload) => ipcRenderer.invoke("project:export-markers", payload),
  exportProofReport: (payload) => ipcRenderer.invoke("project:export-proof-report", payload),
  exportPickupPacket: (payload) => ipcRenderer.invoke("project:export-pickup-packet", payload),
  saveRecordingWav: (payload) => ipcRenderer.invoke("recording:save-wav", payload),
  applyPunchRecording: (payload) => ipcRenderer.invoke("recording:apply-punch", payload),
  mixDuetChapter: (payload) => ipcRenderer.invoke("duet:mix-chapter", payload),
  audioUrl: (payload) => ipcRenderer.invoke("audio:url", payload),
  decodeAudio: (payload) => ipcRenderer.invoke("audio:decode", payload),
  audioMetadata: (payload) => ipcRenderer.invoke("audio:metadata", payload),
  measureAudio: (payload) => ipcRenderer.invoke("audio:measure", payload),
  readBookProof: (payload) => ipcRenderer.invoke("project:read-book-proof", payload),
  resolveBookPickups: (payload) => ipcRenderer.invoke("project:resolve-book-pickups", payload),
  transcribe: (payload) => ipcRenderer.invoke("proof:transcribe", payload),
  startLiveTranscription: () => ipcRenderer.invoke("proof:start-live"),
  stopLiveTranscription: () => ipcRenderer.invoke("proof:stop-live"),
  transcribeBuffer: (payload) => ipcRenderer.invoke("proof:transcribe-buffer", payload),
  modelStatus: () => ipcRenderer.invoke("proof:model-status"),
  downloadModel: () => ipcRenderer.invoke("proof:download-model"),
  onModelProgress: (listener) => {
    modelProgressListeners.add(listener);
    return () => modelProgressListeners.delete(listener);
  },
  exportAcx: (payload) => ipcRenderer.invoke("acx:export", payload),
  reviewPack: (payload) => ipcRenderer.invoke("project:review-pack", payload),
  applyPack: (payload) => ipcRenderer.invoke("project:apply-pack", payload),
  discardPack: (payload) => ipcRenderer.invoke("project:discard-pack", payload),
  shareZip: (payload) => ipcRenderer.invoke("project:share-zip", payload),
  shareSeatPack: (payload) => ipcRenderer.invoke("project:share-seat-pack", payload),
  getIdentity: (projectId) => ipcRenderer.invoke("identity:get", { projectId }),
  setIdentity: (identity) => ipcRenderer.invoke("identity:set", identity),
  collabIceServers: () => ipcRenderer.invoke("collab:ice-servers"),
  collabEncodeInvite: (payload) => ipcRenderer.invoke("collab:encode-invite", payload),
  collabDecodeInvite: (text) => ipcRenderer.invoke("collab:decode-invite", { text }),
  collabEncodeReply: (payload) => ipcRenderer.invoke("collab:encode-reply", payload),
  collabDecodeReply: (text) => ipcRenderer.invoke("collab:decode-reply", { text }),
  collabAttach: (payload) => ipcRenderer.invoke("collab:attach", payload),
  collabInbound: (text) => ipcRenderer.invoke("collab:inbound", text),
  collabAnnounce: () => ipcRenderer.invoke("collab:announce"),
  collabStart: () => ipcRenderer.invoke("collab:start"),
  collabStatus: () => ipcRenderer.invoke("collab:status"),
  collabDisconnect: () => ipcRenderer.invoke("collab:disconnect"),
  onCollabOutbound: (listener) => {
    const wrapped = (_event, text) => listener(text);
    ipcRenderer.on("collab:outbound", wrapped);
    return () => ipcRenderer.removeListener("collab:outbound", wrapped);
  },
});
