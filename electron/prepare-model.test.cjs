const path = require("node:path");
const { modelResourcePath, isModelReady } = require("../scripts/prepare-model.cjs");

describe("release Whisper model staging", () => {
  it("stages the official model under vendor/models", () => {
    const root = "/workspace/booth-desk";
    expect(modelResourcePath(root)).toBe(
      path.join(root, "vendor", "models", "ggml-small.en.bin"),
    );
  });

  it("only treats a verified model status as release-ready", () => {
    expect(isModelReady({ available: true, bytes: 123 })).toBe(true);
    expect(isModelReady({ available: false, bytes: 123 })).toBe(false);
    expect(isModelReady(null)).toBe(false);
  });
});
