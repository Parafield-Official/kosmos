const fs = require("node:fs");
const path = require("node:path");

/** Resolve a bundled runtime first, then a contributor-provided override/PATH. */
function resolveRuntimeBinary({
  name,
  envVar,
  resourcesPath,
  appPath,
  cwd = process.cwd(),
  platform = process.platform,
  env = process.env,
  requireBundled = false,
}) {
  const extension = platform === "win32" ? ".exe" : "";
  const candidates = [
    envVar ? env[envVar] : undefined,
    resourcesPath && path.join(resourcesPath, "bin", `${name}${extension}`),
    resourcesPath && path.join(resourcesPath, `${name}${extension}`),
    appPath && path.join(appPath, "vendor", "bin", `${name}${extension}`),
    appPath && path.join(appPath, "vendor", `${name}${extension}`),
    cwd && path.join(cwd, "vendor", "bin", `${name}${extension}`),
    cwd && path.join(cwd, "vendor", `${name}${extension}`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue to the next bundled or configured location.
    }
  }

  if (requireBundled) {
    throw new Error(`The packaged Kosmos build is missing its bundled ${name} runtime.`);
  }

  // Let the operating system resolve a system installation for source builds.
  return name;
}

function auditFfmpegBuild({ ffmpegVersion, ffprobeVersion, notices }) {
  const ffmpegText = String(ffmpegVersion ?? "");
  const ffprobeText = String(ffprobeVersion ?? "");
  const noticeText = String(notices ?? "");
  if (!/^ffmpeg\s+version\s+/imu.test(ffmpegText)) {
    throw new Error("The staged FFmpeg executable did not report a valid version.");
  }
  if (!/^ffprobe\s+version\s+/imu.test(ffprobeText)) {
    throw new Error("The staged FFprobe executable did not report a valid version.");
  }
  const configuration = ffmpegText.match(/^configuration:\s*(.*)$/imu)?.[1] ?? "";
  const gplEnabled = /(?:^|\s)--enable-gpl(?:\s|$)/u.test(configuration);
  const nonfreeEnabled = /(?:^|\s)--enable-nonfree(?:\s|$)/u.test(configuration);
  if (gplEnabled || nonfreeEnabled) {
    throw new Error("The staged FFmpeg build enables GPL or non-free components; an LGPL-only release runtime is required.");
  }
  if (!/LGPL-2\.1(?:-or-later|\+)?/iu.test(noticeText)) {
    throw new Error("The staged FFmpeg runtime is missing an explicit LGPL-2.1-or-later notice.");
  }
  return {
    license: "LGPL-2.1-or-later",
    gplEnabled,
    nonfreeEnabled,
    configuration,
    ffmpegVersion: ffmpegText.split(/\r?\n/u)[0].trim(),
    ffprobeVersion: ffprobeText.split(/\r?\n/u)[0].trim(),
  };
}

function auditWhisperBuild({ whisperVersion, notices, sha256 }) {
  const versionText = String(whisperVersion ?? "").trim();
  const noticeText = String(notices ?? "");
  const checksum = String(sha256 ?? "").trim().toLowerCase();
  if (!/^whisper\.cpp\s+version:\s*\S+/imu.test(versionText)) {
    throw new Error("The staged Whisper executable did not report a valid whisper.cpp version.");
  }
  if (!/^MIT License$/imu.test(noticeText)) {
    throw new Error("The staged Whisper runtime is missing its MIT license notice.");
  }
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new Error("The staged Whisper runtime is missing a valid SHA-256 checksum.");
  }
  return {
    license: "MIT",
    whisperVersion: versionText.split(/\r?\n/u)[0].trim(),
    sha256: checksum,
  };
}

function auditWhisperServerBuild({ help, sha256 }) {
  const helpText = String(help ?? "");
  const checksum = String(sha256 ?? "").trim().toLowerCase();
  if (!/usage:\s+.*whisper-server(?:\.exe)?\s+\[options\]/iu.test(helpText)) {
    throw new Error("The staged persistent Whisper server did not report valid help output.");
  }
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new Error("The staged persistent Whisper server is missing a valid SHA-256 checksum.");
  }
  return { license: "MIT", sha256: checksum };
}

module.exports = { auditFfmpegBuild, auditWhisperBuild, auditWhisperServerBuild, resolveRuntimeBinary };
