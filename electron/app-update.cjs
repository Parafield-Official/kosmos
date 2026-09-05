/**
 * Installed Kosmos copies check the public Kosmos GitHub Pages channel for a
 * later version. Source and release automation can stay private; installed
 * copies receive only the published update metadata and installers.
 * The request is a version feed only — no book, voice, or identity leaves
 * this computer. Unpackaged development copies do not check.
 */
const UPDATE_FEED = {
  provider: "generic",
  url: "https://parafield-official.github.io/kosmos/updates/",
};
const RELEASE_PAGE = "https://parafield-official.github.io/kosmos/download/";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function copyFor(state) {
  if (state.phase === "ready") {
    return `Kosmos ${state.version} is downloaded. Restart when you are not recording to install it.`;
  }
  if (state.phase === "downloading") {
    const percent = Number.isFinite(state.percent) ? ` ${Math.round(state.percent)} percent.` : "";
    return `Downloading Kosmos ${state.version || "a new version"}.${percent}`;
  }
  if (state.phase === "available") {
    return `Kosmos ${state.version} is available. It downloads in the background.`;
  }
  if (state.phase === "error") {
    return "Could not update Kosmos automatically. The booth still works. If this copy cannot update itself, download the latest installer from the Kosmos website once.";
  }
  if (state.phase === "up-to-date") {
    return state.currentVersion
      ? `This copy is current (${state.currentVersion}).`
      : "This copy is current.";
  }
  return "";
}

function present(state) {
  const showBanner = state.phase === "available"
    || state.phase === "downloading"
    || state.phase === "ready"
    || state.phase === "error";
  return {
    phase: state.phase,
    currentVersion: state.currentVersion,
    version: state.version,
    percent: state.percent,
    transferred: state.transferred,
    total: state.total,
    message: state.message,
    skipped: Boolean(state.skipped),
    text: copyFor(state),
    showBanner,
    canInstall: state.phase === "ready",
    canDownloadInstaller: state.phase === "error",
    releasePage: RELEASE_PAGE,
  };
}

function createAppUpdater({
  autoUpdater,
  isPackaged,
  currentVersion,
  send,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  checkEveryMs = CHECK_EVERY_MS,
}) {
  let state = present({
    phase: "idle",
    currentVersion,
    skipped: !isPackaged,
  });
  let timer = null;

  function getStatus() {
    return state;
  }

  function emit(partial) {
    const resetProgress = partial.phase === "idle"
      || partial.phase === "up-to-date"
      || partial.phase === "error"
      || partial.phase === "checking";
    state = present({
      phase: partial.phase ?? state.phase,
      currentVersion,
      version: resetProgress && partial.phase !== "checking" ? partial.version : (partial.version ?? state.version),
      percent: resetProgress ? partial.percent : (partial.percent ?? state.percent),
      transferred: resetProgress ? undefined : (partial.transferred ?? state.transferred),
      total: resetProgress ? undefined : (partial.total ?? state.total),
      message: partial.message,
      skipped: partial.skipped ?? false,
    });
    send(state);
  }

  async function check() {
    if (!isPackaged) {
      return getStatus();
    }
    if (["checking", "available", "downloading", "ready"].includes(state.phase)) {
      return getStatus();
    }
    emit({ phase: "checking" });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.downloadPromise) {
        void result.downloadPromise.catch((error) => emit({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        }));
      }
      if (state.phase === "checking") {
        emit({ phase: "up-to-date" });
      }
    } catch (error) {
      emit({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return getStatus();
  }

  function install() {
    if (!isPackaged || state.phase !== "ready") {
      return { installed: false };
    }
    autoUpdater.quitAndInstall(false, true);
    return { installed: true };
  }

  function dispose() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  if (!isPackaged) {
    send(state);
    return {
      getStatus,
      check,
      install,
      dispose,
      started: Promise.resolve(state),
    };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  if (typeof autoUpdater.setFeedURL === "function") {
    autoUpdater.setFeedURL(UPDATE_FEED);
  }

  autoUpdater.on("checking-for-update", () => emit({ phase: "checking" }));
  autoUpdater.on("update-available", (info) => {
    emit({ phase: "available", version: info?.version });
  });
  autoUpdater.on("update-not-available", () => {
    emit({ phase: "up-to-date" });
  });
  autoUpdater.on("download-progress", (progress) => {
    emit({
      phase: "downloading",
      percent: progress?.percent,
      transferred: progress?.transferred,
      total: progress?.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    emit({ phase: "ready", version: info?.version ?? state.version });
  });
  autoUpdater.on("error", (error) => {
    emit({
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

  timer = setIntervalFn(() => {
    void check();
  }, checkEveryMs);

  return {
    getStatus,
    check,
    install,
    dispose,
    started: check(),
  };
}

module.exports = {
  CHECK_EVERY_MS,
  RELEASE_PAGE,
  UPDATE_FEED,
  createAppUpdater,
};
