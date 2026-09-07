import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { PromptHighlightMode } from "./store";

type Rail = {
  top: number;
  left: number;
  width: number;
  height: number;
  kind: "word" | "band";
};

/** Render beside the scroller, inside its positioned viewport wrapper. */
export function TeleprompterFocus({
  containerRef,
  nowIndex,
  from,
  to,
  getWord,
  mode,
  layoutKey,
}: {
  containerRef: RefObject<HTMLElement | null>;
  nowIndex: number | null;
  from: number | null;
  to: number | null;
  getWord: (index: number) => HTMLElement | null;
  mode: PromptHighlightMode;
  layoutKey: string;
}) {
  const guideRef = useRef<HTMLDivElement>(null);
  const [rails, setRails] = useState<Rail[]>([]);
  const [caretY, setCaretY] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const node = root;

    function measure() {
      const box = node.getBoundingClientRect();
      const origin = guideRef.current?.getBoundingClientRect();
      if (!origin || box.width < 2 || box.height < 2) {
        setRails([]);
        setCaretY(null);
        return;
      }
      const bandStart = from;
      const bandEnd = to;
      const groups = new Map<number, { left: number; right: number; top: number; bottom: number }>();
      if (mode !== "word" && bandStart != null && bandEnd != null) {
        for (let index = bandStart; index <= bandEnd; index += 1) {
          const el = getWord(index);
          if (!el) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          const key = [...groups.keys()].find((top) => Math.abs(top - rect.top) < 4) ?? rect.top;
          const prev = groups.get(key);
          if (!prev) {
            groups.set(key, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
          } else {
            prev.left = Math.min(prev.left, rect.left);
            prev.right = Math.max(prev.right, rect.right);
            prev.top = Math.min(prev.top, rect.top);
            prev.bottom = Math.max(prev.bottom, rect.bottom);
          }
        }
      }
      const next: Rail[] = [];
      for (const group of groups.values()) {
        if (group.bottom < box.top - 8 || group.top > box.bottom + 8) {
          continue;
        }
        next.push({
          kind: "band",
          top: group.top - origin.top - 4,
          left: group.left - origin.left - 18,
          width: group.right - group.left + 36,
          height: group.bottom - group.top + 8,
        });
      }
      const nowEl = nowIndex == null ? null : getWord(nowIndex);
      if (nowEl) {
        const rect = nowEl.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (mid >= box.top + node.clientTop && mid <= box.top + node.clientTop + node.clientHeight) {
          if (mode === "word") next.push({
            kind: "word",
            top: rect.top - origin.top - 5,
            left: rect.left - origin.left - 12,
            width: rect.width + 24,
            height: rect.height + 10,
          });
          setCaretY(mid - origin.top);
        } else {
          setCaretY(null);
        }
      } else {
        setCaretY(null);
      }
      setRails(next);
    }

    measure();
    node.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const content = node.querySelector("[data-prompt-content]");
    if (content) observer.observe(content);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      node.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [containerRef, from, getWord, nowIndex, to, mode, layoutKey]);

  return (
    <div ref={guideRef} className="ma-teleprompter-guide" aria-hidden="true">
      {rails.map((rail, index) => (
        <i
          key={`${rail.kind}-${index}`}
          className={`ma-tp-rail is-${rail.kind}`}
          style={
            {
              top: rail.top,
              left: rail.left,
              width: rail.width,
              height: rail.height,
            } as CSSProperties
          }
        />
      ))}
      {caretY != null ? (
        <>
          <span className="ma-teleprompter-caret" style={{ top: caretY }} />
          <span className="ma-teleprompter-caret is-right" style={{ top: caretY }} />
        </>
      ) : null}
    </div>
  );
}
