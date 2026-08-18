const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");

const MODEL = {
  id: "small.en",
  fileName: "ggml-small.en.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
  // Official whisper.cpp model table checksum (SHA-1, used only to detect a
  // partial or altered download before the model is loaded).
  sha1: "db8a495a91d927739e50b3fc1cc4c6b8f6c2d022",
};

async function modelStatus(userDataPath) {
  const modelPath = path.join(userDataPath, "models", MODEL.fileName);
  try {
    const stat = await fsp.stat(modelPath);
    return {
      id: MODEL.id,
      path: modelPath,
      available: stat.size > 0,
      bytes: stat.size,
      expectedSha1: MODEL.sha1,
    };
  } catch {
    return {
      id: MODEL.id,
      path: modelPath,
      available: false,
      bytes: 0,
      expectedSha1: MODEL.sha1,
    };
  }
}

async function downloadModel(userDataPath, onProgress) {
  const destination = path.join(userDataPath, "models", MODEL.fileName);
  const partial = `${destination}.part`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.rm(partial, { force: true });

  await download(MODEL.url, partial, onProgress);
  const digest = await sha1(partial);
  if (digest !== MODEL.sha1) {
    await fsp.rm(partial, { force: true });
    throw new Error("The Whisper model checksum did not match; the partial download was removed.");
  }
  await fsp.rename(partial, destination);
  return modelStatus(userDataPath);
}

function download(url, destination, onProgress, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects while downloading the local Whisper model."));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        void download(response.headers.location, destination, onProgress, redirectCount + 1)
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Model download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const total = Number(response.headers["content-length"] ?? 0);
      let received = 0;
      const file = fs.createWriteStream(destination, { flags: "wx" });
      response.on("data", (chunk) => {
        received += chunk.length;
        onProgress?.({ received, total, fraction: total > 0 ? received / total : 0 });
      });
      response.on("error", (error) => {
        file.destroy();
        reject(error);
      });
      file.on("error", reject);
      file.on("finish", () => file.close(() => resolve()));
      response.pipe(file);
    });
    request.on("error", reject);
  });
}

function sha1(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

module.exports = { MODEL, modelStatus, downloadModel };

