const {
  assertDuetMixRouting,
  chapterAfterDuetRoutingChange,
  chapterAfterSoloMode,
  chapterAfterSeatChange,
  chapterHasAudio,
  resetChapterAudioFields,
  seatForProjectMode,
} = require("./chapter-state.cjs");

describe("chapter audio state transitions", () => {
  it("requires a real N2 route before accepting a duet mix", () => {
    expect(() => assertDuetMixRouting([], "N1")).toThrow(/spans to seats/i);
    expect(() => assertDuetMixRouting([{ start: 0, end: 1, seat: "N1" }], "N1")).toThrow(/N2/i);
    expect(() => assertDuetMixRouting([{ start: 0, end: 1, seat: "narration" }], "N2")).not.toThrow();
    expect(() => assertDuetMixRouting([{ start: 0, end: 1, seat: "N2" }], "N1")).not.toThrow();
  });

  it("detaches a stale duet mix when switching to solo and restores the raw take", () => {
    const chapter = {
      id: "ch01",
      index: 1,
      audio_path: "audio/duet/01_mix.wav",
      raw_audio_path: "audio/01_raw.wav",
      duet_mix_path: "audio/duet/01_mix.wav",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
      n1_stem_path: "audio/duet/01-n1.wav",
      n2_stem_path: "audio/duet/01-n2.wav",
      pickups_path: "alignment/01.json",
      open_pickups: 4,
      acx_traffic_light: "green",
    };

    expect(chapterAfterSoloMode(chapter)).toMatchObject({
      audio_path: "audio/01_raw.wav",
      raw_audio_path: "audio/01_raw.wav",
      pickups_path: "alignment/01.json",
      open_pickups: 0,
    });
    const soloChapter = chapterAfterSoloMode(chapter);
    expect(soloChapter.duet_mix_path).toBeUndefined();
    expect(soloChapter.bed_audio_path).toBeUndefined();
    expect(soloChapter.n1_stem_path).toBeUndefined();
  });

  it("clears old duet tracks when a new canonical take is attached", () => {
    const chapter = {
      id: "ch01",
      index: 1,
      pickups_path: "alignment/01.json",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
      audio_path: "audio/01_raw.wav",
    };
    const reset = resetChapterAudioFields({ ...chapter, audio_path: "audio/01_new.wav" });
    expect(reset.bed_audio_path).toBeUndefined();
    expect(reset.overdub_audio_path).toBeUndefined();
    expect(chapterHasAudio(reset)).toBe(true);
  });

  it("can update one duet track without dropping its counterpart", () => {
    const reset = resetChapterAudioFields({
      id: "ch01",
      index: 1,
      pickups_path: "alignment/01.json",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
    }, { preserveDuetTracks: true });
    expect(reset.bed_audio_path).toBe("audio/duet/01_bed.wav");
    expect(reset.overdub_audio_path).toBe("audio/duet/01_overdub.wav");
  });

  it("invalidates a stale duet mix after a seat change while retaining its source tracks", () => {
    const changed = chapterAfterSeatChange({
      id: "ch01",
      index: 1,
      audio_path: "audio/duet/01_mix.wav",
      raw_audio_path: "audio/01_raw.wav",
      duet_mix_path: "audio/duet/01_mix.wav",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
      n1_stem_path: "audio/duet/01_N1.wav",
      n2_stem_path: "audio/duet/01_N2.wav",
      pickups_path: "alignment/01.json",
      open_pickups: 2,
      acx_traffic_light: "green",
    });

    expect(changed).toMatchObject({
      audio_path: "audio/01_raw.wav",
      raw_audio_path: "audio/01_raw.wav",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
      open_pickups: 0,
    });
    expect(changed.duet_mix_path).toBeUndefined();
    expect(changed.n1_stem_path).toBeUndefined();
    expect(changed.n2_stem_path).toBeUndefined();
    expect(changed.acx_traffic_light).toBeUndefined();
  });

  it("restores a raw or edited take when replacing a source track invalidates the active mix", () => {
    const changed = chapterAfterDuetRoutingChange({
      id: "ch01",
      index: 1,
      audio_path: "audio/duet/01_mix.wav",
      raw_audio_path: "audio/01_raw.wav",
      edited_audio_path: "audio/01_edited.wav",
      duet_mix_path: "audio/duet/01_mix.wav",
      bed_audio_path: "audio/duet/01_bed.wav",
      overdub_audio_path: "audio/duet/01_overdub.wav",
      pickups_path: "alignment/01.json",
    });
    expect(changed.audio_path).toBe("audio/01_edited.wav");
    expect(changed.edited_audio_path).toBe("audio/01_edited.wav");
    expect(changed.bed_audio_path).toBe("audio/duet/01_bed.wav");
    expect(changed.overdub_audio_path).toBe("audio/duet/01_overdub.wav");
    expect(changed.duet_mix_path).toBeUndefined();
  });

  it("keeps solo projects on the narration seat", () => {
    expect(seatForProjectMode("solo", "N2")).toBe("narration");
    expect(seatForProjectMode("duet", "N2")).toBe("N2");
    expect(seatForProjectMode("duet", "narration")).toBe("narration");
  });
});
