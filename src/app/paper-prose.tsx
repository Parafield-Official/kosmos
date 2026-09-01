import { useEffect, useRef, type ReactNode } from "react";
import type { PaperBlock, PaperInline } from "../core/manuscript/paper";
import { manuscriptBlocks, transcriptBlocks } from "../core/manuscript/paper";
import type { AlignedManuscriptToken } from "../core/proof/selection";

export interface ManuscriptProofAnnotation {
  id: string;
  tokenIndex: number;
  kind: "skip" | "insert" | "sub" | "pause" | "performance";
  label: string;
  status: "open" | "done" | "ignored";
}

export interface SelectionActionPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

export type SelectionActionEvent =
  | { type: "show"; position: SelectionActionPosition }
  | { type: "dismiss"; reason: "outside-pointer" | "overlay-open" | "selection-cleared" | "viewport-change" };

/** Keep contextual selection controls ephemeral instead of carrying them into overlays. */
export function selectionActionReducer(
  state: SelectionActionPosition | null,
  event: SelectionActionEvent,
): SelectionActionPosition | null {
  if (event.type === "show") {
    return event.position;
  }
  return state ? null : state;
}

interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Keep the immediate record action next to the highlight and on-screen. */
export function selectionActionPosition(
  rect: SelectionRect,
  viewport: { width: number; height: number },
): SelectionActionPosition {
  const toolbarWidth = 196;
  const toolbarHeight = 46;
  const gap = 10;
  const edge = 8;
  const left = Math.max(edge, Math.min(rect.left, viewport.width - toolbarWidth - edge));
  const fitsBelow = rect.bottom + gap + toolbarHeight <= viewport.height - edge;
  return {
    left,
    top: fitsBelow
      ? rect.bottom + gap
      : Math.max(edge, rect.top - toolbarHeight - gap),
    placement: fitsBelow ? "below" : "above",
  };
}

