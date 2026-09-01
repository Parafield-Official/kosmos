import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

type Rail = {
  top: number;
  left: number;
  width: number;
  height: number;
  kind: "word" | "band";
};

export function TeleprompterFocus({
  containerRef,
  nowIndex,
  from,
  to,
  getWord,
}: {
  containerRef: RefObject<HTMLElement | null>;
  nowIndex: number | null;
  from: number | null;
  to: number | null;
  getWord: (index: number) => HTMLElement | null;
}) {
  const [rails, setRails] = useState<Rail[]>([]);
  const [caretY, setCaretY] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }

    function measure() {
      const box = root.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) {
        return;
      }
      const bandStart = from ?? nowIndex;
      const bandEnd = to ?? nowIndex;
      const wordOnly = bandStart === nowIndex && bandEnd === nowIndex;
      const groups = new Map<number, { left: number; right: number; top: number; bottom: number }>();
      if (!wordOnly && bandStart != null && bandEnd != null) {
        for (let index = bandStart; index <= bandEnd; index += 1) {
          const el = getWord(index);
          if (!el) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          const key = Math.round(rect.top);
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
          top: group.top - box.top - 4,
          left: group.left - box.left - 18,
          width: group.right - group.left + 36,
          height: group.bottom - group.top + 8,
        });
      }
      const nowEl = nowIndex == null ? null : getWord(nowIndex);
      if (nowEl) {
        const rect = nowEl.getBoundingClientRect();
        const mid = rect.top + rect.height / 2 - box.top;
        if (mid >= -10 && mid <= box.height + 10) {
          next.push({
            kind: "word",
            top: rect.top - box.top - 5,
            left: rect.left - box.left - 12,
            width: rect.width + 24,
            height: rect.height + 10,
          });
          setCaretY(mid);
        } else {
          setCaretY(null);
        }
      } else {
        setCaretY(null);
      }
      setRails(next);
    }

    measure();
    root.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      root.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [containerRef, from, getWord, nowIndex, to]);

  if (caretY == null && rails.length === 0) {
    return null;
  }

  return (
    <div className="ma-teleprompter-guide" aria-hidden="true">
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
