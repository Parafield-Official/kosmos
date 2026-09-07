const path = require("node:path");
const { runAudioJob } = require("./audio-job.cjs");

const environment = { appPath: path.join(__dirname, ".."), isPackaged: false };

describe("background audio jobs", () => {
  it("returns validation failures from the worker instead of leaving mastering pending", async () => {
    const result = await runAudioJob("master", {}, environment);
    expect(result).toEqual({ ok: false, reason: "A working file is required to master." });
  });

  it("returns measurement failures without taking down the main process", async () => {
    const result = await runAudioJob("measure", {}, environment);
    expect(result).toEqual({ ok: false, reason: "A chapter audio file is required." });
  });

  it("refuses unsupported worker operations", async () => {
    const result = await runAudioJob("unknown", {}, environment);
    expect(result).toEqual({ ok: false, reason: "Unknown audio job." });
  });
});