function InlineMarks({ inlines }: { inlines: PaperInline[] }) {
  return (
    <>
      {inlines.map((part, index) => {
        if (part.kind === "strong") {
          return <strong key={index}>{part.text}</strong>;
        }
        if (part.kind === "em") {
          return <em key={index}>{part.text}</em>;
        }
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

function PaperBlocks({ blocks }: { blocks: PaperBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = block.level === 1 ? "h4" : "h5";
          return <Tag key={`${block.kind}-${index}`}><InlineMarks inlines={block.inlines} /></Tag>;
        }
        return <p key={`${block.kind}-${index}`}><InlineMarks inlines={block.inlines} /></p>;
      })}
    </>
  );
}

export function PaperProse({
  text,
  kind,
  empty,
}: {
  text: string;
  kind: "manuscript" | "transcript";
  empty: string;
}) {
  const blocks = kind === "manuscript" ? manuscriptBlocks(text) : transcriptBlocks(text);
  if (blocks.length === 0) {
    return <p className="paper-empty">{empty}</p>;
  }
  return <PaperBlocks blocks={blocks} />;
}

const PAPER_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;

function ProofInlineMarks({
  inlines,
  startToken,
  aligned,
  annotations,
  focusedAnnotationId,
  mode,
  preserveWritten = false,
}: {
  inlines: PaperInline[];
  startToken: number;
  aligned: Map<number, AlignedManuscriptToken>;
  annotations: Map<number, ManuscriptProofAnnotation[]>;
  focusedAnnotationId?: string | null;
  mode: "manuscript" | "aligned";
  preserveWritten?: boolean;
}) {
  let tokenCursor = startToken;
  return (
    <>
      {inlines.map((part, inlineIndex) => {
        const pieces: ReactNode[] = [];
        let cursor = 0;
        let match: RegExpExecArray | null;
        PAPER_WORD.lastIndex = 0;
        while ((match = PAPER_WORD.exec(part.text))) {
          if (match.index > cursor) {
            pieces.push(part.text.slice(cursor, match.index));
          }
          const tokenIndex = tokenCursor++;
          const evidence = aligned.get(tokenIndex);
          const tokenAnnotations = annotations.get(tokenIndex) ?? [];
          const annotation = tokenAnnotations.find((candidate) => candidate.status === "open") ?? tokenAnnotations[0];
          const annotationIds = tokenAnnotations.map((candidate) => candidate.id);
          const focused = focusedAnnotationId
            ? annotationIds.includes(focusedAnnotationId)
            : false;
          const written = match[0];
          const display = mode === "aligned" && evidence && !preserveWritten ? evidence.display : written;
          const state = evidence?.state ?? "unmapped";
          const visualState = mode === "aligned" ? state : evidence ? "timed" : "unmapped";
          const evidenceTitle = evidence?.state === "different"
            ? `Written: ${written} · Heard: ${evidence.heard}`
            : evidence?.state === "missing"
              ? `Not heard in this recording: ${written}`
              : undefined;
          const title = tokenAnnotations.length > 0
            ? tokenAnnotations.map((candidate) => candidate.label).join("\n")
            : mode === "aligned" ? evidenceTitle : undefined;
          pieces.push(
            <span
              key={`${inlineIndex}-${tokenIndex}`}
              className={`proof-paper-word ${visualState}${annotation ? ` annotated annotation-${annotation.kind} annotation-${annotation.status}` : ""}${tokenAnnotations.length > 1 ? " annotation-multiple" : ""}${focused ? " annotation-focused" : ""}`}
              data-token-index={tokenIndex}
              data-annotation-ids={annotationIds.join(" ") || undefined}
              aria-label={tokenAnnotations.length > 0 ? `${written}. ${title}` : undefined}
              title={title}
            >
              {display}
            </span>,
          );
          cursor = match.index + match[0].length;
        }
        if (cursor < part.text.length) {
          pieces.push(part.text.slice(cursor));
        }
        const content = <>{pieces}</>;
        if (part.kind === "strong") {
          return <strong key={inlineIndex}>{content}</strong>;
        }
        if (part.kind === "em") {
          return <em key={inlineIndex}>{content}</em>;
        }
        return <span key={inlineIndex}>{content}</span>;
      })}
    </>
  );
}

function inlineTokenCount(inlines: PaperInline[]): number {
  let count = 0;
  for (const part of inlines) {
    PAPER_WORD.lastIndex = 0;
    while (PAPER_WORD.exec(part.text)) {
      count += 1;
    }
  }
  return count;
}

/** Precompute offsets so React's child render order cannot move annotations. */
export function manuscriptBlockTokenOffsets(blocks: PaperBlock[]): number[] {
  let cursor = 0;
  return blocks.map((block) => {
    const start = cursor;
    cursor += inlineTokenCount(block.inlines);
    return start;
  });
}

/**
 * The manuscript stays canonical and selectable. Timed recognition is painted
 * onto its words instead of flattening headings and paragraphs into an ASR wall.
 */
export function ManuscriptProofProse({
  text,
  alignedTokens = [],
  annotations = [],
  focusedAnnotationId = null,
  mode = "manuscript",
  selectable = false,
  onTokenSelection,
}: {
  text: string;
  alignedTokens?: AlignedManuscriptToken[];
  annotations?: ManuscriptProofAnnotation[];
  focusedAnnotationId?: string | null;
  mode?: "manuscript" | "aligned";
  selectable?: boolean;
  onTokenSelection?: (selection: {
    fromToken: number;
    toToken: number;
    actionPosition: SelectionActionPosition;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const blocks = manuscriptBlocks(text);
  const blockTokenOffsets = manuscriptBlockTokenOffsets(blocks);
  const aligned = new Map(alignedTokens.map((token) => [token.tokenIndex, token]));
  const annotationByToken = new Map<number, ManuscriptProofAnnotation[]>();
  for (const annotation of annotations) {
    annotationByToken.set(annotation.tokenIndex, [
      ...(annotationByToken.get(annotation.tokenIndex) ?? []),
      annotation,
    ]);
  }
  const onTokenSelectionRef = useRef(onTokenSelection);
  onTokenSelectionRef.current = onTokenSelection;

  function captureSelection(): void {
    const selectionHandler = onTokenSelectionRef.current;
    if (!selectable || !selectionHandler || !rootRef.current) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!rootRef.current.contains(range.commonAncestorContainer)) {
      return;
    }
    const selected = [...rootRef.current.querySelectorAll<HTMLElement>("[data-token-index]")]
      .filter((element) => range.intersectsNode(element))
      .map((element) => Number(element.dataset.tokenIndex))
      .filter(Number.isFinite);
    if (selected.length === 0) {
      return;
    }
    const clientRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const actionRect = clientRects.at(-1) ?? range.getBoundingClientRect();
    selectionHandler({
      fromToken: Math.min(...selected),
      toToken: Math.max(...selected),
      actionPosition: selectionActionPosition(actionRect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });
  }

  useEffect(() => {
    if (!selectable) {
      return undefined;
    }
    document.addEventListener("selectionchange", captureSelection);
    document.addEventListener("pointerup", captureSelection);
    return () => {
      document.removeEventListener("selectionchange", captureSelection);
      document.removeEventListener("pointerup", captureSelection);
    };
  }, [selectable]);

  if (blocks.length === 0) {
    return <p className="paper-empty">Loading manuscript…</p>;
  }

  return (
    <div
      ref={rootRef}
      className={selectable ? "proof-paper selectable" : "proof-paper"}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
    >
      {blocks.map((block, index) => {
        const marks = (
          <ProofInlineMarks
            inlines={block.inlines}
            startToken={blockTokenOffsets[index]}
            aligned={aligned}
            annotations={annotationByToken}
            focusedAnnotationId={focusedAnnotationId}
            mode={mode}
            preserveWritten={block.kind === "heading"}
          />
        );
        if (block.kind === "heading") {
          const Tag = block.level === 1 ? "h4" : "h5";
          return <Tag key={`${block.kind}-${index}`}>{marks}</Tag>;
        }
        return <p key={`${block.kind}-${index}`}>{marks}</p>;
      })}
    </div>
  );
}
