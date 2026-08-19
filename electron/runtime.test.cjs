const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  auditFfmpegBuild,
  auditWhisperBuild,
  auditWhisperServerBuild,
  resolveRuntimeBinary,
} = require("./runtime.cjs");

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

  it("rejects a GPL or non-free FFmpeg build before release packaging", () => {
    expect(() => auditFfmpegBuild({
      ffmpegVersion: [
        "ffmpeg version 8.0",
        "configuration: --enable-gpl --enable-nonfree --enable-libx264",
      ].join("\n"),
      ffprobeVersion: "ffprobe version 8.0",
      notices: "FFmpeg: LGPL-2.1-or-later",
    })).toThrow(/GPL|non-free/i);
  });

  it("accepts only an explicitly noticed LGPL-compatible FFmpeg pair", () => {
    const audit = auditFfmpegBuild({
      ffmpegVersion: [
        "ffmpeg version 8.0",
        "configuration: --disable-gpl --disable-nonfree --enable-shared",
      ].join("\n"),
      ffprobeVersion: "ffprobe version 8.0",
      notices: [
        "FFmpeg build: pinned source revision abc123",
        "License: LGPL-2.1-or-later",
        "Source: https://ffmpeg.org",
      ].join("\n"),
    });
    expect(audit).toMatchObject({ license: "LGPL-2.1-or-later", gplEnabled: false, nonfreeEnabled: false });
  });

  it("can require a bundled runtime instead of silently using PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "booth-runtime-missing-"));
    expect(() => resolveRuntimeBinary({
      name: "ffmpeg",
      resourcesPath: "/tmp/booth-missing-resources",
      appPath: "/tmp/booth-missing-app",
      cwd: root,
      platform: "darwin",
      env: {},
      requireBundled: true,
    })).toThrow(/bundled ffmpeg/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts a versioned MIT whisper.cpp runtime with a checksum", () => {
    expect(auditWhisperBuild({
      whisperVersion: "whisper.cpp version: 1.9.2",
      notices: "MIT License\nCopyright (c) 2026 The ggml authors",
      sha256: "a".repeat(64),
    })).toMatchObject({ license: "MIT", sha256: "a".repeat(64) });
  });

  it("rejects an unverified speech runtime", () => {
    expect(() => auditWhisperBuild({
      whisperVersion: "not whisper",
      notices: "MIT License",
      sha256: "bad",
    })).toThrow(/Whisper|checksum|version/i);
  });

  it("audits the persistent Whisper server help output and checksum", () => {
    expect(auditWhisperServerBuild({
      help: "usage: whisper-server [options]",
      sha256: "b".repeat(64),
    })).toEqual({ license: "MIT", sha256: "b".repeat(64) });
  });
});
