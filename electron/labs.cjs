const path = require("node:path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");

let liquidGlass = null;
try {
  liquidGlass = require("electron-liquid-glass").default ?? require("electron-liquid-glass");
} catch (error) {
  console.warn("[labs] electron-liquid-glass unavailable", error);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.setName("Kosmos Labs");
app.setPath("userData", path.join(app.getPath("appData"), "booth-desk-labs"));

const START_SIZE = { width: 520, height: 360 };
const DEBUG_SIZE = { width: 176, height: 276 };
const TRAFFIC_LIGHTS = { x: 22, y: 20 };
const GLASS_BLUR_MAX = 48;
/** @type {import("electron").BrowserWindow | null} */
let labWindow = null;
/** @type {import("electron").BrowserWindow | null} */
let debugWindow = null;
/** @type {number} */
let labGlassId = -1;
let nativeGlassTimer = null;
let lastNativeKey = "";

function vibrancyForBlur(blur) {
  const t = Math.min(1, Math.max(0, blur / GLASS_BLUR_MAX));
  if (t <= 0) {
    return { vibrancy: null, visualEffectState: "inactive" };
  }
  if (t < 0.28) {
    return { vibrancy: "hud", visualEffectState: "active" };
  }
  if (t < 0.55) {
    return { vibrancy: "sidebar", visualEffectState: "active" };
  }
  if (t < 0.8) {
    return { vibrancy: "under-window", visualEffectState: "active" };
  }
  return { vibrancy: "fullscreen-ui", visualEffectState: "active" };
}

function ensureLiquidGlass(win) {
  if (!liquidGlass || labGlassId >= 0 || !win || win.isDestroyed()) {
    return labGlassId;
  }
  if (typeof liquidGlass.isGlassSupported === "function" && !liquidGlass.isGlassSupported()) {
    return -1;
  }
  try {
    labGlassId = liquidGlass.addView(win.getNativeWindowHandle(), {
      cornerRadius: 15,
      tintColor: "#0a081228",
      opaque: false,
    });
    console.log("[labs] liquid glass view", labGlassId);
  } catch (error) {
    console.warn("[labs] liquid glass addView failed", error);
    labGlassId = -1;
  }
  return labGlassId;
}

function applyNativeGlass(win, material = {}) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.setBackgroundColor("#00000000");

  const blur = Number(material.blur ?? 0);
  const clear = material.clear === true || blur <= 0;
  const requestedVibrancy = material.vibrancy ?? vibrancyForBlur(blur).vibrancy;
  const requestedState = material.visualEffectState ?? vibrancyForBlur(blur).visualEffectState;
  const look = material.look === "transparent" ? "transparent" : "frosted";
  const key = `${clear}:${Math.round(blur)}:${requestedVibrancy}:${requestedState}:${look}`;
  if (key === lastNativeKey) {
    return;
  }
  lastNativeKey = key;

  if (clear) {
    try {
      win.setVibrancy(null);
      if (typeof win.setVisualEffectState === "function") {
        win.setVisualEffectState("inactive");
      }
      if (labGlassId >= 0 && liquidGlass) {
        liquidGlass.unstable_setSubdued?.(labGlassId, 1);
        liquidGlass.unstable_setScrim?.(labGlassId, 0);
      }
      console.log("[labs] glass clear — sharp desktop");
    } catch (error) {
      console.warn("[labs] clear glass failed", error);
    }
    return;
  }

  const glassId = ensureLiquidGlass(win);
  if (glassId >= 0 && liquidGlass) {
    const heavy = look === "frosted";
    try {
      liquidGlass.unstable_setSubdued?.(glassId, 0);
      // 1 = clear (edge refraction). 0 = regular frosted, no glassy rim.
      liquidGlass.unstable_setVariant?.(glassId, heavy ? 0 : 1);
      liquidGlass.unstable_setScrim?.(glassId, heavy ? 1 : 0);
      if (typeof win.setVibrancy === "function") {
        win.setVibrancy(null);
      }
      console.log(`[labs] liquid look — ${look} / blur ${blur}`);
      return;
    } catch (error) {
      console.warn("[labs] liquid frost failed, using vibrancy", error);
    }
  }

  try {
    win.setVibrancy(requestedVibrancy);
    if (typeof win.setVisualEffectState === "function") {
      win.setVisualEffectState(requestedState);
    }
    console.log(`[labs] glass look — ${requestedVibrancy} / ${requestedState} / blur ${blur}`);
  } catch (error) {
    console.warn("[labs] apply glass failed", error);
  }
}

function scheduleNativeGlass(win, material) {
  if (nativeGlassTimer) {
    clearTimeout(nativeGlassTimer);
  }
  nativeGlassTimer = setTimeout(() => {
    nativeGlassTimer = null;
    applyNativeGlass(win, material);
  }, 32);
}

function applySize(win, size, animate) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const width = Math.max(320, Math.round(size?.width ?? START_SIZE.width));
  const height = Math.max(300, Math.round(size?.height ?? START_SIZE.height));
  const current = win.getBounds();
  if (current.width === width && current.height === height) {
    return;
  }
  const work = screen.getDisplayMatching(current).workArea;
  let x = Math.round(current.x + (current.width - width) / 2);
  let y = Math.round(current.y + (current.height - height) / 2);
  x = Math.min(Math.max(work.x + 12, x), Math.max(work.x + 12, work.x + work.width - width - 12));
  y = Math.min(Math.max(work.y + 12, y), Math.max(work.y + 12, work.y + work.height - height - 12));
  win.setMinimumSize(320, 300);
  win.setBounds({ x, y, width, height }, Boolean(animate));
}

