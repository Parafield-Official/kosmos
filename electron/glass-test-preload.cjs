const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("glassTest", {
  setMaterial: (material) => ipcRenderer.invoke("labs:glass-test-material", material),
});
