#!/usr/bin/env node

const path = require("node:path");
const { MODEL, modelStatus, downloadModel } = require("../electron/model.cjs");

function modelResourcePath(root = path.resolve(__dirname, "..")) {
  return path.join(root, "vendor", "models", MODEL.fileName);
}

function isModelReady(status) {
  return Boolean(status?.available && Number(status.bytes) > 0);
}

async function prepareModel(root = path.resolve(__dirname, "..")) {
  const vendorRoot = path.join(root, "vendor");
  const destination = modelResourcePath(root);
  const current = await modelStatus(vendorRoot);
  if (isModelReady(current)) {
    return current;
  }

  process.stdout.write(`Preparing bundled Whisper model ${MODEL.id} (${destination})\n`);
  const installed = await downloadModel(vendorRoot, ({ received, total, fraction }) => {
    if (total > 0) {
      process.stdout.write(`\rDownloading Whisper model: ${Math.round(fraction * 100)}% (${received}/${total} bytes)`);
    } else {
      process.stdout.write(`\rDownloading Whisper model: ${received} bytes`);
    }
  });
  process.stdout.write("\n");
  if (!isModelReady(installed)) {
    throw new Error(`Bundled Whisper model failed verification at ${destination}.`);
  }
  return installed;
}

if (require.main === module) {
  prepareModel().then((status) => {
    process.stdout.write(`Bundled Whisper model ready: ${status.bytes} bytes, SHA-1 ${status.expectedSha1}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { modelResourcePath, isModelReady, prepareModel };
