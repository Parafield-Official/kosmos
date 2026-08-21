const { isMicrophonePermission, ensureMicrophoneAccess } = require("./media-access.cjs");

describe("microphone permission", () => {
  it("allows Chromium's media permission and rejects unrelated ones", () => {
    expect(isMicrophonePermission("media")).toBe(true);
    expect(isMicrophonePermission("microphone")).toBe(true);
    expect(isMicrophonePermission("audioCapture")).toBe(true);
    expect(isMicrophonePermission("camera")).toBe(false);
    expect(isMicrophonePermission("geolocation")).toBe(false);
  });

  it("asks macOS for the microphone before the renderer opens the stream", async () => {
    const asked = [];
    const allowed = await ensureMicrophoneAccess({
      askForMediaAccess: async (media) => {
        asked.push(media);
        return true;
      },
    }, "darwin");
    expect(asked).toEqual(["microphone"]);
    expect(allowed).toBe(true);
  });

  it("does not prompt on Windows", async () => {
    const asked = [];
    const allowed = await ensureMicrophoneAccess({
      askForMediaAccess: async (media) => {
        asked.push(media);
        return false;
      },
    }, "win32");
    expect(asked).toEqual([]);
    expect(allowed).toBe(true);
  });
});