function debugBoundsBesideLab() {
  const fallback = { x: 80, y: 60, width: START_SIZE.width, height: START_SIZE.height };
  const lab =
    labWindow && !labWindow.isDestroyed() ? labWindow.getBounds() : fallback;
  const work = screen.getDisplayMatching(lab).workArea;
  let x = lab.x + lab.width + 14;
  let y = lab.y;
  if (x + DEBUG_SIZE.width > work.x + work.width - 8) {
    x = lab.x - DEBUG_SIZE.width - 14;
  }
  if (x < work.x + 8) {
    x = work.x + 8;
  }
  if (y + DEBUG_SIZE.height > work.y + work.height - 8) {
    y = work.y + work.height - DEBUG_SIZE.height - 8;
  }
  if (y < work.y + 8) {
    y = work.y + 8;
  }
  return { x, y, width: DEBUG_SIZE.width, height: DEBUG_SIZE.height };
}

function placeDebugWindow() {
  if (!debugWindow || debugWindow.isDestroyed()) {
    return;
  }
  debugWindow.setBounds(debugBoundsBesideLab());
}

function openDebugWindow() {
  if (debugWindow && !debugWindow.isDestroyed()) {
    placeDebugWindow();
    debugWindow.show();
    debugWindow.moveTop();
    return;
  }

  const bounds = debugBoundsBesideLab();
  debugWindow = new BrowserWindow({
    ...bounds,
    title: "Kosmos Debug",
    frame: false,
    transparent: false,
    backgroundColor: "#1c1a22",
    roundedCorners: true,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "labs-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  debugWindow.setAlwaysOnTop(true, "floating");
  debugWindow.once("ready-to-show", () => {
    if (debugWindow && !debugWindow.isDestroyed()) {
      placeDebugWindow();
      debugWindow.show();
      debugWindow.moveTop();
      console.log("[labs] debug window ready", debugWindow.getBounds());
    }
  });
  debugWindow.on("closed", () => {
    debugWindow = null;
  });
  void debugWindow.loadURL("http://127.0.0.1:5174/debug.html");
}

function openLab() {
  labWindow = new BrowserWindow({
    width: START_SIZE.width,
    height: START_SIZE.height,
    minWidth: 320,
    minHeight: 300,
    x: 80,
    y: 60,
    title: "Kosmos",
    transparent: true,
    backgroundColor: "#00000000",
    roundedCorners: true,
    hasShadow: true,
    icon: path.join(__dirname, "..", "labs/next/public/brand/logo.png"),
    show: false,
    titleBarStyle: "hidden",
    trafficLightPosition: TRAFFIC_LIGHTS,
    webPreferences: {
      preload: path.join(__dirname, "labs-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let revealed = false;
  const reveal = () => {
    if (revealed || labWindow.isDestroyed()) {
      return;
    }
    revealed = true;
    labWindow.show();
  };

  const onReady = (event, size) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id) {
      return;
    }
    applySize(labWindow, size, false);
    reveal();
  };
  const onResize = (event, size) => {
    if (!labWindow || labWindow.isDestroyed() || event.sender.id !== labWindow.webContents.id) {
      return;
    }
    applySize(labWindow, size, true);
  };

  const onPushTuning = (_event, values) => {
    if (labWindow && !labWindow.isDestroyed()) {
      labWindow.webContents.send("labs:apply-tuning", values);
    }
  };

  ipcMain.on("labs:ready", onReady);
  ipcMain.handle("labs:resize", onResize);
  ipcMain.handle("labs:set-material", (_event, material) => {
    if (labWindow && !labWindow.isDestroyed()) {
      scheduleNativeGlass(labWindow, material);
    }
  });
  ipcMain.on("labs:push-tuning", onPushTuning);

  labWindow.on("closed", () => {
    ipcMain.removeListener("labs:ready", onReady);
    ipcMain.removeHandler("labs:resize");
    ipcMain.removeHandler("labs:set-material");
    ipcMain.removeListener("labs:push-tuning", onPushTuning);
    labWindow = null;
    labGlassId = -1;
    lastNativeKey = "";
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.close();
    }
  });

  labWindow.setWindowButtonVisibility(true);
  if (typeof labWindow.setTrafficLightPosition === "function") {
    labWindow.setTrafficLightPosition(TRAFFIC_LIGHTS);
  }
  labWindow.on("move", placeDebugWindow);
  labWindow.on("resize", placeDebugWindow);
  labWindow.on("show", () => {
    if (labWindow && !labWindow.isDestroyed() && typeof labWindow.setTrafficLightPosition === "function") {
      labWindow.setTrafficLightPosition(TRAFFIC_LIGHTS);
    }
    openDebugWindow();
  });
  labWindow.once("ready-to-show", () => {
    setTimeout(reveal, 400);
  });

  void labWindow.loadURL("http://127.0.0.1:5174/");
  labWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.warn("[labs] failed to load", { code, desc, url });
  });
  labWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[labs] renderer gone", details);
  });
}

const JUMP_PLACES = new Set(["mark", "intro", "brand", "welcome", "app"]);

app.whenReady().then(() => {
  ipcMain.on("labs:jump", (_event, place) => {
    if (!JUMP_PLACES.has(place) || !labWindow || labWindow.isDestroyed()) {
      return;
    }
    labWindow.webContents.send("labs:jump", place);
  });
  if (gotSingleInstanceLock) {
    openLab();
  }
});

app.on("second-instance", () => {
  if (labWindow && !labWindow.isDestroyed()) {
    if (labWindow.isMinimized()) {
      labWindow.restore();
    }
    labWindow.focus();
    openDebugWindow();
    return;
  }
  openLab();
});

app.on("window-all-closed", () => {
  app.quit();
});
