#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { auditFfmpegBuild } = require("../electron/runtime.cjs");

const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "vendor", "bin");
const extension = process.platform === "win32" ? ".exe" : "";
const ffmpegPath = path.join(binDir, `ffmpeg${extension}`);
const ffprobePath = path.join(binDir, `ffprobe${extension}`);
const noticesPath = path.join(binDir, "FFMPEG_LICENSE.txt");

function version(executable) {
  const result = spawnSync(executable, ["-version"], { encoding: "utf8" });
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

const audit = auditFfmpegBuild({
  ffmpegVersion: version(ffmpegPath),
  ffprobeVersion: version(ffprobePath),
  notices: fs.readFileSync(noticesPath, "utf8"),
});
const outputPath = path.join(binDir, "FFMPEG_AUDIT.json");
fs.writeFileSync(outputPath, `${JSON.stringify({ ...audit, auditedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
process.stdout.write(`Audited ${audit.ffmpegVersion}; ${audit.license}; GPL=${audit.gplEnabled}; non-free=${audit.nonfreeEnabled}\n`);
