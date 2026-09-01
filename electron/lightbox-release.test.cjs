const path = require("node:path");
const { pathToFileURL } = require("node:url");
const packageJson = require("../package.json");

describe("Lightbox release entry", () => {
  it("packages the Lightbox main process and renderer for every installer", async () => {
    expect(packageJson.main).toBe("electron/labs.cjs");
    expect(packageJson.scripts.build).toContain("vite build --config labs/next/vite.config.ts");

    const config = (await import("../labs/next/vite.config.ts")).default;
    expect(config.base).toBe("./");
    expect(config.build?.outDir).toBe("../../dist");
    expect(packageJson.build.files).toContain("dist/**/*");
    expect(packageJson.build.files).toContain("!electron/main.cjs");
    expect(packageJson.build.files).toContain("!electron/preload.cjs");
  });

  it("loads the bundled Lightbox page in production and the dev server locally", () => {
    const { lightboxPageUrl } = require("./lightbox-entry.cjs");
    const appPath = path.join(path.sep, "Applications", "Kosmos.app", "Contents", "Resources", "app.asar");

    expect(lightboxPageUrl({ isPackaged: true, appPath })).toBe(
      pathToFileURL(path.join(appPath, "dist", "index.html")).href,
    );
    expect(lightboxPageUrl({ isPackaged: false, appPath })).toBe("http://127.0.0.1:5174/");
    expect(lightboxPageUrl({ isPackaged: false, appPath, page: "debug.html" })).toBe(
      "http://127.0.0.1:5174/debug.html",
    );
  });

  it("never opens the Lightbox debug window in installed builds", () => {
    const { shouldOpenLightboxDebug } = require("./lightbox-entry.cjs");
    expect(shouldOpenLightboxDebug({ isPackaged: true })).toBe(false);
    expect(shouldOpenLightboxDebug({ isPackaged: false })).toBe(true);
  });
});
