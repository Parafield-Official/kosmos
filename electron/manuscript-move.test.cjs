const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { copyFileToDestination, moveFileToDestination } = require("./manuscript-move.cjs");

describe("copyFileToDestination", () => {
  it("copies a manuscript into the project and preserves the user's source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      const source = path.join(root, "draft.docx");
      const dest = path.join(root, "project", "manuscript", "draft.docx");
      await fs.writeFile(source, "chapter one");
      const result = await copyFileToDestination(source, dest);
      expect(result).toEqual({ ok: true, moved: false, copied: true });
      await expect(fs.readFile(dest, "utf8")).resolves.toBe("chapter one");
      await expect(fs.readFile(source, "utf8")).resolves.toBe("chapter one");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op when source and dest are the same path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      const source = path.join(root, "same.txt");
      await fs.writeFile(source, "keep");
      const result = await copyFileToDestination(source, source);
      expect(result).toEqual({ ok: true, moved: false, copied: false });
      await expect(fs.readFile(source, "utf8")).resolves.toBe("keep");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a directory source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      await expect(copyFileToDestination(root, path.join(root, "out.txt"))).rejects.toThrow(/regular file/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("atomically replaces an existing project copy without changing the source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-copy-"));
    try {
      const source = path.join(root, "draft.txt");
      const dest = path.join(root, "project", "draft.txt");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(source, "new manuscript");
      await fs.writeFile(dest, "old manuscript");
      await copyFileToDestination(source, dest);
      await expect(fs.readFile(source, "utf8")).resolves.toBe("new manuscript");
      await expect(fs.readFile(dest, "utf8")).resolves.toBe("new manuscript");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects relative paths and symbolic-link sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-copy-"));
    try {
      await expect(copyFileToDestination("draft.txt", path.join(root, "out.txt")))
        .rejects.toThrow(/absolute path/i);
      const real = path.join(root, "real.txt");
      const link = path.join(root, "link.txt");
      await fs.writeFile(real, "manuscript");
      await fs.symlink(real, link);
      await expect(copyFileToDestination(link, path.join(root, "out.txt")))
        .rejects.toThrow(/regular file/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the legacy export non-destructive for any remaining caller", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-copy-"));
    try {
      const source = path.join(root, "draft.txt");
      const dest = path.join(root, "project", "draft.txt");
      await fs.writeFile(source, "keep me");
      await moveFileToDestination(source, dest);
      await expect(fs.readFile(source, "utf8")).resolves.toBe("keep me");
      await expect(fs.readFile(dest, "utf8")).resolves.toBe("keep me");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
