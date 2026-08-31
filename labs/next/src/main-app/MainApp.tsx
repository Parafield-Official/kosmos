import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  appendChapter,
  deleteBook,
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
import { defaultChapterStep, type BookTab, type ChapterStep } from "./chapter-flow";
import { LibraryScreen, ConfirmDelete } from "./LibraryScreen";
import { BookShell } from "./BookShell";
import { DashboardScreen } from "./DashboardScreen";
import { ChaptersScreen } from "./ChaptersScreen";
import { PronunciationScreen } from "./PronunciationScreen";
import { ExportAcxScreen } from "./ExportAcxScreen";
import { ChapterWorkspace } from "./ChapterWorkspace";
import { ChapterEditor } from "./ChapterEditor";
import { SettingsScreen } from "./SettingsScreen";
import { VaultReadSheet } from "./vault-media";
import { ThemeAtmosphere } from "./ThemeAtmosphere";
import { THEME_ACCENT_EVENT, accentOption, readThemeAccent, type ThemeAccent, type ThemeAccentOption } from "./theme";
import "./main-app.css";

type WorkScreen =
  | { name: "library" }
  | { name: "book"; project: BookProject; tab: BookTab }
  | { name: "chapter"; project: BookProject; chapterId: string; step: ChapterStep }
  | { name: "editor"; project: BookProject; chapterId: string }
  | { name: "reader"; project: BookProject; chapterId: string };

type MainScreen = WorkScreen | { name: "settings"; from: WorkScreen };

type Analyzing = { progress: number; label: string } | null;

function withProject(screen: WorkScreen, project: BookProject): WorkScreen {
  if (screen.name === "library") {
    return screen;
  }
  return { ...screen, project };
}

function vaultHosts(): boolean {
  return true;
}

