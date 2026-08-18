const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { MODEL, modelStatus } = require("./model.cjs");

describe("local Whisper model cache", () => {
  it("reports a cached model without contacting the network", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      await fs.writeFile(path.join(models, MODEL.fileName), Buffer.from("fixture"));
      const fixtureSha1 = crypto.createHash("sha1").update("fixture").digest("hex");
      await fs.writeFile(path.join(models, `${MODEL.fileName}.sha1`), `${fixtureSha1}\n`);

      const status = await modelStatus(folder, fixtureSha1);

      expect(status.available).toBe(true);
      expect(status.bytes).toBe(7);
      expect(status.path).toBe(path.join(models, MODEL.fileName));
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("does not trust an unmarked or mismarked cache", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booth-model-test-"));
    try {
      const models = path.join(folder, "models");
      await fs.mkdir(models, { recursive: true });
      await fs.writeFile(path.join(models, MODEL.fileName), Buffer.from("fixture"));

      await expect(modelStatus(folder)).resolves.toMatchObject({ available: false, bytes: 7 });
      await fs.writeFile(path.join(models, `${MODEL.fileName}.sha1`), "wrong\n");
      await expect(modelStatus(folder)).resolves.toMatchObject({ available: false, bytes: 7 });
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
      const fixtureSha1 = crypto.createHash("sha1").update("fixture").digest("hex");
      await fs.writeFile(`${modelPath}.sha1`, `${fixtureSha1}\n`);
      await fs.writeFile(modelPath, Buffer.from("tampered"));

      await expect(modelStatus(folder, fixtureSha1)).resolves.toMatchObject({ available: false });
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});
