const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("boothDesk", {
  platform: process.platform,
  desktop: true,
});

