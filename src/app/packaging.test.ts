import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig from "../../vite.config";
import packageJson from "../../package.json";

describe("packaged renderer configuration", () => {
  it("uses relative assets so Electron can load the renderer through file://", () => {
    expect(typeof viteConfig).toBe("object");
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it("packages the verified Whisper model and the live follow model for zero-setup speech checking", () => {
    expect(packageJson.scripts["package:mac"]).toContain("npm run prepare:model");
    expect(packageJson.scripts["package:win"]).toContain("npm run prepare:model");
    expect(packageJson.scripts.pretest).toBe("npm run build:core");
    expect(packageJson.build.extraResources).toContainEqual({
      from: "vendor/models",
      to: "models",
      filter: ["ggml-small.en.bin", "realtime_eou_120m-v1-f16.gguf"],
    });
  });

  it("uses Kosmos as the installer and window product name", () => {
    expect(packageJson.build.productName).toBe("Kosmos");
    expect(packageJson.build.artifactName).toContain("Kosmos-");
  });

  it("signs the Mac app with microphone access so a hardened runtime can hear the booth", () => {
    const mac = packageJson.build.mac as { entitlements?: string; entitlementsInherit?: string };
    expect(mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(mac.entitlementsInherit).toBe("build/entitlements.mac.plist");
    const plist = readFileSync(resolve(__dirname, "../../build/entitlements.mac.plist"), "utf8");
    expect(plist).toContain("com.apple.security.device.audio-input");
  });

  it("stages Windows ffmpeg and whisper under GITHUB_WORKSPACE, not RUNNER_TEMP", () => {
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    const start = yaml.indexOf("- name: Prepare Windows runtime assets");
    expect(start).toBeGreaterThan(-1);
    const next = yaml.indexOf("\n      - name:", start + 1);
    const step = yaml.slice(start, next === -1 ? undefined : next);
    expect(step).toContain("GITHUB_WORKSPACE");
    expect(step).not.toMatch(/\$RUNNER_TEMP/);
    expect(step).toContain("ffmpeg-n8.1-latest-win64-lgpl-8.1.zip");
    expect(step).toContain('sha256sum "$ffmpeg_archive"');
    expect(step).toContain("whisper-bin-x64.zip");
    expect(step).toContain("49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a");
    expect(step).not.toContain("Visual Studio 17 2022");
  });

  it("points README download buttons at the tagged installers, not /releases/latest", () => {
    const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
    const version = packageJson.version;
    expect(readme).not.toContain("releases/latest");
    expect(readme).toContain(
      `https://github.com/Parafield-Official/kosmos/releases/download/v${version}/Kosmos-${version}-mac-arm64.dmg`,
    );
    expect(readme).toContain(
      `https://github.com/Parafield-Official/kosmos/releases/download/v${version}/Kosmos-${version}-win-x64.exe`,
    );
  });

  it("publishes a GitHub updater feed so already-installed copies can keep current", () => {
    expect(packageJson.dependencies["electron-updater"]).toBeTruthy();
    expect("electron-updater" in packageJson.devDependencies).toBe(false);
    expect(packageJson.build.publish).toMatchObject({
      provider: "github",
      owner: "Parafield-Official",
      repo: "kosmos",
    });
    const macTargets = packageJson.build.mac.target;
    expect(macTargets).toEqual(expect.arrayContaining(["dmg", "zip"]));
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toContain("dist/latest*.yml");
    expect(yaml).toMatch(/prerelease:\s*false/);
  });

  it("requires signed and notarized macOS releases for reliable in-app updates", () => {
    const mac = packageJson.build.mac as { notarize?: boolean };
    expect(mac.notarize).toBe(true);
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toContain("secrets.MAC_CSC_LINK");
    expect(yaml).toContain("secrets.MAC_CSC_KEY_PASSWORD");
    expect(yaml).toContain("secrets.APPLE_API_KEY_B64");
    expect(yaml).toContain("secrets.APPLE_API_KEY_ID");
    expect(yaml).toContain("secrets.APPLE_API_ISSUER");
    expect(yaml).toContain("codesign --verify --deep --strict");
    expect(yaml).toContain('xcrun stapler validate "$app_path"');
    expect(yaml).not.toContain('xcrun stapler validate "${dmg_files[0]}"');
  });

  it("keeps the macOS-only liquid-glass module optional for Windows packaging", () => {
    expect(packageJson.dependencies).not.toHaveProperty("electron-liquid-glass");
    expect(packageJson.optionalDependencies).toMatchObject({
      "electron-liquid-glass": "^1.1.1",
    });
    expect(packageJson.build.files).toContain("dist/**/*");
    const labsMain = readFileSync(resolve(__dirname, "../../electron/labs.cjs"), "utf8");
    expect(labsMain).toMatch(/try\s*{[\s\S]+require\("electron-liquid-glass"\)[\s\S]+}\s*catch/);
  });

  it("tells people on the first public installer to download once, then stay current in-app", () => {
    const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
    expect(readme).toMatch(/download (this|the current)[\s\S]+once/i);
    expect(readme).toMatch(/later versions/i);
  });
});
