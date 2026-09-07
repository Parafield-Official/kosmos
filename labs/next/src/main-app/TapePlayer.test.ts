import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TapePlayer } from "./TapePlayer";

class FakeAudio extends EventTarget {
  currentTime = 0;
  paused = true;
  error: object | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event("pause")); });
  load = vi.fn(() => { this.error = null; });
}
let renderer: ReactTestRenderer;
let audio: FakeAudio;
const button = () => renderer.root.findByProps({ className: "ma-tape-play" });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); audio = new FakeAudio(); });
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(createElement(TapePlayer, { src: "blob:first", label: "Original" }), {
      createNodeMock: element => element.type === "audio" ? audio : null,
    });
  });
}

describe("recording tape playback feedback", () => {
  it("ignores a queued pause event after playback has already resumed", async () => {
    await mount();
    await act(async () => { await button().props.onClick(); });
    await act(async () => { audio.dispatchEvent(new Event("pause")); });
    expect(button().props["aria-label"]).toBe("Pause");
  });

  it("shows a rejected Play request as an alert and clears it after a retry", async () => {
    audio.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await mount();
    await act(async () => { await button().props.onClick(); });
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("blocked");
    expect(button().props["aria-label"]).toBe("Play");
    await act(async () => { await button().props.onClick(); });
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(button().props["aria-label"]).toBe("Pause");
  });

  it("reports a media error and reloads before retrying", async () => {
    await mount();
    await act(async () => { audio.error = {}; audio.dispatchEvent(new Event("error")); });
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("reopen the chapter");
    await act(async () => { await button().props.onClick(); });
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it("does not resurrect an old failure after the source changes", async () => {
    let reject!: (reason: unknown) => void;
    audio.play.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await mount();
    let pending!: Promise<void>;
    await act(async () => { pending = button().props.onClick(); });
    await act(async () => renderer.update(createElement(TapePlayer, { src: "blob:new", label: "Original" })));
    await act(async () => { reject(new Error("old failure")); await pending; });
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(button().props["aria-label"]).toBe("Play");
  });

  it("lets a second click cancel a pending playback request without showing an error", async () => {
    let reject!: (reason: unknown) => void;
    audio.play.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await mount();
    let pending!: Promise<void>;
    await act(async () => { pending = button().props.onClick(); });
    await act(async () => { await button().props.onClick(); });
    await act(async () => { reject(new DOMException("cancelled", "AbortError")); await pending; });
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(button().props["aria-label"]).toBe("Play");
  });
});
