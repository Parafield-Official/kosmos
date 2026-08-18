const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { strFromU8, unzipSync } = require("fflate");
const { zipProjectFolder } = require("./share.cjs");

describe("project collaborator zip", () => {
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
        relativePaths: ["project.json", "manuscript/chapters/01.json"],
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
});
