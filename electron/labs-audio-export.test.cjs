const { retailSampleRange } = require("./labs-audio.cjs");

describe("ACX retail sample planning", () => {
  const profile = { sampleRate: 44_100, headSeconds: 0.5 };
  const spec = { min: 60, max: 300 };

  it("skips a short first chapter so a later chapter can supply the sample", () => {
    expect(retailSampleRange(45 * profile.sampleRate, profile, spec)).toBeNull();
    expect(retailSampleRange(90 * profile.sampleRate, profile, spec)).toEqual({
      start: 22_050,
      length: 3_946_950,
    });
  });

  it("reserves MP3 padding below the five-minute limit", () => {
    const range = retailSampleRange(600 * profile.sampleRate, profile, spec);
    expect(range.length / profile.sampleRate).toBe(299);
  });
});
