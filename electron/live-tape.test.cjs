const { createLiveTape, normalizeLiveTapePcm } = require("./live-tape.cjs");
const { assertRecorderPcmBounds } = require("./recording-wav.cjs");

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

  it("rewinds an active tape before replacement audio is appended", () => {
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    tape.append(Float32Array.from({ length: 32_000 }, (_, index) => index));
    expect(tape.truncate(1.25)).toBeCloseTo(1.25, 5);
    tape.append(new Float32Array(4_000).fill(-1));
    const snapshot = tape.take();
    expect(snapshot.samples.length).toBe(24_000);
    expect(snapshot.samples[19_999]).toBe(19_999);
    expect(snapshot.samples[20_000]).toBe(-1);
  });

  it("seeds a continued session with the saved booth tape before appending", () => {
    const tape = createLiveTape();
    const saved = new Float32Array(16_000).fill(0.1);
    tape.begin({ chapterId: "ch01", initialSamples: saved });
    saved.fill(0.9);

    expect(tape.seconds()).toBeCloseTo(1, 5);
    tape.append(new Float32Array(8_000).fill(-0.2));
    const continued = tape.take();
    expect(continued.samples.length).toBe(24_000);
    expect(continued.samples[0]).toBeCloseTo(0.1, 5);
    expect(continued.samples[16_000]).toBeCloseTo(-0.2, 5);
  });

  it("normalizes an older saved tape to the live mono clock before continuing", () => {
    const stereo = Float32Array.from([0.8, 0.2, -0.4, 0.2]);
    expect(normalizeLiveTapePcm(stereo, 16_000, 2)).toEqual(Float32Array.from([0.5, -0.1]));
    expect(normalizeLiveTapePcm(new Float32Array(48_000), 48_000, 1)).toHaveLength(16_000);
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

  it("accepts its 16 kHz PCM output as a live recording but not a chapter take", () => {
    const tape = createLiveTape();
    tape.begin({ chapterId: "ch01" });
    tape.append(new Float32Array(16_000).fill(0.05));
    const audio = require("../dist-core/audio.cjs");
    const decoded = audio.decodeWavPcm16(tape.encode());

    expect(() => assertRecorderPcmBounds(decoded, "live")).not.toThrow();
    expect(() => assertRecorderPcmBounds(decoded, "chapter")).toThrow(/44\.1 kHz/u);
  });
});
