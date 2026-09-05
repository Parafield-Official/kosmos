const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");
const { serializeToYaml } = require("builder-util");
const { sanitizeFileName } = require("builder-util/out/filename");
const { getAppUpdatePublishConfiguration } = require("app-builder-lib/out/publish/PublishManager");

function updaterConfigFor(context) {
  return getAppUpdatePublishConfiguration(context.packager, null, context.arch, false);
}

function configPathFor(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName === "darwin") {
    const productFilename = packager?.appInfo?.productFilename;
    if (!productFilename) {
      throw new Error("Cannot write the macOS updater configuration without the packaged app name.");
    }
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources", "app-update.yml");
  }
  if (electronPlatformName === "win32") {
    return path.join(appOutDir, "resources", "app-update.yml");
  }
  return null;
}

async function writeAppUpdateConfig(context, {
  getConfig = updaterConfigFor,
  readFile = fs.readFile,
} = {}) {
  const destination = configPathFor(context);
  if (!destination) {
    return null;
  }

  const config = await getConfig(context);
  if (!config) {
    throw new Error(`Electron Builder did not provide an updater configuration for ${context.electronPlatformName}.`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, serializeToYaml(config), "utf8");
  let written;
  try {
    written = yaml.load(await readFile(destination, "utf8"));
  } catch (error) {
    throw new Error(`Electron Builder could not read back written app-update.yml at ${destination}: ${error.message}`);
  }
  try {
    assert.deepEqual(written, config);
  } catch {
    throw new Error(`Electron Builder wrote an invalid app-update.yml at ${destination}.`);
  }
  return destination;
}

function expectedAppUpdateConfig(packageConfig = require("../package.json")) {
  const publish = Array.isArray(packageConfig?.build?.publish)
    ? packageConfig.build.publish[0]
    : packageConfig?.build?.publish;
  if (!publish?.provider || !publish?.url || !packageConfig?.name) {
    throw new Error("Cannot verify the updater configuration without a package name and generic publish URL.");
  }
  return {
    ...publish,
    updaterCacheDirName: `${sanitizeFileName(packageConfig.name).toLowerCase()}-updater`,
  };
}

function packagedConfigPath({ platform, appPath }) {
  if (platform === "darwin") {
    return path.join(appPath, "Contents", "Resources", "app-update.yml");
  }
  if (platform === "win32") {
    return path.join(appPath, "resources", "app-update.yml");
  }
  throw new Error(`Cannot verify an updater configuration for unsupported platform ${platform}.`);
}

async function verifyPackagedAppUpdateConfig({ platform, appPath, packageConfig }) {
  const configPath = packagedConfigPath({ platform, appPath });
  let actual;
  try {
    actual = yaml.load(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Packaged ${platform} app is missing app-update.yml at ${configPath}.`);
    }
    throw error;
  }
  assert.deepEqual(actual, expectedAppUpdateConfig(packageConfig));
  return configPath;
}

async function runCli() {
  const [platform, appPath] = process.argv.slice(2);
  if (!platform || !appPath || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/ensure-app-update-config.cjs <darwin|win32> <packaged-app-path>");
  }
  const configPath = await verifyPackagedAppUpdateConfig({ platform, appPath });
  process.stdout.write(`Verified updater configuration: ${configPath}\n`);
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = writeAppUpdateConfig;
module.exports.configPathFor = configPathFor;
module.exports.expectedAppUpdateConfig = expectedAppUpdateConfig;
module.exports.packagedConfigPath = packagedConfigPath;
module.exports.updaterConfigFor = updaterConfigFor;
module.exports.verifyPackagedAppUpdateConfig = verifyPackagedAppUpdateConfig;
module.exports.writeAppUpdateConfig = writeAppUpdateConfig;
