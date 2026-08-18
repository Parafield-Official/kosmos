const { decodeAudioRequest, encodeAudioRequest, parseByteRange } = require("./audio-stream.cjs");

describe("streamed audio request boundary", () => {
  it("round-trips a Unicode project folder and relative path", () => {
    const url = encodeAudioRequest("/tmp/Book Ü.booth", "audio/chapter 01.mp3");
    expect(decodeAudioRequest(url)).toEqual({
      folder: "/tmp/Book Ü.booth",
      relativePath: "audio/chapter 01.mp3",
    });
  });

  it("parses bounded, suffix, and open-ended ranges", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects multiple, reversed, and unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=1-2,4-5", 100)).toBeNull();
    expect(parseByteRange("bytes=5-4", 100)).toBeNull();
    expect(parseByteRange("bytes=100-", 100)).toBeNull();
    expect(parseByteRange("bytes=-0", 100)).toBeNull();
  });
});
