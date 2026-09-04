import { useEffect, useMemo, useRef, useState } from "react";
import {
  countHtmlWords,
  readChapterContent,
  saveChapterContent,
  stageChapterContent,
  type BookProject,
} from "./store";
import { READING_FONT_STACKS, readPromptTheme, readReadingFont } from "./reading-prefs";

/**
 * Document-style chapter editor. Not a plain textbox: a contentEditable surface
 * with a small formatting toolbar, autosaving the chapter's rich text and
 * keeping the word count in sync.
 */
export function ChapterEditor({
  project,
  chapterId,
  onBack,
  onChange,
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
  onChange: (next: BookProject) => void;
}) {
  const chapter = useMemo(
    () => project.chapters.find((item) => item.id === chapterId) ?? null,
    [project, chapterId],
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [words, setWords] = useState(chapter?.wordCount ?? 0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [chapterTitle, setChapterTitle] = useState(chapter?.title ?? "");
  const [theme] = useState(readPromptTheme);
  const [readingFont] = useState(readReadingFont);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void readChapterContent(project, chapterId).then((html) => {
      if (!alive) {
        return;
      }
      if (editorRef.current) {
        editorRef.current.innerHTML = dropMatchingLeadHeading(html, chapter?.title) || "<p><br></p>";
      }
      setWords(countHtmlWords(html));
      setLoaded(true);
    });
    return () => {
      alive = false;
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [project.id, chapterId]);

  useEffect(() => {
    setChapterTitle(chapter?.title ?? "");
  }, [chapter?.id, chapter?.title]);

  function saveChapterTitle(raw = chapterTitle) {
    if (!chapter) {
      return;
    }
    const next = raw.trim() || "Untitled chapter";
    setChapterTitle(next);
    if (next !== chapter.title) {
      onChange({
        ...project,
        chapters: project.chapters.map((item) => (item.id === chapterId ? { ...item, title: next } : item)),
      });
    }
  }

  function scheduleSave() {
    setStatus("saving");
    stageChapterContent(project, chapterId, editorRef.current?.innerHTML ?? "");
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => void flush(), 700);
  }

  async function flush() {
    const html = editorRef.current?.innerHTML ?? "";
    const wordCount = countHtmlWords(html);
    setWords(wordCount);
    await saveChapterContent(project, chapterId, html);
    if (chapter && chapter.wordCount !== wordCount) {
      onChange({
        ...project,
        chapters: project.chapters.map((item) =>
          item.id === chapterId ? { ...item, wordCount } : item,
        ),
      });
    }
    setStatus("saved");
  }

  function format(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    scheduleSave();
  }

  if (!chapter) {
    return (
      <section className="ma-screen ma-editor" aria-label="Chapter editor">
        <button type="button" className="ma-back" onClick={onBack}>
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <p className="ma-chapter-empty">This chapter no longer exists.</p>
      </section>
    );
  }

  return (
    <section className="ma-screen ma-editor quest-sheet" aria-label={`Editing ${chapter.title}`}>
      <header className="quest-sheet-head">
        <button type="button" className="vault-media-back" onClick={onBack} aria-label="Back to chapters">
          <ChevronLeft />
          <span>Back</span>
        </button>
        <h2 className="vault-read-chapter-name">
          <input
            className="ma-title-input"
            value={chapterTitle}
            aria-label="Chapter title"
            onChange={(event) => {
              const value = event.target.value;
              setChapterTitle(value);
              const next = value.trim();
              if (chapter && next && next !== chapter.title) {
                onChange({
                  ...project,
                  chapters: project.chapters.map((item) => (item.id === chapterId ? { ...item, title: next } : item)),
                });
              }
            }}
            onBlur={(event) => saveChapterTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setChapterTitle(chapter.title);
                event.currentTarget.blur();
              }
            }}
          />
        </h2>
        <span className="ma-editor-status">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </header>

      <div className="ma-editor-bar" role="toolbar" aria-label="Formatting">
        <button type="button" className="ma-tool" onClick={() => format("bold")} title="Bold" aria-label="Bold">
          <strong>B</strong>
        </button>
        <button type="button" className="ma-tool" onClick={() => format("italic")} title="Italic" aria-label="Italic">
          <em>I</em>
        </button>
        <span className="ma-tool-sep" />
        <button type="button" className="ma-tool" onClick={() => format("formatBlock", "H2")} title="Heading">
          H
        </button>
        <button type="button" className="ma-tool" onClick={() => format("formatBlock", "P")} title="Body text">
          ¶
        </button>
        <span className="ma-tool-sep" />
        <button
          type="button"
          className="ma-tool"
          onClick={() => format("insertUnorderedList")}
          title="Bulleted list"
        >
          •
        </button>
        <span className="ma-editor-count">{words.toLocaleString()} words</span>
      </div>

      <div className={`ma-editor-page ma-paper is-${theme}`} style={{ fontFamily: READING_FONT_STACKS[readingFont] }}>
        <div
          ref={editorRef}
          className="ma-prose ma-prose-edit"
          contentEditable={loaded}
          suppressContentEditableWarning
          spellCheck
          onInput={scheduleSave}
          onBlur={() => void flush()}
        />
      </div>
    </section>
  );
}

function dropMatchingLeadHeading(html: string, title?: string): string {
  const name = title?.trim();
  if (!html || !name) {
    return html;
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const first = wrap.querySelector("h1, h2, h3");
  if (first && first.textContent?.trim() === name) {
    first.remove();
  }
  return wrap.innerHTML.trim() || html;
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
