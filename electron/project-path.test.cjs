const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  assertProjectFolder,
  ensureProjectDirectory,
  projectAudioPath,
  projectAssetPath,
} = require("./project-path.cjs");

describe("project filesystem boundary", () => {
  it("accepts a regular project while rejecting traversal and empty assets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-path-"));
    try {
      await fs.writeFile(path.join(root, "project.json"), "{}\n");
      await expect(assertProjectFolder(root)).resolves.toBe(path.resolve(root));
      expect(projectAssetPath(root, "audio/take.wav")).toBe(path.join(root, "audio", "take.wav"));
      expect(projectAudioPath(root, "audio/take.wav")).toBe(path.join(root, "audio", "take.wav"));
      expect(() => projectAudioPath(root, "project.json")).toThrow(/audio folder/i);
      expect(() => projectAssetPath(root, "../private.wav")).toThrow(/leaves|parent components/i);
      expect(() => projectAssetPath(root, "")).toThrow(/non-empty|relative/i);
      await expect(ensureProjectDirectory(root, ".")).resolves.toBe(path.resolve(root));
      await expect(ensureProjectDirectory(root, "export/acx")).resolves.toBe(path.join(root, "export", "acx"));
      expect((await fs.lstat(path.join(root, "export", "acx"))).isDirectory()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked project root, project file, or nested asset component", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "booth-path-"));
    const root = path.join(parent, "book.booth");
    const outside = path.join(parent, "outside");
    const linkedRoot = path.join(parent, "linked.booth");
    try {
      await fs.mkdir(root);
      await fs.mkdir(outside);
      await fs.writeFile(path.join(root, "project.json"), "{}\n");
      await fs.symlink(root, linkedRoot, "dir");
      await expect(assertProjectFolder(linkedRoot)).rejects.toThrow(/symbolic link/i);

      await fs.rm(path.join(root, "project.json"));
      await fs.writeFile(path.join(outside, "project.json"), "{}\n");
      await fs.symlink(path.join(outside, "project.json"), path.join(root, "project.json"), "file");
      await expect(assertProjectFolder(root)).rejects.toThrow(/project\.json/i);

      await fs.rm(path.join(root, "project.json"));
      await fs.writeFile(path.join(root, "project.json"), "{}\n");
      await fs.symlink(outside, path.join(root, "audio"), "dir");
      expect(() => projectAssetPath(root, "audio/take.wav")).toThrow(/symbolic link/i);
      await expect(ensureProjectDirectory(root, "audio/new")).rejects.toThrow(/symbolic link/i);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});
