const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LIGHTBOX_DEV_BASE_URL = "http://127.0.0.1:5174/";

function lightboxPageUrl({ isPackaged, appPath, page = "index.html" }) {
  if (isPackaged) {
    return pathToFileURL(path.join(appPath, "dist", page)).href;
  }
  return new URL(page === "index.html" ? "./" : page, LIGHTBOX_DEV_BASE_URL).href;
}

function shouldOpenLightboxDebug({ isPackaged }) {
  return !isPackaged;
}

module.exports = {
  LIGHTBOX_DEV_BASE_URL,
  lightboxPageUrl,
  shouldOpenLightboxDebug,
};
