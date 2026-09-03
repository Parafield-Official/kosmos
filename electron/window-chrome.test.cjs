const {
  applyMacWindowButtonVisibility,
  callWindowMethod,
  framedDesktopWindowOptions,
  isFramedDesktopPlatform,
  syncNativeWindowChrome,
} = require("./window-chrome.cjs");

describe("native window chrome", () => {
  it("treats Windows and Linux as framed desktops", () => {
    expect(isFramedDesktopPlatform("win32")).toBe(true);
    expect(isFramedDesktopPlatform("linux")).toBe(true);
    expect(isFramedDesktopPlatform("darwin")).toBe(false);
    expect(framedDesktopWindowOptions("win32")).toMatchObject({
      framed: true,
      customWindowDrag: false,
      interceptMaximize: false,
      lockAspectRatio: false,
      titleBarStyle: "default",
    });
    expect(framedDesktopWindowOptions("darwin")).toMatchObject({
      framed: false,
      customWindowDrag: true,
      interceptMaximize: true,
      transparent: true,
    });
  });

  it("does not call macOS traffic-light APIs on a Windows BrowserWindow", () => {
    const win = {};
    expect(() => syncNativeWindowChrome(win, {
      platform: "win32",
      showTrafficChrome: false,
    })).not.toThrow();
    expect(applyMacWindowButtonVisibility(win, false)).toBe(false);
  });

  it("swallows missing Electron methods instead of rejecting startup", () => {
    const win = {
      setAlwaysOnTop() {
        throw new Error("unsupported");
      },
    };
    expect(callWindowMethod(win, "setAlwaysOnTop", true)).toBe(false);
    expect(callWindowMethod(win, "show")).toBe(false);
  });

  it("hides or shows traffic lights only when Electron provides the method", () => {
    const calls = [];
    const win = {
      setWindowButtonVisibility(visible) {
        calls.push(visible);
      },
    };
    syncNativeWindowChrome(win, { platform: "darwin", showTrafficChrome: true });
    syncNativeWindowChrome(win, { platform: "darwin", showTrafficChrome: false });
    expect(calls).toEqual([true, false]);
  });
});
