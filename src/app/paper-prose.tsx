import type { PaperBlock, PaperInline } from "../core/manuscript/paper";
import { manuscriptBlocks, transcriptBlocks } from "../core/manuscript/paper";

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
