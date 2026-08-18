#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { auditFfmpegBuild, auditWhisperBuild } = require("../electron/runtime.cjs");

const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "vendor", "bin");
const extension = process.platform === "win32" ? ".exe" : "";
const ffmpegPath = path.join(binDir, `ffmpeg${extension}`);
const ffprobePath = path.join(binDir, `ffprobe${extension}`);
const noticesPath = path.join(binDir, "FFMPEG_LICENSE.txt");
const whisperPath = path.join(binDir, `whisper-cli${extension}`);
const whisperNoticesPath = path.join(binDir, "WHISPER_LICENSE.txt");

function version(executable, args = ["-version"]) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not execute staged runtime ${executable}: ${result.error?.message ?? `exit ${result.status}`}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

for (const candidate of [ffmpegPath, ffprobePath, noticesPath]) {
  if (!fs.existsSync(candidate)) {
    throw new Error(`Missing release runtime asset: ${path.relative(root, candidate)}`);
  }
}

for (const candidate of [whisperPath, whisperNoticesPath]) {
  if (!fs.existsSync(candidate)) {
    throw new Error(`Missing release speech asset: ${path.relative(root, candidate)}`);
  }
}

const audit = auditFfmpegBuild({
  ffmpegVersion: version(ffmpegPath),
  ffprobeVersion: version(ffprobePath),
  notices: fs.readFileSync(noticesPath, "utf8"),
});
const outputPath = path.join(binDir, "FFMPEG_AUDIT.json");
fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
const whisperBytes = fs.readFileSync(whisperPath);
const whisperAudit = auditWhisperBuild({
  whisperVersion: version(whisperPath, ["--version"]),
  notices: fs.readFileSync(whisperNoticesPath, "utf8"),
  sha256: crypto.createHash("sha256").update(whisperBytes).digest("hex"),
});
fs.writeFileSync(
  path.join(binDir, "WHISPER_AUDIT.json"),
  `${JSON.stringify({ ...whisperAudit, sourceCommit: "4834a2327d008ace3ec5a9ed00f51454bcabbc1c" }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Audited ${audit.ffmpegVersion}; ${audit.license}; GPL=${audit.gplEnabled}; non-free=${audit.nonfreeEnabled}\n`);
process.stdout.write(`Audited ${whisperAudit.whisperVersion}; ${whisperAudit.license}; ${whisperAudit.sha256}\n`);
