import { useCallback, useState } from "react";
import {
  appendChapter,
  persistBook,
  readManuscriptBytes,
  writeChapterContents,
  writeManuscript,
  type BookProject,
} from "./store";
import { analyzeFile, analyzeSource, manuscriptSource } from "./analyze";
import { paragraphsFromHtml } from "./booth";
import { scanGlossaryFromManuscript } from "./glossary";
import { manuscriptMetaFromBytes } from "./manuscript-meta";
import { LibraryScreen } from "./LibraryScreen";
import { OverviewScreen } from "./OverviewScreen";
import { ChapterScreen } from "./ChapterScreen";
import { ChapterEditor } from "./ChapterEditor";
import { ReaderScreen } from "./ReaderScreen";
import { RecordScreen } from "./RecordScreen";
import { ReviewScreen } from "./ReviewScreen";
import { SettingsScreen } from "./SettingsScreen";
import "./main-app.css";

type WorkScreen =
  | { name: "library" }
  | { name: "overview"; project: BookProject }
  | { name: "chapter"; project: BookProject; chapterId: string }
  | { name: "editor"; project: BookProject; chapterId: string }
  | { name: "reader"; project: BookProject; chapterId: string }
  | { name: "record"; project: BookProject; chapterId: string }
  | { name: "review"; project: BookProject; chapterId: string };

type MainScreen = WorkScreen | { name: "settings"; from: WorkScreen };

type Analyzing = { progress: number; label: string } | null;

