import { useEffect, useRef, useState } from "react";

export function useTypewriter(
  text: string,
  {
    charMs = 42,
    pauseMs = 900,
    reduced = false,
    active = true,
    onComplete,
  }: {
    charMs?: number;
    pauseMs?: number;
    reduced?: boolean;
    active?: boolean;
    onComplete?: () => void;
  },
) {
  const [visible, setVisible] = useState(reduced && active ? text : "");
  const [typing, setTyping] = useState(Boolean(active && !reduced));
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];
    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        if (!cancelled) {
          fn();
        }
      }, ms);
      timeouts.push(id);
    };

    if (!active) {
      setVisible("");
      setTyping(false);
      return () => {
        cancelled = true;
        timeouts.forEach((id) => window.clearTimeout(id));
      };
    }

    if (reduced) {
      setVisible(text);
      setTyping(false);
      schedule(() => onCompleteRef.current?.(), Math.min(pauseMs, 400));
      return () => {
        cancelled = true;
        timeouts.forEach((id) => window.clearTimeout(id));
      };
    }

    setVisible("");
    setTyping(true);
    let index = 0;
    const tick = () => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        setTyping(false);
        schedule(() => onCompleteRef.current?.(), pauseMs);
        return;
      }
      schedule(tick, charMs);
    };

    schedule(tick, charMs);

    return () => {
      cancelled = true;
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [active, charMs, pauseMs, reduced, text]);

  return { visible, typing };
}
