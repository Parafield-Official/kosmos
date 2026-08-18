const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { strFromU8, unzipSync } = require("fflate");
const { waitForDrain, zipProjectFolder } = require("./share.cjs");

describe("project collaborator zip", () => {
  it("removes the losing backpressure listener after drain", async () => {
    const output = new EventEmitter();
    const pending = waitForDrain(output);
    expect(output.listenerCount("drain")).toBe(1);
    expect(output.listenerCount("error")).toBe(1);
    output.emit("drain");
    await pending;
    expect(output.listenerCount("drain")).toBe(0);
    expect(output.listenerCount("error")).toBe(0);
  });

  it("streams a portable zip with one project root and readable shared state", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "booth-share-test-"));
    const folder = path.join(temporary, "Shared Book.booth");
    const output = path.join(temporary, "Shared Book-collaborator.zip");
    try {
      await fs.mkdir(path.join(folder, "manuscript", "chapters"), { recursive: true });
      await fs.writeFile(
        path.join(folder, "project.json"),
        JSON.stringify({ schema: 1, chapter_notes: [{ body: "LEM-ster" }] }),
      );
      await fs.writeFile(path.join(folder, "manuscript", "chapters", "01.json"), "chapter");

      const result = await zipProjectFolder({
        folder,
        outputPath: output,
        relativePaths: ["project.json", "manuscript/chapters/01.json", "project.json"],
      });
      const archive = unzipSync(await fs.readFile(output));

      expect(result.fileCount).toBe(2);
      expect(Object.keys(archive)).toEqual([
        "Shared Book.booth/project.json",
        "Shared Book.booth/manuscript/chapters/01.json",
      ]);
      expect(JSON.parse(strFromU8(archive["Shared Book.booth/project.json"])).chapter_notes[0].body)
        .toBe("LEM-ster");
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("replaces an existing archive without leaving a partial file", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "booth-share-test-"));
    const folder = path.join(temporary, "Book.booth");
    const output = path.join(temporary, "book.zip");
    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, "project.json"), "{}");
      await fs.writeFile(output, "old archive");
      await zipProjectFolder({ folder, outputPath: output, relativePaths: ["project.json"] });
      const archive = unzipSync(await fs.readFile(output));
      expect(Object.keys(archive)).toHaveLength(1);
      expect((await fs.readdir(temporary)).filter((name) => name.includes(".part-")).length).toBe(0);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("rejects traversal written with Windows separators even on POSIX", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "booth-share-test-"));
    const folder = path.join(temporary, "Book.booth");
    const output = path.join(temporary, "book.zip");
    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, "project.json"), "{}");
      await expect(zipProjectFolder({
        folder,
        outputPath: output,
        relativePaths: ["..\\secret.txt"],
      })).rejects.toThrow(/unsafe project path/i);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("does not silently create an empty archive when all requested paths are directories", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "booth-share-test-"));
    const folder = path.join(temporary, "Book.booth");
    const output = path.join(temporary, "book.zip");
    try {
      await fs.mkdir(path.join(folder, "manuscript"), { recursive: true });
      await fs.writeFile(path.join(folder, "project.json"), "{}\n");
      await expect(zipProjectFolder({
        folder,
        outputPath: output,
        relativePaths: ["manuscript"],
      })).rejects.toThrow(/regular file|at least one/i);
      await expect(fs.access(output)).rejects.toBeTruthy();
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});
