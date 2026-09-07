const path = require("node:path");
const { Worker } = require("node:worker_threads");

/** Send file references only; decoding and large PCM arrays stay off the main loop. */
function runAudioJob(task, payload, environment) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "audio-job-worker.cjs"), {
      workerData: { kosmosAudioJob: true, task, payload, ...environment },
    });
    let result;
    let received = false;
    worker.once("message", message => {
      received = true;
      result = message;
    });
    worker.once("error", reject);
    // Wait for shutdown as well as the result, so the app's operation guard
    // remains active until all worker-owned processing has finished.
    worker.once("exit", code => {
      if (code !== 0 || !received) {
        reject(new Error("Audio processing stopped unexpectedly. Please try again."));
      } else {
        resolve(result);
      }
    });
  });
}

module.exports = { runAudioJob };
