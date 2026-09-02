const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { moveFileToDestination } = require("./manuscript-move.cjs");

describe("moveFileToDestination", () => {
  it("renames a file and leaves no source copy", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      const source = path.join(root, "draft.docx");
      const dest = path.join(root, "project", "manuscript", "draft.docx");
      await fs.writeFile(source, "chapter one");
      const result = await moveFileToDestination(source, dest);
      expect(result).toEqual({ ok: true, moved: true });
      await expect(fs.readFile(dest, "utf8")).resolves.toBe("chapter one");
      await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op when source and dest are the same path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      const source = path.join(root, "same.txt");
      await fs.writeFile(source, "keep");
      const result = await moveFileToDestination(source, source);
      expect(result).toEqual({ ok: true, moved: false });
      await expect(fs.readFile(source, "utf8")).resolves.toBe("keep");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a directory source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-move-"));
    try {
      await expect(moveFileToDestination(root, path.join(root, "out.txt"))).rejects.toThrow(/regular file/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
