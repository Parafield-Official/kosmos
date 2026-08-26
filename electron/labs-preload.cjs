const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kosmosNext", {
  ready: (size) => ipcRenderer.send("labs:ready", size),
  resize: (size) => ipcRenderer.invoke("labs:resize", size),
  setMaterial: (material) => ipcRenderer.invoke("labs:set-material", material),
  pushTuning: (values) => ipcRenderer.send("labs:push-tuning", values),
  jump: (place) => ipcRenderer.send("labs:jump", place),
  onJump: (callback) => {
    const listener = (_event, place) => {
      callback(place);
    };
    ipcRenderer.on("labs:jump", listener);
    return () => {
      ipcRenderer.removeListener("labs:jump", listener);
    };
  },
});
