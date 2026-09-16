const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ensureWorkingAudioDirectory,
  isWorkingAudioFile,
  migrateLegacyWorkingAudio,
  workingAudioPath,
} = require("./working-audio.cjs");

describe("working-audio storage", () => {
  it("moves legacy working audio out of the user-facing audio folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-working-audio-"));
    try {
      await fs.writeFile(path.join(root, "project.json"), "{}\n");
      await fs.mkdir(path.join(root, "audio"));
      await fs.writeFile(path.join(root, "audio", "chapter-original.wav"), "original");
      await fs.writeFile(path.join(root, "audio", "chapter-working.wav"), "working");
      await fs.writeFile(path.join(root, "audio", "chapter-mastered.wav"), "mastered");

      const moved = await migrateLegacyWorkingAudio(root, "chapter-working.wav");

      expect(moved).toBe(workingAudioPath(root, "chapter-working.wav"));
      expect(await fs.readFile(moved, "utf8")).toBe("working");
      await expect(fs.access(path.join(root, "audio", "chapter-working.wav"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readdir(path.join(root, "audio"))).toEqual([
        "chapter-mastered.wav",
        "chapter-original.wav",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps new working audio in hidden project metadata, not audio", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-working-audio-"));
    try {
      await fs.writeFile(path.join(root, "project.json"), "{}\n");

      const directory = await ensureWorkingAudioDirectory(root);

      expect(directory).toBe(path.join(root, ".kosmos", "working"));
      expect(isWorkingAudioFile("chapter-working.wav")).toBe(true);
      expect(isWorkingAudioFile("chapter-original.wav")).toBe(false);
      await expect(fs.access(path.join(root, "audio"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
