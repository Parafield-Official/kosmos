const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Exercise the real export transaction and filesystem while stubbing codec
// work so a publication failure can be injected on every CI platform.
function loadExport(failPublish) {
  const filename = path.join(__dirname, "labs-audio.cjs");
  const localRequire = createRequire(filename);
  const wrappedFs = {
    ...fs,
    rename: async (from, to) => {
      if (failPublish && path.basename(from).startsWith(".acx-handoff-staging-")) {
        throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
      }
      return fs.rename(from, to);
    },
  };
  const helperContext = {
    require: (name) => name === "node:fs/promises" ? wrappedFs : localRequire(name),
    module: { exports: {} },
    process,
  };
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname, "file-utils.cjs"), "utf8"), helperContext);
  const context = {
    require: (name) => name === "electron"
      ? { app: {}, shell: { showItemInFolder() {} } }
      : name === "node:fs/promises"
        ? wrappedFs
        : name === "./file-utils.cjs"
          ? helperContext.module.exports
          : localRequire(name),
    module: { exports: {} },
    __dirname,
    process,
    Buffer,
    console,
  };
  vm.runInNewContext(`${fsSync.readFileSync(filename, "utf8")}
    decodeAudioPcm = async () => ({ pcm: Buffer.alloc(44100 * 4), sampleRate: 44100, channels: 1, format: "wav" });
    encodeDeliveryAudio = async (_input, output) => fs.writeFile(output, "new audio");
    loadCoreModule = name => name === "master" ? {
      resolvePreset: () => ({ label: "ACX" }),
      deliveryProfile: () => ({ sampleRate: 44100, headSeconds: 0.5, folderName: "acx", extension: "mp3" }),
      measurePcm: () => ({ traffic_light: "green" }),
    } : name === "export" ? {
      chapterFileName: () => "01_chapter.mp3",
      buildExportPlan: () => ({ readmeFiles: [] }),
      reportText: () => "report",
      revealTargetInExportPack: files => files[0],
    } : {};
  `, context, { filename });
  return context.module.exports.exportDeliveryPack;
}

describe("Labs export preservation", () => {
  it("preserves the previous export and project assets when publication fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kosmos-export-test-"));
    try {
      await fs.writeFile(path.join(root, "project.json"), "{\"chapters\":[]}");
      for (const dir of ["audio", "manuscript", "export/acx-handoff"]) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
      }
      await fs.writeFile(path.join(root, "audio/take.wav"), "original");
      await fs.writeFile(path.join(root, "manuscript/book.txt"), "manuscript");
      const previous = path.join(root, "export/acx-handoff/01_chapter.mp3");
      await fs.writeFile(previous, "previous master");
      const result = await loadExport(true)({
        folder: root,
        mode: "handoff",
        chapters: [{ id: "one", workingFile: "take.wav" }],
      });
      expect(result.ok).toBe(false);
      expect(await fs.readFile(previous, "utf8")).toBe("previous master");
      expect(await fs.readFile(path.join(root, "audio/take.wav"), "utf8")).toBe("original");
      expect(await fs.readFile(path.join(root, "manuscript/book.txt"), "utf8")).toBe("manuscript");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
