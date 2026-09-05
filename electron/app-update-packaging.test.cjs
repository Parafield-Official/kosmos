const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  writeAppUpdateConfig,
} = require("../scripts/ensure-app-update-config.cjs");

describe("packaged updater configuration", () => {
  it.each([
    ["darwin", ["Kosmos.app", "Contents", "Resources", "app-update.yml"]],
    ["win32", ["resources", "app-update.yml"]],
  ])("writes the updater configuration into the %s app bundle before signing", async (platform, relativePath) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-update-config-"));
    const appOutDir = path.join(root, "out");
    const config = {
      provider: "generic",
      url: "https://parafield-official.github.io/kosmos/updates/",
      updaterCacheDirName: "booth-desk-updater",
    };

    try {
      await writeAppUpdateConfig({
        appOutDir,
        electronPlatformName: platform,
        packager: { appInfo: { productFilename: "Kosmos" } },
      }, {
        getConfig: async () => config,
      });

      const written = yaml.load(await fs.readFile(path.join(appOutDir, ...relativePath), "utf8"));
      expect(written).toEqual(config);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("stops Electron Builder before an installer can be made when the written configuration changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-update-config-"));
    const appOutDir = path.join(root, "out");
    const config = {
      provider: "generic",
      url: "https://parafield-official.github.io/kosmos/updates/",
      updaterCacheDirName: "booth-desk-updater",
    };

    try {
      await expect(writeAppUpdateConfig({
        appOutDir,
        electronPlatformName: "win32",
        packager: { appInfo: { productFilename: "Kosmos" } },
      }, {
        getConfig: async () => config,
        readFile: async () => yaml.dump({ ...config, updaterCacheDirName: "wrong-cache" }),
      })).rejects.toThrow(/app-update\.yml/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
