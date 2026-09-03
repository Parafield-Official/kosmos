const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");
const { writeFileAtomic } = require("./file-utils.cjs");

const MODEL = {
  id: "small.en",
  fileName: "ggml-small.en.bin",
  // A revision-pinned upstream file prevents a moving `main` branch from
  // silently changing what an already released app downloads.
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/ggml-small.en.bin",
  // Hugging Face's immutable LFS object digest. SHA-256 is verified before a
  // model becomes available to the local speech engine.
  sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
};

const LIVE_MODEL = {
  id: "parakeet-eou-120m",
  fileName: "realtime_eou_120m-v1-f16.gguf",
  url: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/7a4b05ad8cbc0f42bd73e1244aa00620acecab20/realtime_eou_120m-v1-f16.gguf",
  sha256: "d1a2b12f12b8a096a57499c9111ed13b442a2b786e17a292c168be45088f0edc",
};

const MODELS = [MODEL, LIVE_MODEL];

const MODEL_MARKER_SUFFIX = ".sha256";
const MODEL_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_MODEL_BYTES = 1_000_000_000;
const inFlightDownloads = new Map();
const verifiedModelFiles = new Map();

async function modelStatus(userDataPath, expectedSha256 = MODEL.sha256) {
  const modelPath = path.join(userDataPath, "models", MODEL.fileName);
  const markerPath = `${modelPath}${MODEL_MARKER_SUFFIX}`;
  let marker = "";
  try {
    const markerStat = await fsp.lstat(markerPath);
    if (!markerStat.isFile()) {
      throw new Error("Whisper model checksum marker is not a regular file");
    }
    marker = (await fsp.readFile(markerPath, "utf8")).trim();
  } catch {
    // The model content is still verified below. A valid pre-SHA-256 cache is
    // upgraded in place so users do not need to download the same model again.
  }
  const status = await modelStatusForFile(modelPath, expectedSha256);
  if (!status.available) {
    return status;
  }
  if (marker !== expectedSha256) {
    // This marker is only a fast, human-readable record. The SHA-256 above is
    // authoritative, so a transient marker-write failure must not discard a
    // verified local model.
    await writeFileAtomic(markerPath, `${expectedSha256}\n`, "utf8").catch(() => undefined);
  }
  return status;
}

/**
 * Verify a model file without requiring a sidecar marker. This is used for the
 * user's persistent cache, developer fixtures, and older installed builds.
 */
async function modelStatusForFile(modelPath, expectedSha256 = MODEL.sha256) {
  try {
    const stat = await fsp.lstat(modelPath);
    if (!stat.isFile()) {
      throw new Error("Whisper model is not a regular file");
    }
    const cacheKey = `${path.resolve(modelPath)}:${stat.size}:${stat.mtimeMs}:${expectedSha256}`;
    const cached = verifiedModelFiles.get(cacheKey);
    if (cached) {
      return cached;
    }
    const digest = stat.size > 0 ? await fileDigest(modelPath) : "";
    const status = {
      id: MODEL.id,
      path: modelPath,
      available: stat.size > 0 && digest === expectedSha256,
      bytes: stat.size,
      expectedSha256,
    };
    if (status.available) {
      verifiedModelFiles.set(cacheKey, status);
    }
    return status;
  } catch {
    return {
      id: MODEL.id,
      path: modelPath,
      available: false,
      bytes: 0,
      expectedSha256,
    };
  }
}

async function downloadModel(userDataPath, onProgress) {
  for (const spec of MODELS) {
    const destination = path.join(userDataPath, "models", spec.fileName);
    const active = inFlightDownloads.get(destination);
    if (active) {
      await active;
      continue;
    }
    const task = downloadVerifiedModel(spec, destination, onProgress);
    inFlightDownloads.set(destination, task);
    try {
      await task;
    } finally {
      inFlightDownloads.delete(destination);
    }
  }
  return modelStatus(userDataPath);
}

