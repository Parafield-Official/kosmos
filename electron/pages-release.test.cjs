const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  preparePagesRelease,
  releaseAssetUrl,
} = require("../scripts/prepare-pages-release.cjs");

describe("GitHub Pages release feed", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "kosmos-pages-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("publishes only update metadata that points at checksummed release assets", () => {
    const artifacts = path.join(root, "artifacts");
    const output = path.join(root, "site");
    mkdirSync(artifacts);
    mkdirSync(output);
    writeFileSync(path.join(artifacts, "latest.yml"), [
      "version: 0.2.0",
      "files:",
      "  - url: Kosmos-0.2.0-win-x64.exe",
      "    sha512: windows-checksum",
      "    size: 123",
      "path: Kosmos-0.2.0-win-x64.exe",
      "sha512: windows-checksum",
      "",
    ].join("\n"));
    writeFileSync(path.join(artifacts, "latest-mac.yml"), [
      "version: 0.2.0",
      "files:",
      "  - url: Kosmos-0.2.0-mac-arm64.zip",
      "    sha512: mac-checksum",
      "    size: 456",
      "path: Kosmos-0.2.0-mac-arm64.zip",
      "sha512: mac-checksum",
      "",
    ].join("\n"));
    for (const asset of [
      "Kosmos-0.2.0-win-x64.exe",
      "Kosmos-0.2.0-win-x64.exe.blockmap",
      "Kosmos-0.2.0-mac-arm64.zip",
      "Kosmos-0.2.0-mac-arm64.dmg",
    ]) {
      writeFileSync(path.join(artifacts, asset), "fixture");
    }

    const result = preparePagesRelease({ artifacts, output, tag: "v0.2.0" });
    const windows = yaml.load(readFileSync(path.join(output, "updates/latest.yml"), "utf8"));
    const mac = yaml.load(readFileSync(path.join(output, "updates/latest-mac.yml"), "utf8"));
    const downloads = JSON.parse(readFileSync(path.join(output, "updates/downloads.json"), "utf8"));

    expect(windows.files[0]).toEqual({
      url: releaseAssetUrl("v0.2.0", "Kosmos-0.2.0-win-x64.exe"),
      sha512: "windows-checksum",
      size: 123,
    });
    expect(windows.path).toBe(releaseAssetUrl("v0.2.0", "Kosmos-0.2.0-win-x64.exe"));
    expect(mac.files[0].url).toBe(releaseAssetUrl("v0.2.0", "Kosmos-0.2.0-mac-arm64.zip"));
    expect(downloads).toEqual({
      version: "0.2.0",
      mac: releaseAssetUrl("v0.2.0", "Kosmos-0.2.0-mac-arm64.dmg"),
      windows: releaseAssetUrl("v0.2.0", "Kosmos-0.2.0-win-x64.exe"),
    });
    expect(result.publishedMetadata).toEqual(["latest-mac.yml", "latest.yml"]);
    expect(result.downloads).toEqual(downloads);
    expect(readFileSync(path.join(output, "updates/latest.yml"), "utf8")).not.toContain("token");
  });

  it("rejects an invalid release tag instead of producing attacker-controlled links", () => {
    expect(() => preparePagesRelease({
      artifacts: path.join(root, "artifacts"),
      output: path.join(root, "site"),
      tag: "../../latest",
    })).toThrow(/release tag/i);
  });
});
