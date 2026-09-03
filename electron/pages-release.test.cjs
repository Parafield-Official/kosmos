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
      "  - url: Kosmos-0.2.0-mac-arm64.dmg",
      "    sha512: mac-dmg-checksum",
      "    size: 789",
      "path: Kosmos-0.2.0-mac-arm64.zip",
      "sha512: mac-checksum",
      "",
    ].join("\n"));

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

  it("uses the release metadata feed for the Lightbox download page", () => {
    const page = readFileSync(path.join(__dirname, "../website/src/main.tsx"), "utf8");

    expect(page).toContain('asset("updates/downloads.json")');
    expect(page).toContain("const RELEASES_PAGE = `${REPO}/releases/latest`;");
    expect(page).not.toMatch(/releases\/download\/v0\.1\.1/);
  });

  it("keeps repeat releases on the native-runtime and metadata-only fast path", () => {
    const workflow = yaml.load(readFileSync(
      path.join(__dirname, "../.github/workflows/release.yml"),
      "utf8",
    ));
    const packageSteps = workflow.jobs.package.steps;
    const step = (name) => packageSteps.find((candidate) => candidate.name === name);
    const pagesSteps = workflow.jobs["pages-build"].steps;
    const pagesStep = (name) => pagesSteps.find((candidate) => candidate.name === name);
    const packageConfig = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));

    expect(step("Restore cached native runtime").uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
    expect(step("Set up Python for Microsoft MarkItDown").if).toBe(
      "steps.native-runtime-cache.outputs.cache-hit != 'true'",
    );
    expect(step("Restore cached speech models").uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
    expect(step("Restore cached speech models").with.key).toContain("runner.os");
    expect(step("Resolve cross-platform speech model cache key")).toBeUndefined();
    expect(step("Prepare verified speech models").run).toBe("npm run prepare:model");
    expect(step("Upload installer artifact").with["compression-level"]).toBe(0);
    expect(step("Preserve signed app while Apple processes it").with["retention-days"]).toBe(7);
    expect(workflow.jobs["notarization-status"]["runs-on"]).toBe("ubuntu-latest");
    expect(workflow.jobs["notarization-status"]["timeout-minutes"]).toBe(345);
    expect(workflow.jobs["finalize-mac"].needs).toEqual(["package", "notarization-status"]);
    expect(workflow.jobs.publish.needs).toEqual(["package", "finalize-mac"]);
    expect(workflow.jobs.publish.steps.find((candidate) => candidate.name === "Download installer artifacts").with.pattern).toBe("kosmos-installer-*");
    expect(pagesStep("Download installer metadata").with.pattern).toBe("kosmos-metadata-*");
    expect(workflow.jobs["pages-build"].needs).toEqual(["package", "finalize-mac"]);
    expect(workflow.jobs.pages.needs).toEqual(["publish", "pages-build"]);
    expect(packageConfig.build.compression).toBeUndefined();
  });
});
