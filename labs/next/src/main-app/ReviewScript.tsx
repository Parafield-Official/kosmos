import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokenizeManuscript } from "../../../../src/core/proof/normalize";
import { isSpokenChapterHeading } from "./booth";
import {
  alignedManuscriptTokens,
  buildNarrationRedoRanges,
  createNarratorRedoPickup,
  type NarrationRedoRange,
} from "../../../../src/core/proof/selection";
import type { TranscriptWord } from "../../../../src/core/proof/align";
import { flagKindLabel } from "./flag-kind";
import { tokenIndexAtTime, tokenSpanFromSelection } from "./review-timing";
import type { ChapterPickup, PromptHighlightMode, PromptTheme } from "./store";

/**
 * Select words on the page and turn that stretch into a punch on the working file.
 */
export function ReviewScript({
  chapterId,
  chapterTitle,
  manuscript,
  transcript,
  playTranscript,
  playAt = null,
  playKey = null,
  pickups = [],
  focusedPickupId = null,
  sourceKind,
  highlight = "word",
  theme = "dark",
  fontPx,
  lineSpacing,
  onRedo,
}: {
  chapterId: string;
  chapterTitle?: string;
  manuscript: string;
  transcript: TranscriptWord[];
  playTranscript?: TranscriptWord[];
  playAt?: number | null;
  playKey?: string | null;
  pickups?: ChapterPickup[];
  focusedPickupId?: string | null;
  sourceKind: "live" | "take";
  highlight?: PromptHighlightMode;
  theme?: PromptTheme;
  fontPx?: number;
  lineSpacing?: number;
  onRedo: (pickup: ChapterPickup) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const autoScrollRef = useRef(false);
  const nowTokenRef = useRef<number | null>(null);
  const [lostPlace, setLostPlace] = useState(false);
  const tape = playTranscript ?? transcript;
  const tokens = useMemo(() => tokenizeManuscript(manuscript), [manuscript]);
  const blocks = useMemo(() => scriptBlocks(manuscript, tokens), [manuscript, tokens]);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redo = useMemo(() => {
    if (!range || transcript.length === 0) {
      return null;
    }
    try {
      return buildNarrationRedoRanges({
        manuscript,
        transcript,
        fromToken: range.from,
        toToken: range.to,
      });
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : "Could not time that selection." };
    }
  }, [manuscript, range, transcript]);

  function onMouseUp() {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const span = tokenSpanFromSelection(root);
    setRange(span);
    setError(null);
  }

  function record(target: NarrationRedoRange) {
    try {
      const pickup = createNarratorRedoPickup({
        chapterId,
        range: target,
        sourceKind,
      });
      window.getSelection()?.removeAllRanges();
      setRange(null);
      onRedo(pickup);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That stretch has no timing on the tape.");
    }
  }

  const pickupByToken = useMemo(() => {
    const map = new Map<number, ChapterPickup>();
    for (const pickup of pickups) {
      if (typeof pickup.manuscript_index === "number") {
        map.set(pickup.manuscript_index, pickup);
      }
    }
    return map;
  }, [pickups]);

  const focused = useMemo(
    () => pickups.find((pickup) => pickup.id === focusedPickupId) ?? null,
    [focusedPickupId, pickups],
  );

  const focusBand = useMemo(() => {
    if (!focused || typeof focused.manuscript_index !== "number" || transcript.length === 0) {
      return focused && typeof focused.manuscript_index === "number"
        ? { from: focused.manuscript_index, to: focused.manuscript_index }
        : null;
    }
    if (highlight === "word") {
      return { from: focused.manuscript_index, to: focused.manuscript_index };
    }
    try {
      const ranges = buildNarrationRedoRanges({
        manuscript,
        transcript,
        fromToken: focused.manuscript_index,
        toToken: focused.manuscript_index,
      });
      const range = highlight === "paragraph" ? ranges.paragraph : ranges.sentence;
      return { from: range.fromToken, to: range.toToken };
    } catch {
      return { from: focused.manuscript_index, to: focused.manuscript_index };
    }
  }, [focused, highlight, manuscript, transcript]);

  const playAligned = useMemo(() => {
    if (!playKey || tape.length === 0) {
      return [];
    }
    return alignedManuscriptTokens(manuscript, tape);
  }, [manuscript, playKey, tape]);

  const playToken = useMemo(
    () => (playAt == null ? null : tokenIndexAtTime(playAligned, playAt)),
    [playAligned, playAt],
  );

  const playBand = useMemo(() => {
    if (playToken == null) {
      return null;
    }
    if (highlight === "word") {
      return { from: playToken, to: playToken };
    }
    try {
      const ranges = buildNarrationRedoRanges({
        manuscript,
        transcript: tape,
        fromToken: playToken,
        toToken: playToken,
      });
      const range = highlight === "paragraph" ? ranges.paragraph : ranges.sentence;
      return { from: range.fromToken, to: range.toToken };
    } catch {
      return { from: playToken, to: playToken };
    }
  }, [highlight, manuscript, playToken, tape]);

  const nowToken = playToken ?? (typeof focused?.manuscript_index === "number" ? focused.manuscript_index : null);
  const nowBand = playBand ?? focusBand;
  nowTokenRef.current = nowToken;

  const tokenEl = useCallback((index: number | null) => {
    if (index == null) {
      return null;
    }
    return rootRef.current?.querySelector<HTMLElement>(`[data-token="${index}"]`) ?? null;
  }, []);

  const wordOffScreen = useCallback(
    (index: number | null) => {
      const root = rootRef.current;
      const el = tokenEl(index);
      if (!root || !el) {
        return false;
      }
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const pad = root.clientHeight * 0.2;
      return elRect.bottom < rootRect.top + pad || elRect.top > rootRect.bottom - pad;
    },
    [tokenEl],
  );

  const scrollToToken = useCallback(
    (index: number | null) => {
      const root = rootRef.current;
      const el = tokenEl(index);
      if (!root || !el) {
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const bandY = root.clientHeight * 0.42;
      autoScrollRef.current = true;
      root.scrollTop += elRect.top - rootRect.top - bandY + elRect.height / 2;
      window.requestAnimationFrame(() => {
        autoScrollRef.current = false;
      });
    },
    [tokenEl],
  );

  const locatePlay = useCallback(() => {
    if (!playKey) {
      return;
    }
    followRef.current = true;
    setLostPlace(false);
    scrollToToken(nowTokenRef.current);
  }, [playKey, scrollToToken]);

  useEffect(() => {
    if (!playKey) {
      followRef.current = true;
      setLostPlace(false);
      return;
    }
    followRef.current = true;
    setLostPlace(false);
  }, [playKey]);

  useEffect(() => {
    if (playKey && nowToken != null) {
      if (!followRef.current) {
        setLostPlace(wordOffScreen(nowToken));
        return;
      }
      const frame = window.requestAnimationFrame(() => scrollToToken(nowToken));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!playKey && focusedPickupId) {
      const el = rootRef.current?.querySelector(`[data-pickup="${focusedPickupId}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusedPickupId, nowToken, playKey, scrollToToken, wordOffScreen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !playKey) {
      return;
    }
    function onScroll() {
      if (autoScrollRef.current) {
        return;
      }
      if (wordOffScreen(nowTokenRef.current)) {
        followRef.current = false;
        setLostPlace(true);
      } else {
        setLostPlace(false);
      }
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [playKey, wordOffScreen]);

  if (tokens.length === 0) {
    return null;
  }

  const ranges = redo && "sentence" in redo ? redo : null;
  const fail = redo && "error" in redo ? redo.error : error;
  const sentence = ranges?.sentence ?? null;
  const selection = ranges?.selection ?? null;

  return (
    <section className="ma-review-script" aria-label="Teleprompter">
      {sentence || selection ? (
        <div className="ma-redo-bar neu-inset">
          <p>
            {sentence && sentence.timing !== "unavailable"
              ? sentence.text
              : selection?.text}
          </p>
          <div className="ma-step-actions">
            {sentence && sentence.timing !== "unavailable" ? (
              <button type="button" className="btn" onClick={() => record(sentence)}>
                Record this sentence
              </button>
            ) : null}
            {ranges?.paragraph && ranges.paragraph.timing !== "unavailable" ? (
              <button type="button" className="btn btn-clear" onClick={() => record(ranges.paragraph)}>
                Record this paragraph
              </button>
            ) : null}
            {sentence?.timing === "unavailable" && selection?.timing === "unavailable" ? (
              <p className="ma-step-note">This part has no timing on the tape yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {fail ? <p className="ma-error">{fail}</p> : null}
      <div
        ref={rootRef}
        className={`ma-review-prose neu-card is-${theme}`}
        style={{
          ...(fontPx ? { fontSize: `${fontPx}px` } : {}),
          ...(lineSpacing ? { lineHeight: lineSpacing } : {}),
        }}
        onMouseUp={onMouseUp}
      >
        {blocks.map((block, index) => (
          <p
            key={index}
            className={
              chapterTitle && isSpokenChapterHeading(block.parts.map((part) => part.text).join(""), chapterTitle)
                ? "is-heading"
                : undefined
            }
          >
            {block.parts.map((part, partIndex) =>
              part.tokenIndex === undefined ? (
                <span key={partIndex}>{part.text}</span>
              ) : (
                <FlagWord
                  key={partIndex}
                  tokenIndex={part.tokenIndex}
                  text={part.text}
                  selected={Boolean(range && part.tokenIndex >= range.from && part.tokenIndex <= range.to)}
                  pickup={pickupByToken.get(part.tokenIndex)}
                  focused={Boolean(
                    pickupByToken.get(part.tokenIndex) &&
                      pickupByToken.get(part.tokenIndex)?.id === focusedPickupId,
                  )}
                  isNow={nowToken === part.tokenIndex}
                  inBand={Boolean(
                    nowBand && part.tokenIndex >= nowBand.from && part.tokenIndex <= nowBand.to,
                  )}
                  onFlag={(pickup) => onRedo(pickup)}
                />
              ),
            )}
          </p>
        ))}
      </div>
      <button
        type="button"
        className={`ma-locate-speak${lostPlace ? " is-lost" : ""}`}
        onClick={locatePlay}
        aria-disabled={!playKey}
        title="Locate the word being played"
        aria-label="Locate the word being played"
      >
        <LocateGlyph />
      </button>
    </section>
  );
}

type ScriptPart = { text: string; tokenIndex?: number };

function FlagWord({
  tokenIndex,
  text,
  selected,
  pickup,
  focused,
  isNow,
  inBand,
  onFlag,
}: {
  tokenIndex: number;
  text: string;
  selected: boolean;
  pickup?: ChapterPickup;
  focused: boolean;
  isNow: boolean;
  inBand: boolean;
  onFlag: (pickup: ChapterPickup) => void;
}) {
  const kind = pickup ? flagKindLabel(pickup.kind) : null;
  const classes = [
    "ma-review-word",
    selected ? "is-selected" : "",
    pickup ? `is-flag is-flag-${pickup.kind}` : "",
    focused ? "is-focused" : "",
    isNow ? "is-now" : "",
    inBand && !isNow ? "in-band" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      data-token={tokenIndex}
      data-pickup={pickup?.id}
      className={classes}
      title={kind ? `${kind} — click to re-record` : undefined}
      onClick={() => {
        if (pickup) {
          onFlag(pickup);
        }
      }}
    >
      {text}
    </span>
  );
}

function scriptBlocks(
  manuscript: string,
  tokens: ReturnType<typeof tokenizeManuscript>,
): Array<{ parts: ScriptPart[] }> {
  const blocks: Array<{ parts: ScriptPart[] }> = [];
  let offset = 0;
  for (const chunk of manuscript.split(/(\n+)/)) {
    if (!chunk || /^\n+$/.test(chunk) || !chunk.trim()) {
      offset += chunk.length;
      continue;
    }
    const start = offset;
    const end = offset + chunk.length;
    const inBlock = tokens.filter((token) => token.start >= start && token.end <= end);
    const parts: ScriptPart[] = [];
    let at = start;
    for (const token of inBlock) {
      if (token.start > at) {
        parts.push({ text: manuscript.slice(at, token.start) });
      }
      parts.push({ text: token.text, tokenIndex: token.index });
      at = token.end;
    }
    if (at < end) {
      parts.push({ text: manuscript.slice(at, end) });
    }
    if (parts.length) {
      blocks.push({ parts });
    }
    offset = end;
  }
  return blocks;
}

function LocateGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.2v1.7M8 12.1v1.7M2.2 8h1.7M12.1 8h1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" />
    </svg>
  );
}
