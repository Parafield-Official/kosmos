import { useMemo, useRef, useState } from "react";
import { tokenizeManuscript } from "../../../../src/core/proof/normalize";
import { pickupKindPresentation } from "../../../../src/core/proof/pickup-display";
import {
  buildNarrationRedoRanges,
  createNarratorRedoPickup,
  type NarrationRedoRange,
} from "../../../../src/core/proof/selection";
import type { TranscriptWord } from "../../../../src/core/proof/align";
import { tokenSpanFromSelection } from "./review-timing";
import type { ChapterPickup } from "./store";

/**
 * Select words on the page and turn that stretch into a punch on the working file.
 */
export function ReviewScript({
  chapterId,
  manuscript,
  transcript,
  pickups = [],
  focusedPickupId = null,
  sourceKind,
  onRedo,
  onSelectFlag,
}: {
  chapterId: string;
  manuscript: string;
  transcript: TranscriptWord[];
  pickups?: ChapterPickup[];
  focusedPickupId?: string | null;
  sourceKind: "live" | "take";
  onRedo: (pickup: ChapterPickup) => void;
  onSelectFlag?: (pickup: ChapterPickup) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
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

  if (tokens.length === 0) {
    return null;
  }

  const ranges = redo && "sentence" in redo ? redo : null;
  const fail = redo && "error" in redo ? redo.error : error;
  const sentence = ranges?.sentence ?? null;
  const selection = ranges?.selection ?? null;

  return (
    <section className="ma-review-script" aria-label="Chapter text">
      <header className="ma-review-script-head">
        <h2 className="ma-section-title">On the page</h2>
        <p>
          {transcript.length === 0
            ? "Proofread (or finish the booth read) so Kosmos knows where each sentence sits on the tape. Then select a line to say again."
            : "Select a sentence or paragraph to say again. Click a coloured flag to hear it, then re-record."}
        </p>
      </header>
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
        className="ma-review-prose neu-card"
        onMouseUp={onMouseUp}
      >
        {blocks.map((block, index) => (
          <p key={index}>
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
                  onFlag={(pickup) => onSelectFlag?.(pickup)}
                />
              ),
            )}
          </p>
        ))}
      </div>
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
  onFlag,
}: {
  tokenIndex: number;
  text: string;
  selected: boolean;
  pickup?: ChapterPickup;
  focused: boolean;
  onFlag: (pickup: ChapterPickup) => void;
}) {
  const kind = pickup ? pickupKindPresentation(pickup.kind).label.replace(" ", "-") : null;
  const classes = [
    "ma-review-word",
    selected ? "is-selected" : "",
    pickup ? `is-flag is-flag-${pickup.kind}` : "",
    focused ? "is-focused" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      data-token={tokenIndex}
      className={classes}
      title={kind ?? undefined}
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
