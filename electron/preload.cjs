const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boothDesk", {
  platform: process.platform,
  desktop: true,
  newProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  reopenRecentProject: () => ipcRenderer.invoke("project:recent"),
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
});
