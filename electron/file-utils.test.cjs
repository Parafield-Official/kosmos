const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  assetStamp,
  copyFileAtomic,
  copyFileUnique,
  nextAvailablePath,
  replaceDirectory,
  writeJsonAtomic,
} = require("./file-utils.cjs");

describe("desktop file safety helpers", () => {
  it("keeps concurrent JSON saves parseable and cleans temporary files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-file-utils-"));
    const destination = path.join(root, "state.json");
    try {
      await Promise.all(Array.from({ length: 24 }, (_value, index) =>
        writeJsonAtomic(destination, { revision: index, ok: true }),
      ));
      const parsed = JSON.parse(await fs.readFile(destination, "utf8"));
      expect(parsed.ok).toBe(true);
      expect(Number.isInteger(parsed.revision)).toBe(true);
      expect((await fs.readdir(root)).filter((name) => name.includes(".tmp-")).length).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("avoids collisions for imported or generated assets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-file-utils-"));
    try {
      const first = path.join(root, "chapter.wav");
      await fs.writeFile(first, "one");
      const second = await nextAvailablePath(first);
      expect(second).toBe(path.join(root, "chapter-2.wav"));
      expect(assetStamp(new Date("2026-08-18T02:03:04.567Z"))).toMatch(
        /^20260818020304567-[0-9a-f]{8}$/,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reserves distinct names when copies finish concurrently", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-file-utils-"));
    try {
      const source = path.join(root, "source.wav");
      await fs.writeFile(source, "audio");
      const requested = path.join(root, "take.wav");
      const destinations = await Promise.all(Array.from({ length: 8 }, () =>
        copyFileUnique(source, requested),
      ));
      expect(new Set(destinations).size).toBe(8);
      expect((await Promise.all(destinations.map((file) => fs.readFile(file, "utf8"))))
        .every((value) => value === "audio")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("replaces a destination symlink without writing through to its target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-file-utils-"));
    try {
      const source = path.join(root, "source.txt");
      const outside = path.join(root, "outside.txt");
      const destination = path.join(root, "destination.txt");
      await fs.writeFile(source, "inside");
      await fs.writeFile(outside, "outside");
      await fs.symlink(outside, destination, "file");
      await copyFileAtomic(source, destination);
      expect(await fs.readFile(outside, "utf8")).toBe("outside");
      expect(await fs.readFile(destination, "utf8")).toBe("inside");
      expect((await fs.lstat(destination)).isSymbolicLink()).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("replaces an export directory without destroying the previous result on failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "booth-file-utils-"));
    const destination = path.join(root, "acx");
    const staging = path.join(root, "staging");
    try {
      await fs.mkdir(destination);
      await fs.writeFile(path.join(destination, "REPORT.txt"), "old");
      await fs.mkdir(staging);
      await fs.writeFile(path.join(staging, "REPORT.txt"), "new");
      await replaceDirectory(staging, destination);
      expect(await fs.readFile(path.join(destination, "REPORT.txt"), "utf8")).toBe("new");

      const missingStaging = path.join(root, "missing-staging");
      await expect(replaceDirectory(missingStaging, destination)).rejects.toBeTruthy();
      expect(await fs.readFile(path.join(destination, "REPORT.txt"), "utf8")).toBe("new");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
