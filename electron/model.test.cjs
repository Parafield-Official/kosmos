const fs = require("node:fs/promises");
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

      const status = await modelStatus(folder);

      expect(status.available).toBe(true);
      expect(status.bytes).toBe(7);
      expect(status.path).toBe(path.join(models, MODEL.fileName));
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

