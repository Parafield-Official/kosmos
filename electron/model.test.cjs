const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { MODEL, LIVE_MODEL, MODELS, modelStatus, modelStatusForFile } = require("./model.cjs");

describe("local Whisper model cache", () => {
  it("reports a cached model without contacting the network", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      await fs.writeFile(path.join(models, MODEL.fileName), Buffer.from("fixture"));
      const fixtureSha256 = crypto.createHash("sha256").update("fixture").digest("hex");
      await fs.writeFile(path.join(models, `${MODEL.fileName}.sha256`), `${fixtureSha256}\n`);

      const status = await modelStatus(folder, fixtureSha256);

      expect(status.available).toBe(true);
      expect(status.bytes).toBe(7);
      expect(status.path).toBe(path.join(models, MODEL.fileName));
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("upgrades a verified legacy cache without downloading it again", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      await fs.writeFile(path.join(models, MODEL.fileName), Buffer.from("fixture"));
      const fixtureSha256 = crypto.createHash("sha256").update("fixture").digest("hex");
      // Releases before this migration recorded a SHA-1 marker. The content,
      // not that old marker, is verified before the durable SHA-256 marker is
      // written.
      await fs.writeFile(path.join(models, `${MODEL.fileName}.sha1`), "legacy-marker\n");

      await expect(modelStatus(folder, fixtureSha256)).resolves.toMatchObject({ available: true, bytes: 7 });
      await expect(fs.readFile(path.join(models, `${MODEL.fileName}.sha256`), "utf8"))
        .resolves.toBe(`${fixtureSha256}\n`);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("detects a model changed after its checksum marker was written", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      const modelPath = path.join(models, MODEL.fileName);
      await fs.writeFile(modelPath, Buffer.from("fixture"));
      const fixtureSha256 = crypto.createHash("sha256").update("fixture").digest("hex");
      await fs.writeFile(`${modelPath}.sha256`, `${fixtureSha256}\n`);
      await fs.writeFile(modelPath, Buffer.from("tampered"));

      await expect(modelStatus(folder, fixtureSha256)).resolves.toMatchObject({ available: false });
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("verifies a model file directly without requiring a cache marker", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const modelPath = path.join(folder, MODEL.fileName);
      await fs.writeFile(modelPath, Buffer.from("fixture"));
      const fixtureSha256 = crypto.createHash("sha256").update("fixture").digest("hex");

      await expect(modelStatusForFile(modelPath, fixtureSha256)).resolves.toMatchObject({
        available: true,
        bytes: 7,
        path: modelPath,
        expectedSha256: fixtureSha256,
      });
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("does not trust a model with the wrong checksum", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const modelPath = path.join(folder, MODEL.fileName);
      await fs.writeFile(modelPath, Buffer.from("fixture"));

      await expect(modelStatusForFile(modelPath, MODEL.sha256)).resolves.toMatchObject({
        available: false,
        bytes: 7,
      });
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("lists Whisper and the live follow model for one-click install", () => {
    expect(MODELS.map((model) => model.fileName)).toEqual([
      "ggml-small.en.bin",
      "realtime_eou_120m-v1-f16.gguf",
    ]);
    expect(LIVE_MODEL.id).toBe("parakeet-eou-120m");
    expect(MODEL.sha256).toBe("c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d");
    expect(MODEL.url).toContain("/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/");
    expect(LIVE_MODEL.sha256).toBe("d1a2b12f12b8a096a57499c9111ed13b442a2b786e17a292c168be45088f0edc");
    expect(LIVE_MODEL.url).toContain("/resolve/7a4b05ad8cbc0f42bd73e1244aa00620acecab20/");
  });
});
