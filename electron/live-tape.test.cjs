const { createLiveTape } = require("./live-tape.cjs");

describe("main-process booth tape", () => {
  it("keeps streamed PCM so Review can transcribe after the page closes", () => {
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    const second = new Float32Array(16_000);
    second[100] = 0.4;
    tape.append(second);
    expect(tape.seconds()).toBeCloseTo(1, 5);
    expect(tape.shouldKeep()).toBe(true);
    const wav = tape.encode();
    expect(Buffer.from(wav.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    expect(wav.length).toBeGreaterThan(44);
  });

  it("drops a tap that is too short to be a read", () => {
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    tape.append(new Float32Array(200));
    expect(tape.shouldKeep()).toBe(false);
  });

  it("survives a page close by keeping PCM after reset of a second session", () => {
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    tape.append(new Float32Array(16_000).fill(0.1));
    const first = tape.take();
    expect(first.chapterId).toBe("ch01");
    expect(first.samples.length).toBe(16_000);
    tape.begin({ chapterId: "ch01" });
    expect(tape.seconds()).toBe(0);
  });

  it("writes a WAV Review can open", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    tape.append(new Float32Array(16_000).fill(0.05));
    const wav = tape.encode();
    const file = path.join(os.tmpdir(), `kosmos-live-tape-${Date.now()}.wav`);
    fs.writeFileSync(file, Buffer.from(wav));
    const onDisk = fs.readFileSync(file);
    expect(onDisk.length).toBe(wav.length);
    expect(Buffer.from(onDisk.subarray(8, 12)).toString("ascii")).toBe("WAVE");
    fs.unlinkSync(file);
  });
});
