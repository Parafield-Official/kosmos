/** Windows and Linux keep a native title bar; macOS uses a hidden one. */
function isFramedDesktopPlatform(platform) {
  return platform === "win32" || platform === "linux";
}

function callWindowMethod(win, method, ...args) {
  if (!win || typeof win[method] !== "function") {
    return false;
  }
  try {
    win[method](...args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Electron only implements this on macOS. Calling it on Windows throws
 * `TypeError: setWindowButtonVisibility is not a function` and rejects the
 * `app.whenReady()` callback, so the window is created hidden and never shown.
 */
function applyMacWindowButtonVisibility(win, visible) {
  return callWindowMethod(win, "setWindowButtonVisibility", Boolean(visible));
}

function syncNativeWindowChrome(win, { platform, showTrafficChrome = false } = {}) {
  if (!win || isFramedDesktopPlatform(platform)) {
    return;
  }
  if (platform === "darwin") {
    applyMacWindowButtonVisibility(win, showTrafficChrome);
  }
}

function framedDesktopWindowOptions(platform) {
  const framed = isFramedDesktopPlatform(platform);
  return {
    framed,
    transparent: !framed,
    backgroundColor: framed ? "#111111" : "#00000000",
    roundedCorners: !framed,
    titleBarStyle: framed ? "default" : "hidden",
    customWindowDrag: !framed,
    interceptMaximize: !framed,
    lockAspectRatio: !framed,
  };
}

module.exports = {
  applyMacWindowButtonVisibility,
  callWindowMethod,
  framedDesktopWindowOptions,
  isFramedDesktopPlatform,
  syncNativeWindowChrome,
};
