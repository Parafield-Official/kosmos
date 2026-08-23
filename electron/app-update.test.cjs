const { EventEmitter } = require("node:events");
const {
  CHECK_EVERY_MS,
  RELEASE_PAGE,
  UPDATE_FEED,
  createAppUpdater,
} = require("./app-update.cjs");

function fakeAutoUpdater() {
  const emitter = new EventEmitter();
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    checkForUpdates: vi.fn(async () => ({})),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    on(event, listener) {
      emitter.on(event, listener);
      return autoUpdater;
    },
    emit(event, ...args) {
      return emitter.emit(event, ...args);
    },
  };
  return autoUpdater;
}

describe("desktop auto-update", () => {
  it("does not phone GitHub from an unpackaged development copy", async () => {
    const autoUpdater = fakeAutoUpdater();
    const send = vi.fn();
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: false,
      currentVersion: "0.1.1",
      send,
    });

    await updater.started;
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(updater.getStatus()).toMatchObject({
      phase: "idle",
      skipped: true,
      showBanner: false,
      currentVersion: "0.1.1",
    });
  });

  it("checks the public Kosmos GitHub feed when the app is installed", async () => {
    const autoUpdater = fakeAutoUpdater();
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("update-not-available", { version: "0.1.1" });
      return {};
    });
    const send = vi.fn();
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: true,
      currentVersion: "0.1.1",
      send,
    });

    await updater.started;
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(UPDATE_FEED);
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdater.allowDowngrade).toBe(false);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.getStatus()).toMatchObject({
      phase: "up-to-date",
      showBanner: false,
      currentVersion: "0.1.1",
    });
    expect(updater.getStatus().text).toMatch(/current/i);
  });

  it("downloads an update without quitting, then restarts only when asked", async () => {
    const autoUpdater = fakeAutoUpdater();
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit("update-available", { version: "0.1.2" });
      autoUpdater.emit("download-progress", { percent: 41.2 });
      autoUpdater.emit("update-downloaded", { version: "0.1.2" });
      return {};
    });
    const send = vi.fn();
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: true,
      currentVersion: "0.1.1",
      send,
    });

    await updater.started;
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.getStatus()).toMatchObject({
      phase: "ready",
      version: "0.1.2",
      canInstall: true,
      showBanner: true,
    });
    expect(updater.getStatus().text).toContain("0.1.2");
    expect(updater.getStatus().text).toMatch(/restart/i);
    expect(updater.getStatus().releasePage).toBe(RELEASE_PAGE);

    expect(updater.install()).toEqual({ installed: true });
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("does not force a restart while a download is still in flight", async () => {
    const autoUpdater = fakeAutoUpdater();
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit("update-available", { version: "0.1.2" });
      autoUpdater.emit("download-progress", { percent: 10 });
      return {};
    });
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: true,
      currentVersion: "0.1.1",
      send: vi.fn(),
    });

    await updater.started;
    expect(updater.getStatus().phase).toBe("downloading");
    expect(updater.getStatus().text).toMatch(/10/);
    await updater.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.install()).toEqual({ installed: false });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("keeps the booth usable if GitHub cannot be reached", async () => {
    const autoUpdater = fakeAutoUpdater();
    autoUpdater.checkForUpdates.mockRejectedValue(new Error("ENOTFOUND github.com"));
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: true,
      currentVersion: "0.1.1",
      send: vi.fn(),
    });

    await updater.started;
    expect(updater.getStatus()).toMatchObject({
      phase: "error",
      showBanner: true,
      canInstall: false,
    });
    expect(updater.getStatus().text).toMatch(/still works/i);
    expect(updater.install()).toEqual({ installed: false });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("asks GitHub again later so a copy left open still catches a new release", async () => {
    const autoUpdater = fakeAutoUpdater();
    const timers = [];
    const updater = createAppUpdater({
      autoUpdater,
      isPackaged: true,
      currentVersion: "0.1.1",
      send: vi.fn(),
      setIntervalFn: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearIntervalFn: vi.fn(),
    });

    await updater.started;
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(CHECK_EVERY_MS);
    expect(CHECK_EVERY_MS).toBe(4 * 60 * 60 * 1000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    await timers[0].fn();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.dispose();
  });

  it("points already-installed copies at the public Kosmos GitHub releases", () => {
    expect(UPDATE_FEED).toEqual({
      provider: "github",
      owner: "Manishram-ai",
      repo: "kosmos",
    });
    expect(RELEASE_PAGE).toBe("https://github.com/Manishram-ai/kosmos/releases/latest");
  });
});