export function MainApp() {
  const [screen, setScreen] = useState<MainScreen>({ name: "library" });
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>(() => readThemeAccent());
  const [themePaint, setThemePaint] = useState<ThemeAccentOption>(() => accentOption(readThemeAccent()));
  const [analyzing, setAnalyzing] = useState<Analyzing>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onThemeAccent = (event: Event) => {
      const option = (event as CustomEvent<ThemeAccentOption>).detail;
      setThemeAccent(option.value);
      setThemePaint(option);
    };
    window.addEventListener(THEME_ACCENT_EVENT, onThemeAccent);
    return () => window.removeEventListener(THEME_ACCENT_EVENT, onThemeAccent);
  }, []);

  const openProject = useCallback((project: BookProject, tab: BookTab = "dashboard") => {
    setScreen({ name: "book", project, tab });
  }, []);

  const openLibrary = useCallback(() => {
    setScreen({ name: "library" });
  }, []);

  const openChapter = useCallback((project: BookProject, chapterId: string, step?: ChapterStep) => {
    const chapter = project.chapters.find((item) => item.id === chapterId);
    setScreen({
      name: "chapter",
      project,
      chapterId,
      step: step ?? (chapter ? defaultChapterStep(chapter) : "recording"),
    });
  }, []);

  const openEditor = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "editor", project, chapterId });
  }, []);

  const openReader = useCallback((project: BookProject, chapterId: string) => {
    setScreen({ name: "reader", project, chapterId });
  }, []);

  const openSettings = useCallback(() => {
    setScreen((current) => (current.name === "settings" ? current : { name: "settings", from: current }));
  }, []);

  const commit = useCallback(async (next: BookProject) => {
    setScreen((current) => {
      if (current.name === "library") {
        return current;
      }
      if (current.name === "settings") {
        if (current.from.name === "library") {
          return current;
        }
        return { ...current, from: withProject(current.from, next) };
      }
      return withProject(current, next);
    });
    try {
      const saved = await persistBook(next);
      setScreen((current) => {
        if (current.name === "library") {
          return current;
        }
        if (current.name === "settings") {
          if (current.from.name === "library") {
            return current;
          }
          return { ...current, from: withProject(current.from, saved) };
        }
        return withProject(current, saved);
      });
      return saved;
    } catch {
      return next;
    }
  }, []);

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
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
      const saved = await persistBook(scanGlossaryFromManuscript(next, manuscript));
      setScreen((current) => {
        if (current.name === "book" && current.project.id === saved.id) {
          return { name: "book", project: saved, tab: "chapters" };
        }
        if (current.name === "chapter" && current.project.id === saved.id) {
          return { ...current, project: saved };
        }
        return current;
      });
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
          current.name === "book" && current.project.id === next.id
            ? { name: "book", project: next, tab: current.tab }
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
      setScreen({ name: "book", project, tab: "dashboard" });
      if (file) {
        await analyzeAndApply(project, file);
      }
    },
    [analyzeAndApply],
  );

  const themeStyle = {
    "--ma-accent": themePaint.hex,
    "--ma-accent-rgb": themePaint.rgb,
  } as CSSProperties;

  const hosted = vaultHosts();
  const pane = screen.name === "library" ? "home" : "glass";
  const nav = screen.name === "settings" ? "settings" : screen.name === "library" ? "home" : "none";

  let overlay: ReactNode = null;
  if (screen.name === "settings") {
    overlay = <SettingsScreen onBack={() => setScreen(screen.from)} />;
  } else if (screen.name === "chapter") {
    overlay = (
      <ChapterWorkspace
        project={screen.project}
        chapterId={screen.chapterId}
        step={screen.step}
        onStep={(step) => setScreen({ ...screen, step })}
        onBack={() => openProject(screen.project, "chapters")}
        onChange={(next) => void commit(next)}
        onNextChapter={() => {
          const index = screen.project.chapters.findIndex((item) => item.id === screen.chapterId);
          const next = screen.project.chapters[index + 1];
          if (next) {
            openChapter(screen.project, next.id);
          } else {
            openProject(screen.project, "chapters");
          }
        }}
      />
    );
  } else if (screen.name === "editor") {
    overlay = (
      <ChapterEditor
        project={screen.project}
        chapterId={screen.chapterId}
        onBack={() => openProject(screen.project, "chapters")}
        onChange={(next) => void commit(next)}
      />
    );
  } else if (screen.name === "reader") {
    overlay = (
      <VaultReadSheet
        project={screen.project}
        chapterId={screen.chapterId}
        fill
        onBack={() => openProject(screen.project, "chapters")}
      />
    );
  } else if (screen.name === "book") {
    overlay = (
      <BookShell
        project={screen.project}
        tab={screen.tab}
        onTab={(tab) => setScreen({ name: "book", project: screen.project, tab })}
        onBack={openLibrary}
        onDelete={() => setDeleteTarget(screen.project)}
      >
        {screen.tab === "dashboard" ? (
          <DashboardScreen
            project={screen.project}
            onChange={(next) => void commit(next)}
            onGoChapters={() => setScreen({ name: "book", project: screen.project, tab: "chapters" })}
            onAnalyze={() => void analyzeAndApply(screen.project)}
            onChooseManuscript={(file) => void chooseManuscript(screen.project, file)}
            analyzeError={analyzeError}
          />
        ) : null}
        {screen.tab === "chapters" ? (
          <ChaptersScreen
            project={screen.project}
            onOpenChapter={(chapterId) => openChapter(screen.project, chapterId)}
            onEditChapter={(chapterId) => openEditor(screen.project, chapterId)}
            onRead={(chapterId) => openReader(screen.project, chapterId)}
            onAddChapter={(title) => void commit(appendChapter(screen.project, title))}
            onChange={(next) => void commit(next)}
            onOpenExport={() => setScreen({ name: "book", project: screen.project, tab: "export" })}
          />
        ) : null}
        {screen.tab === "pronunciation" ? (
          <PronunciationScreen project={screen.project} onChange={(next) => void commit(next)} />
        ) : null}
        {screen.tab === "export" ? (
          <ExportAcxScreen project={screen.project} onChange={(next) => void commit(next)} />
        ) : null}
      </BookShell>
    );
  }

  return (
    <div className="main-app" data-screen={screen.name} data-theme-accent={themeAccent} style={themeStyle}>
      <ThemeAtmosphere />

      {hosted ? (
        <LibraryScreen
          pane={pane}
          nav={nav}
          overlay={overlay}
          onOpen={openProject}
          onCreated={onCreatedBook}
          onSettings={openSettings}
          onHome={openLibrary}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDelete
          project={deleteTarget}
          busy={deleting}
          onCancel={() => {
            if (!deleting) {
              setDeleteTarget(null);
            }
          }}
          onConfirm={() => {
            void (async () => {
              setDeleting(true);
              try {
                await deleteBook(deleteTarget);
                setDeleteTarget(null);
                openLibrary();
                window.dispatchEvent(new Event("kosmos-workspace-changed"));
              } finally {
                setDeleting(false);
              }
            })();
          }}
        />
      ) : null}

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
