const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");
const { extractArchive, safeEntryName } = require("./unzip.cjs");

async function workspace() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "kosmos-unzip-"));
}

function writeZip(folder, files, options = {}) {
  const archivePath = path.join(folder, "pack.zip");
  const payload = {};
  for (const [name, contents] of Object.entries(files)) {
    payload[name] = typeof contents === "string" ? strToU8(contents) : contents;
  }
  fs.writeFileSync(archivePath, Buffer.from(zipSync(payload, options)));
  return archivePath;
}

describe("collaborator archive extraction", () => {
  it("writes every file it was given, folders and all", async () => {
    const folder = await workspace();
    const archivePath = writeZip(folder, {
      "Book/project.json": "{\"id\":\"p1\"}",
      "Book/text/01.json": "{\"text\":\"hello\"}",
      "Book/audio/01.wav": "not really audio",
    });
    const destination = path.join(folder, "out");
    const result = await extractArchive({ archivePath, destination });
    expect(result.entries.map((entry) => entry.name).sort()).toEqual([
      path.join("Book", "audio", "01.wav"),
      path.join("Book", "project.json"),
      path.join("Book", "text", "01.json"),
    ]);
    expect(await fsp.readFile(path.join(destination, "Book", "project.json"), "utf8"))
      .toBe("{\"id\":\"p1\"}");
  });

  it("reads a deflated archive as well as a stored one", async () => {
    const folder = await workspace();
    const body = "the pier at dawn ".repeat(500);
    const archivePath = writeZip(folder, { "Book/text/01.json": body }, { level: 6 });
    const destination = path.join(folder, "out");
    await extractArchive({ archivePath, destination });
    expect(await fsp.readFile(path.join(destination, "Book", "text", "01.json"), "utf8")).toBe(body);
  });

  it("restores a large file byte for byte", async () => {
    const folder = await workspace();
    const bytes = Buffer.alloc(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const archivePath = writeZip(folder, { "Book/audio/01.wav": new Uint8Array(bytes) });
    const destination = path.join(folder, "out");
    await extractArchive({ archivePath, destination });
    const written = await fsp.readFile(path.join(destination, "Book", "audio", "01.wav"));
    expect(written.length).toBe(bytes.length);
    expect(Buffer.compare(written, bytes)).toBe(0);
  });

  it("refuses a path that climbs out of the destination", async () => {
    const folder = await workspace();
    const archivePath = writeZip(folder, { "../escape.txt": "nope" });
    const destination = path.join(folder, "out");
    await expect(extractArchive({ archivePath, destination })).rejects.toThrow(/unsafe path/i);
    await expect(fsp.access(path.join(folder, "escape.txt"))).rejects.toThrow();
  });

  it("refuses an absolute path", async () => {
    const folder = await workspace();
    const archivePath = writeZip(folder, { "/etc/hosts": "nope" });
    const destination = path.join(folder, "out");
    await expect(extractArchive({ archivePath, destination })).rejects.toThrow(/unsafe path/i);
  });

  it("leaves nothing behind when it refuses an archive", async () => {
    const folder = await workspace();
    const archivePath = writeZip(folder, { "Book/ok.txt": "fine", "../escape.txt": "nope" });
    const destination = path.join(folder, "out");
    await expect(extractArchive({ archivePath, destination })).rejects.toThrow();
    await expect(fsp.access(destination)).rejects.toThrow();
  });

  it("refuses an archive with more files than a book should have", async () => {
    const folder = await workspace();
    const files = {};
    for (let index = 0; index < 12; index += 1) {
      files[`Book/text/${index}.json`] = "{}";
    }
    const archivePath = writeZip(folder, files);
    const destination = path.join(folder, "out");
    await expect(extractArchive({ archivePath, destination, maxEntries: 5 }))
      .rejects.toThrow(/more than 5 files/i);
  });

  it("refuses an archive that unpacks to more than the caller allows", async () => {
    const folder = await workspace();
    const archivePath = writeZip(folder, { "Book/audio/01.wav": "x".repeat(4096) });
    const destination = path.join(folder, "out");
    await expect(extractArchive({ archivePath, destination, maxBytes: 1024 }))
      .rejects.toThrow(/more than Kosmos will accept/i);
  });

  it("refuses an archive with nothing in it", async () => {
    const folder = await workspace();
    const archivePath = path.join(folder, "empty.zip");
    fs.writeFileSync(archivePath, Buffer.from(zipSync({})));
    await expect(extractArchive({ archivePath, destination: path.join(folder, "out") }))
      .rejects.toThrow(/no files/i);
  });

  it("insists on absolute paths so it cannot be pointed at a relative guess", async () => {
    await expect(extractArchive({ archivePath: "pack.zip", destination: "/tmp/out" }))
      .rejects.toThrow(/absolute/i);
  });
});

describe("archive entry names", () => {
  it("keeps a plain nested name", () => {
    expect(safeEntryName("Book/audio/01.wav")).toBe(path.join("Book", "audio", "01.wav"));
  });

  it("normalizes Windows separators and drops redundant parts", () => {
    expect(safeEntryName("Book\\audio\\.\\01.wav")).toBe(path.join("Book", "audio", "01.wav"));
  });

  it("rejects parent traversal, drive letters, and null bytes", () => {
    expect(() => safeEntryName("../x")).toThrow(/unsafe/i);
    expect(() => safeEntryName("a/../../x")).toThrow(/unsafe/i);
    expect(() => safeEntryName("C:/x")).toThrow(/unsafe/i);
    expect(() => safeEntryName("a\0b")).toThrow(/unsafe/i);
    expect(() => safeEntryName("")).toThrow();
  });
});