async function downloadVerifiedModel(spec, destination, onProgress) {
  const expected = spec.sha256;
  if (!/^[a-f0-9]{64}$/.test(expected ?? "")) {
    throw new Error(`Speech model ${spec.id} is missing a valid SHA-256 checksum.`);
  }
  const existing = await modelStatusForFile(destination, expected);
  if (existing.available) {
    await writeFileAtomic(`${destination}${MODEL_MARKER_SUFFIX}`, `${expected}\n`, "utf8");
    return existing;
  }
  const partial = `${destination}.part`;
  const marker = `${destination}${MODEL_MARKER_SUFFIX}`;
  const destinationBackup = `${destination}.backup-${process.pid}-${crypto.randomUUID()}`;
  const markerBackup = `${marker}.backup-${process.pid}-${crypto.randomUUID()}`;
  let movedDestination = false;
  let movedMarker = false;
  let installedDestination = false;
  let preserveDestinationBackup = false;
  let preserveMarkerBackup = false;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.rm(partial, { force: true });

  try {
    await download(spec.url, partial, onProgress);
    const digest = await fileDigest(partial);
    if (digest !== expected) {
      throw new Error("The speech model checksum did not match; the partial download was removed.");
    }
    // Keep both old files aside until the replacement and its marker are in
    // place. A disk-full error while writing the marker must not turn a
    // previously usable model into an unavailable cache.
    try {
      await fsp.rename(destination, destinationBackup);
      movedDestination = true;
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
    try {
      await fsp.rename(marker, markerBackup);
      movedMarker = true;
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
    await fsp.rename(partial, destination);
    installedDestination = true;
    await writeFileAtomic(marker, `${digest}\n`, "utf8");
  } catch (error) {
    const recoveryErrors = [];
    if (installedDestination) {
      try {
        await fsp.rm(destination, { force: true });
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }
    if (movedDestination) {
      try {
        await fsp.rename(destinationBackup, destination);
      } catch (recoveryError) {
        preserveDestinationBackup = true;
        recoveryErrors.push(recoveryError);
      }
    }
    if (movedMarker) {
      try {
        await fsp.rename(markerBackup, marker);
      } catch (recoveryError) {
        preserveMarkerBackup = true;
        recoveryErrors.push(recoveryError);
      }
    }
    // Cleanup is best-effort here: if the filesystem is already unhealthy,
    // preserve the original verification/recovery error rather than masking
    // it with a second unlink failure.
    await fsp.rm(partial, { force: true }).catch((cleanupError) => {
      recoveryErrors.push(cleanupError);
    });
    if (recoveryErrors.length > 0) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        "Whisper model installation failed; recovery or cleanup errors occurred and backup files were preserved.",
      );
    }
    throw error;
  } finally {
    if (!preserveDestinationBackup) {
      await fsp.rm(destinationBackup, { force: true }).catch(() => undefined);
    }
    if (!preserveMarkerBackup) {
      await fsp.rm(markerBackup, { force: true }).catch(() => undefined);
    }
  }
}

function proofModelCandidates({ userDataPath, resourcesPath, appPath, cwd }) {
  return [
    userDataPath && path.join(userDataPath, "models", MODEL.fileName),
    resourcesPath && path.join(resourcesPath, "models", MODEL.fileName),
    appPath && path.join(appPath, "models", MODEL.fileName),
    appPath && path.join(appPath, "vendor", "models", MODEL.fileName),
    cwd && path.join(cwd, "vendor", "models", MODEL.fileName),
  ].filter(Boolean);
}

/** Same readiness check the production app uses before proof can run. */
async function proofModelStatus({ userDataPath, resourcesPath, appPath, cwd = process.cwd() }) {
  const cached = await modelStatus(userDataPath);
  if (cached.available) {
    return cached;
  }

  for (const candidate of proofModelCandidates({ userDataPath, resourcesPath, appPath, cwd })) {
    const status = await modelStatusForFile(candidate);
    if (!status.available) {
      continue;
    }
    if (userDataPath && path.resolve(candidate) === path.resolve(path.join(userDataPath, "models", MODEL.fileName))) {
      return status;
    }
    return { ...status, bundled: true };
  }

  return cached;
}

/** Install only the Whisper proof model used by onboarding and chapter proof. */
async function downloadProofModel(userDataPath, onProgress) {
  const destination = path.join(userDataPath, "models", MODEL.fileName);
  const active = inFlightDownloads.get(destination);
  if (active) {
    await active;
  } else {
    const task = downloadVerifiedModel(MODEL, destination, onProgress);
    inFlightDownloads.set(destination, task);
    try {
      await task;
    } finally {
      inFlightDownloads.delete(destination);
    }
  }
  const marked = await modelStatus(userDataPath);
  if (marked.available) {
    return marked;
  }
  return modelStatusForFile(destination);
}

function fileDigest(filePath, algorithm = "sha256") {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function download(url, destination, onProgress, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects while downloading the local Whisper model."));
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.reject(new Error("Invalid model download URL."));
  }
  if (target.protocol !== "https:") {
    return Promise.reject(new Error("Model downloads must use HTTPS."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const request = https.get(target, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, target).toString();
        void download(redirected, destination, onProgress, redirectCount + 1).then(
          (value) => { if (!settled) { settled = true; resolve(value); } },
          fail,
        );
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        fail(new Error(`Model download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const total = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(total) && total > MAX_MODEL_BYTES) {
        response.resume();
        fail(new Error("Whisper model download is larger than the supported cache limit."));
        return;
      }
      let received = 0;
      const file = fs.createWriteStream(destination, { flags: "wx" });
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_MODEL_BYTES) {
          closeWithError(new Error("Whisper model download exceeded the supported cache limit."));
          return;
        }
        try {
          onProgress?.({ received, total, fraction: total > 0 ? received / total : 0 });
        } catch (error) {
          response.destroy(error);
        }
      });
      const closeWithError = (error) => {
        file.destroy();
        response.destroy();
        fail(error);
      };
      response.on("error", closeWithError);
      file.on("error", closeWithError);
      file.on("finish", () => file.close((error) => {
        if (error) {
          fail(error);
          return;
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      }));
      response.pipe(file);
    });
    request.setTimeout(MODEL_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error("Whisper model download timed out."));
    });
    request.on("error", fail);
  });
}

module.exports = {
  MODEL,
  LIVE_MODEL,
  MODELS,
  modelStatus,
  modelStatusForFile,
  proofModelStatus,
  downloadProofModel,
  downloadModel,
};
