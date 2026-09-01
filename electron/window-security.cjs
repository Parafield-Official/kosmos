const policies = new WeakMap();

function canonicalNavigationUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function secureRendererWindow(window, { allowedUrls = [] } = {}) {
  const allowed = new Set(allowedUrls.map(canonicalNavigationUrl).filter(Boolean));
  const isAllowed = (value) => allowed.has(canonicalNavigationUrl(value));
  const contents = window.webContents;
  policies.set(contents, isAllowed);

  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, navigationUrl) => {
    if (!isAllowed(navigationUrl)) {
      event.preventDefault();
    }
  });
  contents.once("destroyed", () => policies.delete(contents));
}

function isTrustedRenderer(contents) {
  const isAllowed = policies.get(contents);
  return Boolean(isAllowed && isAllowed(contents.getURL()));
}

module.exports = {
  canonicalNavigationUrl,
  isTrustedRenderer,
  secureRendererWindow,
};
