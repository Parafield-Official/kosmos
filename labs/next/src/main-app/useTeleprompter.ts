import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { promptHighlightRange, promptWordRows, type PromptWordRange } from "../../../../src/core/teleprompter/model";
import type { PromptHighlightMode } from "./store";

/** The cursor belongs to the script. Scrolling only changes the viewport. */
export function useTeleprompter({
  containerRef, index, paragraph, mode, getWord, layoutKey,
}: {
  containerRef: RefObject<HTMLElement | null>;
  index: number | null;
  paragraph: PromptWordRange | null;
  mode: PromptHighlightMode;
  getWord: (index: number) => HTMLElement | null;
  layoutKey: string;
}) {
  const [band, setBand] = useState<PromptWordRange | null>(null);
  const [detached, setDetached] = useState(false);
  const detachedRef = useRef(false);
  // Scroll events can arrive after an animation frame. Compare the actual
  // destination instead of guessing whether a programmatic scroll has ended.
  const scrollTarget = useRef<number | null>(null);
  const currentIndex = useRef(index);
  currentIndex.current = index;

  const scrollTo = useCallback((target: number | null) => {
    const root = containerRef.current;
    const word = target == null ? null : getWord(target);
    if (!root || !word) return;
    const box = root.getBoundingClientRect();
    const rect = word.getBoundingClientRect();
    const next = root.scrollTop + rect.top + rect.height / 2
      - box.top - root.clientTop - root.clientHeight * 0.42;
    root.scrollTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, next));
    scrollTarget.current = root.scrollTop;
  }, [containerRef, getWord]);

  const locate = useCallback((target: number | null = currentIndex.current) => {
    detachedRef.current = false;
    setDetached(false);
    scrollTo(target);
  }, [scrollTo]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const detach = () => {
      detachedRef.current = true;
      scrollTarget.current = null;
      setDetached(true);
    };
    const onScroll = () => {
      if (scrollTarget.current != null && Math.abs(root.scrollTop - scrollTarget.current) <= 1) return;
      detach();
    };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) detach();
    };
    const onPointer = (event: PointerEvent) => {
      // Native scrollbar dragging starts on the scroll container itself.
      if (event.target === root) detach();
    };
    root.addEventListener("wheel", detach, { passive: true });
    root.addEventListener("touchmove", detach, { passive: true });
    root.addEventListener("keydown", onKey);
    root.addEventListener("pointerdown", onPointer);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("wheel", detach);
      root.removeEventListener("touchmove", detach);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("pointerdown", onPointer);
      root.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, layoutKey]);

  const from = paragraph?.from;
  const to = paragraph?.to;
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      // Leave enough paper below the last word to reach the reading position,
      // including in short/narrow embedded panels.
      root.style.setProperty("--tp-tail-space", `${Math.ceil(root.clientHeight * 0.58)}px`);
      const tops: Array<number | null> = [];
      if (mode === "line" && from != null && to != null) {
        for (let word = from; word <= to; word += 1) {
          tops.push(getWord(word)?.getBoundingClientRect().top ?? null);
        }
      }
      const next = index == null ? null : promptHighlightRange({
        mode, wordIndex: index, paragraphFirstWord: from,
        paragraphWordCount: from != null && to != null ? to - from + 1 : 0,
        rows: from == null ? [] : promptWordRows(from, tops),
      });
      setBand((previous) => previous?.from === next?.from && previous?.to === next?.to ? previous : next);
      if (!detachedRef.current) scrollTo(index);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // Text can reflow without resizing the panel (font size, spacing, fonts).
    const content = root.querySelector("[data-prompt-content]");
    if (content) observer.observe(content);
    document.fonts?.addEventListener("loadingdone", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [containerRef, from, to, index, mode, getWord, layoutKey, scrollTo]);

  return { band, detached, locate };
}
