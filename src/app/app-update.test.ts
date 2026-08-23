import {
  KOSMOS_RELEASE_PAGE,
  settingsUpdateCopy,
  shouldShowUpdateBanner,
  updateBannerAction,
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

describe("in-app update banner", () => {
  it("stays out of the way while checking or when this copy is current", () => {
    expect(shouldShowUpdateBanner(null)).toBe(false);
    expect(shouldShowUpdateBanner(status({ phase: "checking" }))).toBe(false);
    expect(shouldShowUpdateBanner(status({
      phase: "up-to-date",
      text: "This copy is current (0.1.1).",
    }))).toBe(false);
  });

  it("offers a restart only after the new version is on disk", () => {
    const ready = status({
      phase: "ready",
      version: "0.1.2",
      showBanner: true,
      canInstall: true,
      text: "Kosmos 0.1.2 is downloaded. Restart when you are not recording to install it.",
    });
    expect(shouldShowUpdateBanner(ready)).toBe(true);
    expect(updateBannerAction(ready)).toEqual({
      kind: "install",
      label: "Restart to update",
    });
  });

  it("sends people on a stuck or older installer to the latest GitHub download", () => {
    const failed = status({
      phase: "error",
      showBanner: true,
      text: "Could not update Kosmos automatically. The booth still works.",
    });
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
