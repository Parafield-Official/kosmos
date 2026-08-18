const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveRuntimeBinary } = require("./runtime.cjs");

describe("runtime binary resolution", () => {
  it("prefers a bundled resource over the system command", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "booth-runtime-"));
    const bundled = path.join(root, "bin", "ffmpeg");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "binary");
    expect(resolveRuntimeBinary({
      name: "ffmpeg",
      envVar: "FFMPEG_PATH",
      resourcesPath: root,
      appPath: path.join(root, "app"),
      platform: "darwin",
      env: {},
    })).toBe(bundled);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses an explicit contributor override when it exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "booth-runtime-"));
    const override = path.join(root, "ffmpeg");
    fs.writeFileSync(override, "binary");
    expect(resolveRuntimeBinary({
      name: "ffmpeg",
      envVar: "FFMPEG_PATH",
      resourcesPath: path.join(root, "missing"),
      appPath: path.join(root, "app"),
      platform: "darwin",
      env: { FFMPEG_PATH: override },
    })).toBe(override);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses the Windows executable suffix for bundled resources", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "booth-runtime-"));
    const bundled = path.join(root, "bin", "ffprobe.exe");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "binary");
    expect(resolveRuntimeBinary({
      name: "ffprobe",
      envVar: "FFPROBE_PATH",
      resourcesPath: root,
      appPath: path.join(root, "app"),
      platform: "win32",
      env: {},
    })).toBe(bundled);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
