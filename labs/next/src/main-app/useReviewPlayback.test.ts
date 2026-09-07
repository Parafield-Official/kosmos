import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewPlayback } from "./useReviewPlayback";
import { readChapterAudioUrl, type BookProject, type ChapterPickup } from "./store";

vi.mock("./store", () => ({ readChapterAudioUrl: vi.fn() }));

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => {
    if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")); }
  });
  constructor(public src: string) { super(); FakeAudio.instances.push(this); }
}

const project: BookProject = {
  id: "book", title: "Test", author: "Test", folder: "/fixture", manuscript: "book.txt",
  createdAt: "2026-09-07", updatedAt: "2026-09-07",
  chapters: [{ id: "chapter", title: "Chapter", wordCount: 10, recordedPct: 1,
    hasOriginalAudio: true, hasWorkingAudio: true, hasMasteredAudio: false,
    originalFile: "original.wav", workingFile: "working.wav", resumeWordIndex: 10,
    proofed: true, mastered: false }],
};
const pickup = { id: "flag-one", t_start: 10, t_end: 12, line_start: 10, line_end: 12 } as ChapterPickup;
let player: ReturnType<typeof useReviewPlayback>;
let renderer: ReactTestRenderer;
function Harness({ book }: { book: BookProject }) {
  player = useReviewPlayback(book, book.chapters[0], book.chapters[0].id);
  return null;
}
async function mount() {
  await act(async () => { renderer = create(createElement(Harness, { book: project })); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.instances = [];
  vi.mocked(readChapterAudioUrl).mockReset().mockResolvedValue("blob:recording");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("proofread playback lifecycle", () => {
  it("ignores a queued pause event when the audio is already playing again", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    await act(async () => { FakeAudio.instances[0].dispatchEvent(new Event("pause")); });
    expect(player.playing).toBe("original-flag-one");
  });

  it("reloads edited audio even when a punch keeps the same filename", async () => {
    await mount();
    await act(async () => { await player.playRange("working", pickup); });
    const updated = { ...project, chapters: [{ ...project.chapters[0], punches: [] }] };
    await act(async () => renderer.update(createElement(Harness, { book: updated })));
    expect(player.playKey).toBeNull();
    expect(FakeAudio.instances[0].paused).toBe(true);
    await act(async () => { await player.playRange("working", pickup); });
    expect(readChapterAudioUrl).toHaveBeenCalledTimes(2);
  });

  it("retains the original source and position on pause, then resumes there", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    const audio = FakeAudio.instances[0];
    await act(async () => { audio.currentTime = 11; player.stopPlayback(); });
    expect(player.playing).toBeNull();
    expect(player.playKey).toBe("original-flag-one");
    expect(player.playAt).toBe(11);
    await act(async () => { await player.playRange("original", pickup); });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.currentTime).toBe(11);
    expect(player.playing).toBe("original-flag-one");
    expect(readChapterAudioUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps the last position at the range end and starts a replay at the beginning", async () => {
    await mount();
    await act(async () => { await player.playRange("working", pickup); });
    await act(async () => {
      FakeAudio.instances[0].currentTime = 13;
      FakeAudio.instances[0].dispatchEvent(new Event("timeupdate"));
    });
    expect(player.playing).toBeNull();
    expect(player.playKey).toBe("working-flag-one");
    expect(player.playAt).toBe(12.15);
    await act(async () => { await player.playRange("working", pickup); });
    expect(FakeAudio.instances[1].currentTime).toBe(9.85);
  });

  it("retains the last actual timestamp when the file ends early", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    await act(async () => {
      FakeAudio.instances[0].currentTime = 11.5;
      FakeAudio.instances[0].dispatchEvent(new Event("ended"));
    });
    expect(player.playing).toBeNull(); expect(player.playAt).toBe(11.5);
  });

  it("shows a load failure and retries successfully on the next Play", async () => {
    vi.mocked(readChapterAudioUrl).mockRejectedValueOnce(new Error("disk"));
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    expect(player.error).toContain("Try Play again");
    expect(player.loading).toBe(false);
    await act(async () => { await player.playRange("original", pickup); });
    expect(player.error).toBeNull(); expect(player.playing).toBe("original-flag-one");
  });

  it("ignores a rejected play promise and events from a replaced clip", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); player.stopPlayback(); });
    const old = FakeAudio.instances[0];
    let reject!: (reason: unknown) => void;
    old.play.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    let pending!: Promise<void>;
    await act(async () => { pending = player.playRange("original", pickup); });
    await act(async () => { await player.playRange("working", pickup); });
    await act(async () => { reject(new Error("old failure")); await pending; old.dispatchEvent(new Event("ended")); });
    expect(player.playing).toBe("working-flag-one"); expect(player.error).toBeNull();
  });

  it("reports media errors and reloads the recording for a retry", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    await act(async () => { FakeAudio.instances[0].dispatchEvent(new Event("error")); });
    expect(player.error).toContain("couldn’t be played"); expect(player.playing).toBeNull();
    await act(async () => { await player.playRange("original", pickup); });
    expect(readChapterAudioUrl).toHaveBeenCalledTimes(2); expect(player.error).toBeNull();
  });

  it("keeps playing through unrelated project updates but resets on a new chapter", async () => {
    await mount();
    await act(async () => { await player.playRange("original", pickup); });
    await act(async () => renderer.update(createElement(Harness, { book: { ...project, title: "Renamed" } })));
    expect(player.playing).toBe("original-flag-one");
    await act(async () => renderer.update(createElement(Harness, { book: {
      ...project, chapters: [{ ...project.chapters[0], id: "other" }],
    } })));
    expect(player.playKey).toBeNull(); expect(player.playAt).toBeNull();
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it("discards a late file load after changing chapters", async () => {
    let resolve!: (url: string) => void;
    vi.mocked(readChapterAudioUrl).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    await mount();
    let pending!: Promise<void>;
    await act(async () => { pending = player.playRange("original", pickup); });
    expect(player.loading).toBe(true);
    await act(async () => renderer.update(createElement(Harness, { book: {
      ...project, chapters: [{ ...project.chapters[0], id: "other" }],
    } })));
    await act(async () => { resolve("blob:late"); await pending; });
    expect(FakeAudio.instances).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late");
    expect(player.playKey).toBeNull();
  });
});
