#!/usr/bin/env node

const path = require("node:path");
const { MODEL, MODELS, modelStatus, modelStatusForFile, downloadModel } = require("../electron/model.cjs");

function modelResourcePath(root = path.resolve(__dirname, "..")) {
  return path.join(root, "vendor", "models", MODEL.fileName);
}

function modelResourcePaths(root = path.resolve(__dirname, "..")) {
  return MODELS.map((model) => path.join(root, "vendor", "models", model.fileName));
}

function isModelReady(status) {
  return Boolean(status?.available && Number(status.bytes) > 0);
}

async function prepareModel(root = path.resolve(__dirname, "..")) {
  const vendorRoot = path.join(root, "vendor");
  const missing = [];
  for (const spec of MODELS) {
    const destination = path.join(vendorRoot, "models", spec.fileName);
    const expected = spec.sha256;
    const current = spec === MODEL
      ? await modelStatus(vendorRoot)
      : await modelStatusForFile(destination, expected);
    if (!isModelReady(current)) {
      missing.push(spec.id);
    }
  }
  if (missing.length === 0) {
    return modelStatus(vendorRoot);
  }

  process.stdout.write(`Preparing local development speech models (${missing.join(", ")})\n`);
  const installed = await downloadModel(vendorRoot, ({ received, total, fraction }) => {
    if (total > 0) {
      process.stdout.write(`\rDownloading speech models: ${Math.round(fraction * 100)}% (${received}/${total} bytes)`);
    } else {
      process.stdout.write(`\rDownloading speech models: ${received} bytes`);
    }
  });
  process.stdout.write("\n");
  for (const spec of MODELS) {
    const destination = path.join(vendorRoot, "models", spec.fileName);
    const expected = spec.sha256;
    const status = spec === MODEL
      ? installed
      : await modelStatusForFile(destination, expected);
    if (!isModelReady(status)) {
      throw new Error(`Local development speech model ${spec.id} failed verification at ${destination}.`);
    }
  }
  return installed;
}

if (require.main === module) {
  prepareModel().then((status) => {
    process.stdout.write(`Local development speech models ready. Whisper ${status.bytes} bytes, SHA-256 ${status.expectedSha256}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { modelResourcePath, modelResourcePaths, isModelReady, prepareModel };
