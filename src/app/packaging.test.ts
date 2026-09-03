import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig from "../../labs/next/vite.config";
import packageJson from "../../package.json";

describe("packaged renderer configuration", () => {
  it("uses relative assets so Electron can load the renderer through file://", () => {
    expect(typeof viteConfig).toBe("object");
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it("ships a restrictive renderer Content Security Policy", () => {
    const html = readFileSync(resolve(__dirname, "../../labs/next/index.html"), "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-src 'none'");
  });

  it("downloads verified speech models once into persistent user storage", () => {
    expect(packageJson.scripts["package:mac"]).not.toContain("npm run prepare:model");
    expect(packageJson.scripts["package:win"]).not.toContain("npm run prepare:model");
    expect(packageJson.scripts.pretest).toBe("npm run build:core");
    expect(packageJson.build.extraResources).not.toContainEqual({
      from: "vendor/models",
      to: "models",
      filter: ["ggml-small.en.bin", "realtime_eou_120m-v1-f16.gguf", "THIRD_PARTY_NOTICES.txt"],
    });
    expect(packageJson.build.extraResources).toContainEqual({
      from: "THIRD_PARTY_NOTICES.md",
      to: "THIRD_PARTY_NOTICES.md",
    });
    const model = readFileSync(resolve(__dirname, "../../electron/model.cjs"), "utf8");
    expect(model).toContain('path.join(userDataPath, "models", MODEL.fileName)');
    expect(model).toContain("for (const spec of MODELS)");
    expect(model).toContain("downloadVerifiedModel(spec, destination, onProgress)");
    expect(model).toContain('const MODEL_MARKER_SUFFIX = ".sha256"');
    expect(model).toContain("resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6");
  });

  it("ships a pinned WhisperX faster-whisper runtime for every installer", () => {
    expect(packageJson.build.extraResources).toContainEqual({
      from: "vendor/whisperx-runtime/whisperx",
      to: "whisperx",
      filter: ["**/*"],
    });
    expect(packageJson.build.extraResources).toContainEqual({
      from: "vendor/silero-vad/snakers4_silero-vad_master",
      to: "silero-vad/snakers4_silero-vad_master",
      filter: ["**/*"],
    });

    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toContain("vendor/whisperx-runtime");
    expect(yaml).toContain("whisperx==3.8.6");
    expect(yaml).toContain("faster-whisper==1.2.1");
    expect(yaml).toContain("ctranslate2==4.8.1");
    expect(yaml).toContain("scripts/whisperx_cli.py");
    expect(yaml).toContain("--onedir");
    expect(yaml).toContain("--collect-data pyannote.audio");
    expect(yaml).not.toContain("--collect-all torchcodec");
    expect(yaml).toContain("WHISPERX_THIRD_PARTY_NOTICES.txt");
    expect(yaml).toContain("867c2aa692646a1f1de3e94a15c9dd9f614c0acb");
    expect(yaml).toContain("562d99d4bf35eea155596a08a937ef418353541623e9df213e024aeb7070f8bb");
    expect(yaml).toContain("snakers4_silero-vad_master/hubconf.py");
    expect(yaml).toContain(".kosmos-silero-vad-revision");
    expect(yaml).toContain("tarfile.open");
    expect(yaml).toContain("shutil.copytree");
    expect(yaml).toContain("hashlib.sha256");
    expect(yaml).toContain("public/examples/proof/on_vs_in.wav");
    expect(yaml).toContain("whisperx-smoke/on_vs_in.json");
    expect(yaml.indexOf("public/examples/proof/on_vs_in.wav")).toBeGreaterThan(
      yaml.indexOf("- name: Prepare Windows runtime assets"),
    );
    expect(yaml).toMatch(/whisperx(?:\.exe)?\"? --version/);

    const wrapper = readFileSync(resolve(__dirname, "../../scripts/whisperx_cli.py"), "utf8");
    expect(wrapper).toContain("multiprocessing.freeze_support()");
    expect(wrapper).toContain('metadata.version("whisperx")');
    expect(wrapper).toContain("from whisperx.__main__ import cli");
    expect(wrapper).toContain("raise SystemExit(cli())");
  });

  it("smoke-tests the frozen WhisperX runtime on Windows before release tags", () => {
    const yaml = readFileSync(
      resolve(__dirname, "../../.github/workflows/whisperx-runtime-smoke.yml"),
      "utf8",
    );
    expect(yaml).toContain("windows-latest");
    expect(yaml).toContain("scripts/whisperx_cli.py");
    expect(yaml).toContain("--onedir");
    expect(yaml).toContain("public/examples/proof/on_vs_in.wav");
    expect(yaml).toContain("word_segments");
    expect(yaml).toContain("snakers4_silero-vad_master");
    expect(yaml).toContain('$GITHUB_WORKSPACE/.ci-runtime/silero-vad');
    expect(yaml).toContain("tarfile.open");
    expect(yaml).toContain("shutil.copytree");
    expect(yaml).toContain("hashlib.sha256");
    expect(yaml).not.toContain('tar -xzf "$silero_archive"');
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

  it("stages pinned Windows FFmpeg and Whisper under GITHUB_WORKSPACE, not RUNNER_TEMP", () => {
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    const start = yaml.indexOf("- name: Prepare Windows runtime assets");
    expect(start).toBeGreaterThan(-1);
    const next = yaml.indexOf("\n      - name:", start + 1);
    const step = yaml.slice(start, next === -1 ? undefined : next);
    expect(step).toContain("GITHUB_WORKSPACE");
    expect(step).not.toMatch(/\$RUNNER_TEMP/);
    expect(step).toContain("autobuild-2026-09-01-13-13");
    expect(step).toContain("ffmpeg-N-126386-gc27482a18d-win64-lgpl-shared.zip");
    expect(step).toContain("4c5abe4d63748166de2c917074fcbacf52276b0cd2542ebf59b09aaa98f547f6");
    expect(step).not.toContain("releases/download/latest");
    expect(step).toContain('sha256sum "$ffmpeg_archive"');
    expect(step).toContain("whisper-bin-x64.zip");
    expect(step).toContain("49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a");
    expect(step).not.toContain("Visual Studio 17 2022");
  });

  it("points the README download button at the stable Kosmos Pages site", () => {
    const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
    expect(readme).not.toContain("releases/latest");
    expect(readme).toContain("https://parafield-official.github.io/kosmos/download.html");
  });

  it("publishes a GitHub Pages updater feed so installed copies can keep current", () => {
    expect(packageJson.dependencies["electron-updater"]).toBe("6.8.9");
    expect("electron-updater" in packageJson.devDependencies).toBe(false);
    expect(packageJson.devDependencies.electron).toBe("44.1.1");
    expect(packageJson.build.publish).toMatchObject({
      provider: "generic",
      url: "https://parafield-official.github.io/kosmos/updates/",
    });
    const macTargets = packageJson.build.mac.target;
    expect(macTargets).toEqual(expect.arrayContaining(["dmg", "zip"]));
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toContain("dist/latest*.yml");
    expect(yaml).toMatch(/prerelease:\s*false/);
    expect(yaml).toContain("actions/configure-pages@");
    expect(yaml).toContain("actions/upload-pages-artifact@");
    expect(yaml).toContain("actions/deploy-pages@");
    expect(yaml).toContain("pages: write");
    expect(yaml).toContain("id-token: write");
    expect(yaml).toContain("scripts/prepare-pages-release.cjs");
  });

  it("only releases tags whose commits were merged into main", () => {
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toContain("refs/remotes/origin/main");
    expect(yaml).toContain('git merge-base --is-ancestor "$GITHUB_SHA"');
    expect(yaml).toMatch(/package:\n\s+needs:\s+authorize/);
  });

  it("checks dev pull requests and only promotes dev into main", () => {
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");
    expect(yaml).toMatch(/pull_request:\n\s+branches:\n\s+- dev\n\s+- main/);
    expect(yaml).toMatch(/push:\n\s+branches:\n\s+- dev\n\s+- main/);
    expect(yaml).toContain("github.base_ref == 'main'");
    expect(yaml).toContain('[ "$HEAD_BRANCH" != "dev" ]');
    expect(yaml).toContain("name: Build and test");
    expect(yaml).toContain("run: npm run build");
    expect(yaml).toContain("run: npm test");
    expect(yaml).toMatch(/permissions:\n\s+contents:\s+read/);
  });

  it("pins every GitHub Action to an immutable full commit SHA", () => {
    const workflows = ["ci.yml", "release.yml"]
      .map((name) => readFileSync(resolve(__dirname, `../../.github/workflows/${name}`), "utf8"))
      .join("\n");
    const actionRefs = [...workflows.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)].map((match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((ref) => /^[0-9a-f]{40}$/u.test(ref))).toBe(true);
  });

  it("requires signed and resiliently-notarized macOS releases for reliable in-app updates", () => {
    const mac = packageJson.build.mac as { notarize?: boolean };
    expect(mac.notarize).toBe(false);
    expect(packageJson.build.afterSign).toBe("scripts/notarize-macos.cjs");
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(yaml).toMatch(/push:\n\s+tags:\n\s+- "v\*\.\*\.\*"/);
    expect(yaml).not.toContain("workflow_dispatch:");
    expect(yaml).not.toContain("Restore cached speech models");
    expect(yaml).not.toContain("Prepare verified speech models");
    expect(yaml).not.toContain("run: npm run prepare:model");
    expect(yaml).toContain("secrets.MAC_CSC_LINK");
    expect(yaml).toContain("secrets.MAC_CSC_KEY_PASSWORD");
    expect(yaml).toContain("secrets.APPLE_API_KEY_B64");
    expect(yaml).toContain("secrets.APPLE_API_KEY_ID");
    expect(yaml).toContain("secrets.APPLE_API_ISSUER");
    expect(yaml).toContain("Wait for Apple without holding a Mac runner");
    expect(yaml).toContain("scripts/wait-for-notarization.cjs");
    expect(yaml).toContain("kosmos-notarization-${{ github.run_id }}");
    expect(yaml).toContain("--prepackaged \"$app_path\"");
    expect(yaml).toContain("codesign --verify --deep --strict");
    expect(yaml).toContain('xcrun stapler validate "$app_path"');
    expect(yaml).toContain("shasum -a 256 dist/notarization/FFmpeg-8.1.1-source.tar.xz");
    expect(yaml).not.toContain("sha256sum dist/notarization/FFmpeg-8.1.1-source.tar.xz");
    expect(yaml).not.toContain('xcrun stapler validate "${dmg_files[0]}"');
    const notarizationHook = readFileSync(resolve(__dirname, "../../scripts/notarize-macos.cjs"), "utf8");
    const notarizationWaiter = readFileSync(resolve(__dirname, "../../scripts/wait-for-notarization.cjs"), "utf8");
    expect(notarizationHook).toContain("notarytool");
    expect(notarizationHook).toContain("submission");
    expect(notarizationHook).not.toContain('"--wait"');
    expect(notarizationHook).not.toContain('"info"');
    expect(notarizationWaiter).toContain('const API_ORIGIN = "https://appstoreconnect.apple.com"');
    expect(notarizationWaiter).toContain("/notary/v2/submissions/");
    expect(notarizationWaiter).toContain("Re-run failed jobs");
  });

  it("makes the temporary unsigned Windows channel explicit without embedding signing secrets", () => {
    const yaml = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
    expect(packageJson.build.win.verifyUpdateCodeSignature).toBe(false);
    expect(yaml).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(yaml).not.toContain("Get-AuthenticodeSignature");
    expect(yaml).not.toContain("WIN_CSC_LINK");
    expect(yaml).not.toContain("WIN_CSC_KEY_PASSWORD");
    expect(yaml).toMatch(/permissions:\n\s+contents:\s+read/);
    expect(yaml).toMatch(/publish:[\s\S]*?permissions:\n\s+contents:\s+write/);
  });

  it("keeps the macOS-only liquid-glass module optional for Windows packaging", () => {
    expect(packageJson.dependencies).not.toHaveProperty("electron-liquid-glass");
    expect(packageJson.optionalDependencies).toMatchObject({
      "electron-liquid-glass": "^1.1.1",
    });
    expect(packageJson.build.files).toContain("dist/**/*");
    expect(packageJson.build.files).toContain("!electron/**/*.test.cjs");
    expect(packageJson.build.files).toContain("!electron/glass-test-preload.cjs");
    const labsMain = readFileSync(resolve(__dirname, "../../electron/labs.cjs"), "utf8");
    expect(labsMain).toMatch(/process\.platform === "darwin"[\s\S]+try\s*{[\s\S]+require\("electron-liquid-glass"\)[\s\S]+}\s*catch/);
    expect(labsMain).not.toMatch(/else\s*\{\s*labWindow\.setWindowButtonVisibility/);
    expect(labsMain).toMatch(/name: "parakeet-live"[\s\S]+optional:\s*true/);
    expect(labsMain).toMatch(/name: "parakeet-server"[\s\S]+optional:\s*true/);
    expect(labsMain).toMatch(/function tryOpenLab/);
  });

  it("fails closed on missing bundled FFmpeg in packaged builds", () => {
    const labsAudio = readFileSync(resolve(__dirname, "../../electron/labs-audio.cjs"), "utf8");
    expect(labsAudio).toMatch(/requireBundled:\s*app\.isPackaged/);
    expect(labsAudio).not.toMatch(/requireBundled:\s*!app\.isPackaged/);
    expect(labsAudio).toMatch(/writeFileAtomic.*file-utils|file-utils\.cjs[\s\S]*writeFileAtomic/);
  });

  it("tells people on the first public installer to download once, then stay current in-app", () => {
    const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
    expect(readme).toMatch(/download (this|the current)[\s\S]+once/i);
    expect(readme).toMatch(/later versions/i);
  });
});
