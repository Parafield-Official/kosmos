const { decodeLiveAudioPayload, extensionForMime } = require("./live-audio.cjs");

describe("listen-only audio payload boundary", () => {
  it("accepts bounded local WAV data and chooses a safe extension", () => {
    const value = decodeLiveAudioPayload({
      mimeType: "audio/wav",
      audioBase64: Buffer.from("RIFFfixture", "utf8").toString("base64"),
    });
    expect(value.bytes.toString("utf8")).toBe("RIFFfixture");
    expect(extensionForMime(value.mimeType)).toBe(".wav");
  });

  it("accepts only supported audio containers", () => {
    expect(() => decodeLiveAudioPayload({
      mimeType: "text/plain",
      audioBase64: Buffer.from("not audio", "utf8").toString("base64"),
    })).toThrow(/audio container/i);
  });

  it("rejects malformed or oversized renderer payloads", () => {
    expect(() => decodeLiveAudioPayload({ mimeType: "audio/wav", audioBase64: "not base64?" })).toThrow(/base64/i);
    expect(() => decodeLiveAudioPayload({
      mimeType: "audio/wav",
      audioBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"),
    })).toThrow(/too large/i);
  });
});
