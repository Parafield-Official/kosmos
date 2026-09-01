import { useEffect, useMemo, useRef, useState } from "react";
import { readChapterContent, type BookProject } from "./store";

/** An ebook-style reader: clean typography, chapter nav, read-only. */
export function ReaderScreen({
  project,
  chapterId,
  onBack,
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
}) {
  const initialIndex = Math.max(
    0,
    project.chapters.findIndex((chapter) => chapter.id === chapterId),
  );
  const [index, setIndex] = useState(initialIndex);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chapter = project.chapters[index] ?? null;
  const chapterKey = chapter?.id;

  const toc = useMemo(() => project.chapters.map((c, i) => ({ id: c.id, title: c.title, index: i })), [project.chapters]);

  useEffect(() => {
    if (!chapterKey) {
      return;
    }
    let alive = true;
    setLoading(true);
    void readChapterContent(project, chapterKey).then((content) => {
      if (!alive) {
        return;
      }
      setHtml(content);
      setLoading(false);
      scrollRef.current?.scrollTo({ top: 0 });
    });
    return () => {
      alive = false;
    };
  }, [project, chapterKey]);

  function go(delta: number) {
    setIndex((current) => Math.min(project.chapters.length - 1, Math.max(0, current + delta)));
  }

  return (
    <section className="ma-screen ma-reader" aria-label={`Reading ${project.title}`}>
      <header className="ma-reader-head">
        <button type="button" className="ma-back" onClick={onBack} aria-label="Back to overview">
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <button
          type="button"
          className="ma-reader-toc-toggle"
          onClick={() => setTocOpen((open) => !open)}
          aria-expanded={tocOpen}
        >
          Contents
        </button>
      </header>

      <div className="ma-reader-body">
        {tocOpen ? (
          <nav className="ma-reader-toc neu-inset" aria-label="Table of contents">
            {toc.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.index === index ? "ma-toc-item is-active" : "ma-toc-item"}
                onClick={() => {
                  setIndex(item.index);
                  setTocOpen(false);
                }}
              >
                <span className="ma-toc-index">{String(item.index + 1).padStart(2, "0")}</span>
                <span className="ma-toc-title">{item.title}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="ma-reader-page" ref={scrollRef}>
          <article className="ma-reader-doc">
            <p className="ma-reader-kicker">
              Chapter {index + 1} of {project.chapters.length}
            </p>
            <h1 className="ma-reader-title">{chapter?.title ?? "Untitled"}</h1>
            {loading ? (
              <p className="ma-reader-empty">Loading…</p>
            ) : html.trim() ? (
              <div className="ma-prose ma-prose-read" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="ma-reader-empty">This chapter has no text yet. Analyze the manuscript or edit it to add content.</p>
            )}
          </article>
        </div>
      </div>

      <footer className="ma-reader-foot">
        <button type="button" className="btn" onClick={() => go(-1)} disabled={index === 0}>
          Previous
        </button>
        <span className="ma-reader-progress">
          {index + 1} / {project.chapters.length}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => go(1)}
          disabled={index >= project.chapters.length - 1}
        >
          Next
        </button>
      </footer>
    </section>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
