const { EventEmitter } = require("node:events");
const {
  isTrustedRenderer,
  secureRendererWindow,
} = require("./window-security.cjs");

function fakeWindow(initialUrl = "") {
  const webContents = new EventEmitter();
  webContents.getURL = vi.fn(() => initialUrl);
  webContents.setWindowOpenHandler = vi.fn((handler) => {
    webContents.windowOpenHandler = handler;
  });
  return { webContents };
}

function navigationEvent() {
  return { preventDefault: vi.fn() };
}

describe("Electron renderer boundary", () => {
  it("denies popups, webviews, and navigation away from the packaged UI", () => {
    const window = fakeWindow("file:///Applications/Kosmos.app/Contents/Resources/app.asar/dist/index.html");
    secureRendererWindow(window, {
      allowedUrls: ["file:///Applications/Kosmos.app/Contents/Resources/app.asar/dist/index.html"],
    });

    expect(window.webContents.windowOpenHandler({ url: "https://attacker.example" })).toEqual({ action: "deny" });

    const webview = navigationEvent();
    window.webContents.emit("will-attach-webview", webview);
    expect(webview.preventDefault).toHaveBeenCalledOnce();

    const external = navigationEvent();
    window.webContents.emit("will-navigate", external, "https://attacker.example/phish");
    expect(external.preventDefault).toHaveBeenCalledOnce();

    const local = navigationEvent();
    window.webContents.emit(
      "will-navigate",
      local,
      "file:///Applications/Kosmos.app/Contents/Resources/app.asar/dist/index.html#proof",
    );
    expect(local.preventDefault).not.toHaveBeenCalled();
  });

  it("trusts permissions only for a secured window still showing its allowed UI", () => {
    let currentUrl = "http://127.0.0.1:5173/";
    const window = fakeWindow();
    window.webContents.getURL.mockImplementation(() => currentUrl);
    secureRendererWindow(window, { allowedUrls: ["http://127.0.0.1:5173/"] });

    expect(isTrustedRenderer(window.webContents)).toBe(true);
    currentUrl = "https://attacker.example/";
    expect(isTrustedRenderer(window.webContents)).toBe(false);
  });
});
