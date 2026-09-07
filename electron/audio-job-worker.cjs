const { parentPort, workerData } = require("node:worker_threads");

async function run() {
  if (!parentPort || !workerData?.kosmosAudioJob) throw new Error("Audio worker context is required.");
  const audio = require("./labs-audio.cjs");
  const handler = workerData.task === "master"
    ? audio.masterWorkingFile
    : workerData.task === "measure" ? audio.measureChapterAudio : undefined;
  if (!handler) throw new Error("Unknown audio job.");
  return handler(workerData.payload);
}

run().then(
  result => parentPort.postMessage(result),
  error => parentPort.postMessage({ ok: false, reason: error.message || String(error) }),
).finally(() => parentPort.close());
