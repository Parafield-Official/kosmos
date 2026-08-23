import {
  KOSMOS_RELEASE_PAGE,
  LAST_SEEN_VERSION_KEY,
  appliedUpdateNotice,
  rememberSeenVersion,
  settingsUpdateCopy,
  shouldShowUpdateBanner,
  updateBannerAction,
  updateNoticeView,
  type AppUpdateStatus,
} from "./app-update";

function status(patch: Partial<AppUpdateStatus>): AppUpdateStatus {
  return {
    phase: "idle",
    currentVersion: "0.1.1",
    showBanner: false,
    canInstall: false,
    text: "",
    releasePage: KOSMOS_RELEASE_PAGE,
    ...patch,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("in-app update notice", () => {
  it("stays out of the way while checking or when this copy is current", () => {
    expect(shouldShowUpdateBanner(null)).toBe(false);
    expect(updateNoticeView(status({ phase: "checking" }))).toBeNull();
    expect(updateNoticeView(status({
      phase: "up-to-date",
      text: "This copy is current (0.1.1).",
    }))).toBeNull();
  });

  it("shows an automatic arriving card while a new version downloads itself", () => {
    const arriving = updateNoticeView(status({
      phase: "downloading",
      version: "0.1.2",
      percent: 62.4,
      showBanner: true,
    }));
    expect(arriving).toMatchObject({
      kind: "arriving",
      auto: true,
      percent: 62,
      title: "Kosmos 0.1.2 is coming in",
    });
    expect(arriving?.action).toBeUndefined();
    expect(arriving?.body).toMatch(/on its own/i);
  });

  it("shows a distinct installed card once the file is on disk", () => {
    const ready = status({
      phase: "ready",
      version: "0.1.2",
      showBanner: true,
      canInstall: true,
      text: "Kosmos 0.1.2 is downloaded. Restart when you are not recording to install it.",
    });
    expect(shouldShowUpdateBanner(ready)).toBe(true);
    const view = updateNoticeView(ready);
    expect(view).toMatchObject({
      kind: "ready",
      auto: true,
      title: "Kosmos 0.1.2 is on this computer",
      action: { kind: "install", label: "Restart now" },
    });
    expect(view?.body).toMatch(/quitting/i);
    expect(updateBannerAction(ready)).toEqual({
      kind: "install",
      label: "Restart now",
    });
  });

  it("celebrates after a restart when the new version is the one running", () => {
    const storage = memoryStorage({ [LAST_SEEN_VERSION_KEY]: "0.1.1" });
    expect(appliedUpdateNotice("0.1.2", storage)).toEqual({
      kind: "applied",
      from: "0.1.1",
      to: "0.1.2",
    });
    const view = updateNoticeView(status({ phase: "up-to-date", currentVersion: "0.1.2" }), {
      kind: "applied",
      from: "0.1.1",
      to: "0.1.2",
    });
    expect(view).toMatchObject({
      kind: "applied",
      auto: true,
      title: "You're on Kosmos 0.1.2",
      action: { kind: "dismiss", label: "OK" },
    });
    rememberSeenVersion("0.1.2", storage);
    expect(appliedUpdateNotice("0.1.2", storage)).toBeNull();
  });

  it("does not celebrate the first time an installed copy learns its version", () => {
    const storage = memoryStorage();
    expect(appliedUpdateNotice("0.1.1", storage)).toBeNull();
    expect(storage.getItem(LAST_SEEN_VERSION_KEY)).toBe("0.1.1");
  });

  it("sends people on a stuck or older installer to the latest GitHub download", () => {
    const failed = status({
      phase: "error",
      showBanner: true,
      text: "Could not update Kosmos automatically. The booth still works.",
    });
    expect(updateNoticeView(failed)?.kind).toBe("stuck");
    expect(updateBannerAction(failed)).toEqual({
      kind: "open-release",
      label: "Get the latest installer",
    });
    expect(KOSMOS_RELEASE_PAGE).toBe("https://github.com/Manishram-ai/kosmos/releases/latest");
  });

  it("tells a development copy that only installed apps keep themselves current", () => {
    expect(settingsUpdateCopy(status({ phase: "idle", skipped: true }))).toMatch(
      /installed/i,
    );
    expect(settingsUpdateCopy(status({
      phase: "up-to-date",
      text: "This copy is current (0.1.1).",
    }))).toMatch(/0\.1\.1/);
  });
});
