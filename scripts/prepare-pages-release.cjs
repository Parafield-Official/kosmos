const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const OWNER = "Parafield-Official";
const REPOSITORY = "kosmos";
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SAFE_ASSET = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

function assertReleaseTag(tag) {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
}

function releaseAssetUrl(tag, asset) {
  assertReleaseTag(tag);
  if (path.basename(asset) !== asset || !SAFE_ASSET.test(asset)) {
    throw new Error(`Invalid release asset name: ${asset}`);
  }
  return `https://github.com/${OWNER}/${REPOSITORY}/releases/download/${tag}/${encodeURIComponent(asset)}`;
}

function assetName(value) {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return path.posix.basename(decodeURIComponent(pathname));
}

function rewriteUpdateMetadata(source, tag) {
  const info = yaml.load(source);
  if (!info || typeof info !== "object") {
    throw new Error("Update metadata must be a YAML object.");
  }
  if (info.version !== tag.slice(1)) {
    throw new Error(`Update metadata version ${info.version} does not match ${tag}.`);
  }
  if (!Array.isArray(info.files) || info.files.length === 0) {
    throw new Error("Update metadata has no release files.");
  }
  for (const file of info.files) {
    if (!file || typeof file.url !== "string" || typeof file.sha512 !== "string") {
      throw new Error("Every update file must have a URL and SHA-512 checksum.");
    }
    file.url = releaseAssetUrl(tag, assetName(file.url));
  }
  if (typeof info.path === "string") {
    info.path = releaseAssetUrl(tag, assetName(info.path));
  }
  if (info.packages && typeof info.packages === "object") {
    for (const packageInfo of Object.values(info.packages)) {
      if (packageInfo && typeof packageInfo.path === "string") {
        packageInfo.path = releaseAssetUrl(tag, assetName(packageInfo.path));
      }
    }
  }
  return yaml.dump(info, { lineWidth: -1, noRefs: true });
}

function exactlyOne(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} release asset, found ${matches.length}.`);
  }
  return matches[0];
}

function metadataAssetNames(info, label) {
  if (!info || typeof info !== "object" || !Array.isArray(info.files)) {
    throw new Error(`Expected ${label} update metadata with release files.`);
  }
  return info.files.map((file) => {
    if (!file || typeof file.url !== "string") {
      throw new Error(`Every ${label} update file must have a URL.`);
    }
    return assetName(file.url);
  });
}

function preparePagesRelease({ artifacts, output, tag }) {
  assertReleaseTag(tag);
  const files = fs.readdirSync(artifacts).sort();
  const metadataFiles = files.filter((file) => /^latest(?:-mac)?\.yml$/.test(file));
  if (metadataFiles.length !== 2) {
    throw new Error(`Expected Windows and macOS update metadata, found ${metadataFiles.length} files.`);
  }

  const updates = path.join(output, "updates");
  fs.mkdirSync(updates, { recursive: true });
  const metadata = new Map();
  for (const file of metadataFiles) {
    const source = fs.readFileSync(path.join(artifacts, file), "utf8");
    metadata.set(file, yaml.load(source));
    fs.writeFileSync(path.join(updates, file), rewriteUpdateMetadata(source, tag));
  }

  // The Pages job receives only the tiny updater metadata artifact. Derive
  // the public download names from checksummed electron-builder metadata so
  // it never downloads the multi-gigabyte installers a second time.
  const windowsAsset = exactlyOne(
    metadataAssetNames(metadata.get("latest.yml"), "Windows"),
    /^Kosmos-.+-win-x64\.exe$/,
    "Windows installer",
  );
  const macAsset = exactlyOne(
    metadataAssetNames(metadata.get("latest-mac.yml"), "macOS"),
    /^Kosmos-.+-mac-arm64\.dmg$/,
    "macOS disk image",
  );
  const downloads = {
    version: tag.slice(1),
    mac: releaseAssetUrl(tag, macAsset),
    windows: releaseAssetUrl(tag, windowsAsset),
  };
  fs.writeFileSync(
    path.join(updates, "downloads.json"),
    `${JSON.stringify(downloads, null, 2)}\n`,
  );

  return { publishedMetadata: metadataFiles, downloads };
}

if (require.main === module) {
  const [artifacts, output, tag] = process.argv.slice(2);
  if (!artifacts || !output || !tag) {
    throw new Error("Usage: prepare-pages-release.cjs <artifacts> <output> <release-tag>");
  }
  const result = preparePagesRelease({ artifacts, output, tag });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  preparePagesRelease,
  releaseAssetUrl,
  rewriteUpdateMetadata,
};