export function MainApp() {
  // Always land on the Library (start screen) each launch, Xcode-style.
  const [screen, setScreen] = useState<MainScreen>({ name: "library" });
  const [analyzing, setAnalyzing] = useState<Analyzing>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const openProject = useCallback((project: BookProject) => {
    setScreen({ name: "overview", project });
  }, []);

  const openLibrary = useCallback(() => {
    setScreen({ name: "library" });
  }, []);

  const openChapter = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "chapter", project, chapterId });
  }, []);

  const openEditor = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "editor", project, chapterId });
  }, []);

  const openReader = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "reader", project, chapterId });
  }, []);

  const openRecord = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "record", project, chapterId });
  }, []);

  const openReview = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "review", project, chapterId });
  }, []);

  const openSettings = useCallback(() => {
    setScreen((current) => (current.name === "settings" ? current : { name: "settings", from: current }));
  }, []);

  const commit = useCallback(async (next: BookProject) => {
    const saved = await persistBook(next);
    setScreen((current) => {
      if (current.name === "overview") {
        return { name: "overview", project: saved };
      }
      if (
        current.name === "chapter" ||
        current.name === "editor" ||
        current.name === "reader" ||
        current.name === "record" ||
        current.name === "review"
      ) {
        return { ...current, project: saved };
      }
      return current;
    });
    return saved;
  }, []);

  /** Parse a manuscript into chapters (from an upload or from disk), with progress. */
  const analyzeAndApply = useCallback(async (project: BookProject, file?: File) => {
    setAnalyzeError(null);
    setAnalyzing({ progress: 0, label: "Reading manuscript…" });
    try {
      const report = (fraction: number, label: string) =>
        setAnalyzing({ progress: fraction, label: `Parsing “${label}”` });
      let result;
      if (file) {
        result = await analyzeFile(file, report);
      } else {
        const manuscript = await readManuscriptBytes(project);
        const source = manuscript ? manuscriptSource(manuscript.name, manuscript.bytes) : null;
        if (!source) {
          throw new Error(
            manuscript && /\.pdf$/i.test(manuscript.name)
              ? "PDF manuscripts need a text layer. Try .txt, .md, .docx, or .epub."
              : "Kosmos couldn't read that manuscript. Try a .txt, .md, .docx, or .epub.",
          );
        }
        result = await analyzeSource(source, report);
      }
      if (!result.chapters.length) {
        throw new Error("Kosmos couldn't find chapter text in that manuscript.");
      }
      let patch: BookProject = { ...project, chapters: result.chapters };
      // Backfill the author from the manuscript's own metadata when the book
      // was created without one (older imports, or a manuscript picked before
      // the field was filled). Never overwrite an author the user already set.
      if (!project.author.trim()) {
        const source = file
          ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
          : await readManuscriptBytes(project);
        const meta = source ? manuscriptMetaFromBytes(source.name, source.bytes) : {};
        if (meta.authors?.length) {
          patch = { ...patch, author: meta.authors.join(", ") };
        }
      }
      const next = await persistBook(patch);
      await writeChapterContents(next, result.contents);
      const manuscript = result.contents
        .map((item) => paragraphsFromHtml(item.html).join("\n"))
        .join("\n\n");
      const saved = await persistBook(scanGlossaryFromManuscript(next, manuscript));
      setScreen((current) =>
        current.name === "overview" && current.project.id === saved.id
          ? { name: "overview", project: saved }
          : current,
      );
      return saved;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not read that manuscript.";
      setAnalyzeError(message);
      return project;
    } finally {
      setAnalyzing(null);
    }
  }, []);

  const chooseManuscript = useCallback(
    async (project: BookProject, file: File) => {
      setAnalyzeError(null);
      try {
        const name = await writeManuscript(project.folder, file);
        const next = await persistBook({ ...project, manuscript: name ?? file.name });
        setScreen((current) =>
          current.name === "overview" && current.project.id === next.id
            ? { name: "overview", project: next }
            : current,
        );
        await analyzeAndApply(next, file);
      } catch (reason) {
        setAnalyzeError(reason instanceof Error ? reason.message : "Could not open that manuscript.");
      }
    },
    [analyzeAndApply],
  );

  const onCreatedBook = useCallback(
    async (project: BookProject, file?: File) => {
      setScreen({ name: "overview", project });
      if (file) {
        await analyzeAndApply(project, file);
      }
    },
    [analyzeAndApply],
  );

  return (
    <div className="main-app" data-screen={screen.name}>
      {screen.name !== "settings" && screen.name !== "record" ? (
        <button type="button" className="ma-gear" aria-label="Settings" onClick={openSettings}>
          <GearIcon />
        </button>
      ) : null}

      {screen.name === "library" ? (
        <LibraryScreen onOpen={openProject} onCreated={onCreatedBook} />
      ) : null}

      {screen.name === "overview" ? (
        <OverviewScreen
          project={screen.project}
          onBack={openLibrary}
          onOpenChapter={(chapterId) => openChapter(screen.project, chapterId)}
          onEditChapter={(chapterId) => openEditor(screen.project, chapterId)}
          onRead={(chapterId) => openReader(screen.project, chapterId)}
          onAddChapter={(title) => void commit(appendChapter(screen.project, title))}
          onAnalyze={() => void analyzeAndApply(screen.project)}
          onChooseManuscript={(file) => void chooseManuscript(screen.project, file)}
          onChange={(next) => void commit(next)}
          analyzeError={analyzeError}
        />
      ) : null}

      {screen.name === "chapter" ? (
        <ChapterScreen
          project={screen.project}
          chapterId={screen.chapterId}
          onBack={() => openProject(screen.project)}
          onEdit={() => openEditor(screen.project, screen.chapterId)}
          onRead={() => openReader(screen.project, screen.chapterId)}
          onRecord={() => openRecord(screen.project, screen.chapterId)}
          onReview={() => openReview(screen.project, screen.chapterId)}
          onChange={(next) => void commit(next)}
        />
      ) : null}

      {screen.name === "record" ? (
        <RecordScreen
          project={screen.project}
          chapterId={screen.chapterId}
          onBack={() => openChapter(screen.project, screen.chapterId)}
          onChange={(next) => void commit(next)}
        />
      ) : null}

      {screen.name === "review" ? (
        <ReviewScreen
          project={screen.project}
          chapterId={screen.chapterId}
          onBack={() => openChapter(screen.project, screen.chapterId)}
          onChange={(next) => void commit(next)}
        />
      ) : null}

      {screen.name === "editor" ? (
        <ChapterEditor
          project={screen.project}
          chapterId={screen.chapterId}
          onBack={() => openProject(screen.project)}
          onChange={(next) => void commit(next)}
        />
      ) : null}

      {screen.name === "reader" ? (
        <ReaderScreen
          project={screen.project}
          chapterId={screen.chapterId}
          onBack={() => openProject(screen.project)}
        />
      ) : null}

      {screen.name === "settings" ? <SettingsScreen onBack={() => setScreen(screen.from)} /> : null}

      {analyzing ? <AnalyzingOverlay progress={analyzing.progress} label={analyzing.label} /> : null}
    </div>
  );
}

function AnalyzingOverlay({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="ma-analyze-scrim" role="status" aria-live="polite">
      <div className="ma-analyze neu-panel">
        <h2 className="ma-analyze-title">Analyzing your book</h2>
        <p className="ma-analyze-label">{label}</p>
        <span className="ma-progress ma-progress-lg">
          <span className="ma-progress-fill" style={{ width: `${pct}%` }} />
        </span>
        <p className="ma-analyze-pct">{pct}%</p>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
