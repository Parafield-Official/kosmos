const { decodeAudioRequest, encodeAudioRequest, parseByteRange } = require("./audio-stream.cjs");

describe("streamed audio request boundary", () => {
  it("round-trips a Unicode project folder and relative path", () => {
    const url = encodeAudioRequest("/tmp/Book Ü.booth", "audio/chapter 01.mp3");
    expect(decodeAudioRequest(url)).toEqual({
      folder: "/tmp/Book Ü.booth",
      relativePath: "audio/chapter 01.mp3",
    });
  });

  // The booth writes every read of a chapter to the same tape path, so the
  // player tells one read from the next with a query on an otherwise identical
  // URL. Decoding has to look past it or listening back serves the last read.
  it("ignores a query used to separate one recording from the next", () => {
    const url = encodeAudioRequest("/tmp/Book.booth", "audio/live/ch01_session.wav");
    expect(decodeAudioRequest(`${url}?take=2`)).toEqual({
      folder: "/tmp/Book.booth",
      relativePath: "audio/live/ch01_session.wav",
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
