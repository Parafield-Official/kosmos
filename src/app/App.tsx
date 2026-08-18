import { useEffect, useMemo, useRef, useState } from "react";
import { measurePcm, type AcxReport } from "../core/acx/measure";
import { alignTranscript, type TranscriptWord } from "../core/proof/align";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  renameGlossaryEntry,
} from "../core/glossary/candidates";
import { addChapter, createEmptyProject } from "../core/project/project";
import {
  addChapterNote,
  canApproveChapters,
  setChapterAuthorStatus,
} from "../core/project/collaboration";
import type {
  AuthorStatus,
  ChapterFile,
  GlossaryEntry,
  Pickup,
  ProjectFile,
} from "../core/project/types";

interface ProjectEnvelope {
  folder: string;
  project: ProjectFile;
}

interface ProofResult {
  pickups: Pickup[];
  transcript: TranscriptWord[];
}

type ProjectPanel = "chapters" | "glossary" | "collaboration";

export function App() {
  const [project, setProject] = useState<ProjectEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge) {
      return;
    }

    void bridge.reopenRecentProject().then((recent) => {
      if (recent) {
        setProject(recent);
      }
    }).catch((reason: unknown) => {
      setError(messageFor(reason, "Could not reopen the last project."));
    });
  }, []);

  async function chooseProject(action: "new" | "open") {
    setBusy(true);
    setError(null);

    try {
      const bridge = window.boothDesk;
      const result = bridge
        ? await (action === "new" ? bridge.newProject() : bridge.openProject())
        : {
            folder: "(browser preview)",
            project: createEmptyProject("Untitled project"),
          };

      if (result) {
        setProject(result);
      }
    } catch (reason) {
      setError(messageFor(reason, "Could not open that project."));
    } finally {
      setBusy(false);
    }
  }

  if (project) {
    return (
      <ProjectHome
        envelope={project}
        onClose={() => setProject(null)}
        onChange={setProject}
      />
    );
  }

  return (
    <main className="app-shell">
      <AppHeader eyebrow="Offline audiobook workspace" title="Booth Desk" />

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="phase-label">Phase 0 · Foundation</p>
          <h2 id="welcome-title">Keep the page and the take together.</h2>
          <p className="lede">
            Create a project folder for one book. Booth Desk keeps its script,
            human recordings, pickups, and ACX checks together on disk.
          </p>

          <PrivacyNote />

          <div className="actions" aria-label="Project actions">
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void chooseProject("new")}
            >
              {busy ? "Opening…" : "New project"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void chooseProject("open")}
            >
              Open project
            </button>
          </div>
          {error ? <p className="error-note">{error}</p> : null}
        </div>

        <aside className="desk-card" aria-label="What Booth Desk checks">
          <p className="card-kicker">Built for the handoff</p>
          <h3>Manuscript → pickups → ACX pack</h3>
          <ol>
            <li>
              <span>01</span>
              Attach the page and the chapter take.
            </li>
            <li>
              <span>02</span>
              Find words that do not match the page.
            </li>
            <li>
              <span>03</span>
              Check measurable ACX requirements.
            </li>
          </ol>
          <p className="honesty-copy">
            Word mismatches only. Listen once for acting and noise.
          </p>
        </aside>
      </section>

      <AppFooter />
    </main>
  );
}

function ProjectHome({
  envelope,
  onClose,
  onChange,
}: {
  envelope: ProjectEnvelope;
  onClose: () => void;
  onChange: (next: ProjectEnvelope) => void;
}) {
  const { project, folder } = envelope;
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    project.chapters[0]?.id ?? null,
  );
  const [chapterText, setChapterText] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("Chapter 1");
  const [pastedText, setPastedText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [exportResult, setExportResult] = useState<AcxExportResult | null>(null);
  const [activePanel, setActivePanel] = useState<ProjectPanel>("chapters");
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityRole, setIdentityRole] = useState<"author" | "narrator">("author");
  const [identitySeat, setIdentitySeat] = useState<"N1" | "N2">("N1");
  const [lightPack, setLightPack] = useState(true);
  const [glossarySpelling, setGlossarySpelling] = useState("");
  const [glossaryRespell, setGlossaryRespell] = useState("");
  const [chapterNote, setChapterNote] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedChapter = useMemo(
    () => project.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [project.chapters, selectedChapterId],
  );

  useEffect(() => {
    if (!selectedChapter && project.chapters.length > 0) {
      setSelectedChapterId(project.chapters[0].id);
    }
  }, [project.chapters, selectedChapter]);

  useEffect(() => {
    setProof(null);
    setAcxReport(null);
    setTranscriptText("");
    setNotice(null);
    setChapterText("");

    if (!selectedChapter) {
      return;
    }

    if (!window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void window.boothDesk.readChapterText({ ...envelope, chapterId: selectedChapter.id })
      .then((result) => setChapterText(result.text))
      .catch((reason: unknown) => setNotice(messageFor(reason, "Could not read the chapter text.")));
  }, [selectedChapter?.id, folder]);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    setAudioUrl(null);
    if (!selectedChapter?.audio_path || !window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void window.boothDesk.readAudio({ folder, relativePath: selectedChapter.audio_path })
      .then(({ mime, base64 }) => {
        if (disposed) {
          return;
        }
        const bytes = base64ToBytes(base64);
        const blobBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        objectUrl = URL.createObjectURL(new Blob([blobBuffer], { type: mime }));
        setAudioUrl(objectUrl);
      })
      .catch((reason: unknown) => setNotice(messageFor(reason, "Could not load the attached audio.")));

    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedChapter?.audio_path, folder]);

  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge) {
      return;
    }
    void bridge.modelStatus().then((status) => setModelAvailable(status.available)).catch(() => setModelAvailable(false));
    return bridge.onModelProgress((progress) => {
      setModelProgress(progress.fraction);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    setIdentityLoaded(false);
    const firstPerson = project.people[0];
    if (!window.boothDesk || folder === "(browser preview)") {
      setIdentity(null);
      setIdentityName(firstPerson?.name ?? "");
      setIdentityRole(firstPerson?.role ?? "author");
      setIdentitySeat(firstPerson?.seat ?? "N1");
      setIdentityLoaded(true);
      return;
    }

    void window.boothDesk.getIdentity(project.id)
      .then((current) => {
        if (disposed) {
          return;
        }
        setIdentity(current);
        setIdentityName(current?.personName ?? firstPerson?.name ?? "");
        setIdentityRole(current?.role ?? firstPerson?.role ?? "author");
        setIdentitySeat(current?.seat ?? firstPerson?.seat ?? "N1");
        setIdentityLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setIdentityLoaded(true);
          setNotice(messageFor(reason, "Could not load the local collaborator identity."));
        }
      });
    return () => {
      disposed = true;
    };
  }, [project.id, folder]);

  async function importChapter() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setComposerOpen(true);
      return;
    }

    await runAction("import", async () => {
      const result = await window.boothDesk?.importText(envelope);
      if (result) {
        onChange(result);
        const chapter = result.chapters[0] ?? result.project.chapters[result.project.chapters.length - 1];
        if (chapter) {
          setSelectedChapterId(chapter.id);
        }
        setNotice(
          `${result.chapters.length} ${result.chapters.length === 1 ? "chapter" : "chapters"} imported. `
          + `${result.project.glossary?.length ?? 0} glossary candidates need a human check.`,
        );
      }
    });
  }

  async function addPastedChapter() {
    if (pastedText.trim().length === 0) {
      setNotice("Paste at least one line of manuscript text.");
      return;
    }

    await runAction("paste", async () => {
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.pasteText({
          ...envelope,
          title: chapterTitle,
          text: pastedText,
        });
        onChange(result);
        const chapter = result.project.chapters[result.project.chapters.length - 1];
        setSelectedChapterId(chapter.id);
      } else {
        const index = project.chapters.length + 1;
        const chapter: ChapterFile = {
          id: `ch${String(index).padStart(2, "0")}`,
          index,
          title: chapterTitle || `Chapter ${index}`,
          text_path: `manuscript/chapters/${String(index).padStart(2, "0")}.json`,
          pickups_path: `alignment/${String(index).padStart(2, "0")}.json`,
          author_status: "draft",
        };
        onChange({ folder, project: addChapter(project, chapter) });
        setSelectedChapterId(chapter.id);
        setChapterText(pastedText);
      }
      setPastedText("");
      setComposerOpen(false);
    });
  }

  async function loadExample() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("The packaged proof fixture is available in the desktop app.");
      return;
    }
    await runAction("example", async () => {
      const result = await window.boothDesk?.loadExample(envelope);
      if (!result) {
        return;
      }
      onChange({ folder: result.folder, project: result.project });
      setSelectedChapterId(result.chapter.id);
      setTranscriptText(result.transcriptText);
      setNotice("Proof fixture loaded. Click Proof chapter to find the deliberate on → in substitution.");
    });
  }

  async function attachAudio(chapter: ChapterFile) {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Audio attachment is available in the desktop app.");
      return;
    }

    await runAction(`attach-${chapter.id}`, async () => {
      const result = await window.boothDesk?.attachAudio({ ...envelope, chapterId: chapter.id });
      if (result) {
        onChange({ folder: result.folder, project: result.project });
        setSelectedChapterId(chapter.id);
      }
    });
  }

  async function runAcxCheck(chapter: ChapterFile) {
    if (!chapter.audio_path || !window.boothDesk) {
      setNotice("Attach an audio file before running the ACX check.");
      return;
    }

    await runAction(`meter-${chapter.id}`, async () => {
      const decoded = await window.boothDesk?.decodeAudio({
        folder,
        relativePath: chapter.audio_path as string,
      });
      if (!decoded) {
        return;
      }
      const samples = float32FromBase64(decoded.pcmBase64);
      setAcxReport(measurePcm({
        samples,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        format: decoded.format,
      }));
    });
  }

  async function runProof(chapter: ChapterFile) {
    if (!chapter.audio_path) {
      setNotice("Attach the chapter audio before proofing.");
      return;
    }
    if (chapterText.trim().length === 0) {
      setNotice("This chapter has no manuscript text to compare.");
      return;
    }
    await runAction(`proof-${chapter.id}`, async () => {
      let duration = audioRef.current?.duration;
      if ((!duration || !Number.isFinite(duration)) && window.boothDesk) {
        const decoded = await window.boothDesk.decodeAudio({
          folder,
          relativePath: chapter.audio_path as string,
        });
        duration = decoded.durationSeconds;
      }
      let transcript: TranscriptWord[];
      if (transcriptText.trim().length > 0) {
        transcript = timedTranscript(transcriptText, duration || 1);
      } else if (window.boothDesk) {
        const local = await window.boothDesk.transcribe({
          folder,
          relativePath: chapter.audio_path as string,
          language: "en",
        });
        transcript = local.words;
        setTranscriptText(local.words.map((word) => word.text).join(" "));
      } else {
        throw new Error("The browser preview cannot run local Whisper. Open the desktop build or paste a transcript.");
      }
      const result = alignTranscript({
        chapterId: chapter.id,
        manuscript: chapterText,
        transcript,
        durationSeconds: duration || 1,
      });
      setProof({ pickups: result.pickups, transcript });
      setNotice(
        result.pickups.length === 0
          ? "No word mismatches found in this transcript. Listen once for acting and noise."
          : `${result.pickups.length} word ${result.pickups.length === 1 ? "mismatch" : "mismatches"} found.`,
      );
    });
  }

  async function downloadWhisperModel() {
    if (!window.boothDesk) {
      return;
    }
    await runAction("model", async () => {
      setModelProgress(0);
      const status = await window.boothDesk?.downloadModel();
      setModelAvailable(Boolean(status?.available));
      setModelProgress(1);
      setNotice("Whisper is ready. Proof stays on this computer.");
    });
  }

  async function exportAcx() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("ACX export is available in the desktop app after the master core is built.");
      return;
    }
    await runAction("export", async () => {
      const result = await window.boothDesk?.exportAcx(envelope);
      if (result) {
        setExportResult(result);
        setNotice(`ACX pack written to ${result.folder}. Review REPORT.txt and listen once.`);
      }
    });
  }

  async function persistProject(nextProject: ProjectFile): Promise<void> {
    const nextEnvelope = window.boothDesk && folder !== "(browser preview)"
      ? await window.boothDesk.saveProject({ folder, project: nextProject })
      : { folder, project: nextProject };
    onChange(nextEnvelope);
  }

  async function saveLocalIdentity() {
    const cleanName = identityName.trim();
    if (cleanName.length === 0) {
      setNotice("Enter the name you use in this shared project.");
      return;
    }
    await runAction("identity", async () => {
      const nextIdentity: LocalIdentity = {
        projectId: project.id,
        personName: cleanName,
        role: identityRole,
        ...(identityRole === "narrator" ? { seat: identitySeat } : {}),
      };
      const existing = project.people.filter((person) => person.name.toLocaleLowerCase() !== cleanName.toLocaleLowerCase());
      const nextProject: ProjectFile = {
        ...project,
        people: [
          ...existing,
          {
            name: cleanName,
            role: identityRole,
            ...(identityRole === "narrator" ? { seat: identitySeat } : {}),
          },
        ],
        updated_at: new Date().toISOString(),
      };
      await persistProject(nextProject);
      if (window.boothDesk && folder !== "(browser preview)") {
        await window.boothDesk.setIdentity(nextIdentity);
      }
      setIdentity(nextIdentity);
      setNotice("Your local role is saved. It is kept outside the shared project folder.");
    });
  }

  async function shareProject() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Collaborator ZIP export is available in the desktop app.");
      return;
    }
    await runAction("share", async () => {
      const result = await window.boothDesk?.shareZip({ ...envelope, lightPack });
      if (result) {
        setNotice(
          `${lightPack ? "Light " : "Full "}collaborator pack written: ${result.outputPath} `
          + `(${result.fileCount} files).`,
        );
      }
    });
  }

  async function addGlossary() {
    if (glossarySpelling.trim().length === 0) {
      setNotice("Enter a spelling before adding a glossary row.");
      return;
    }
    await runAction("glossary-add", async () => {
      const glossary = addGlossaryEntry(project.glossary ?? [], glossarySpelling, {
        respell: glossaryRespell,
      });
      await persistProject({ ...project, glossary, updated_at: new Date().toISOString() });
      setGlossarySpelling("");
      setGlossaryRespell("");
    });
  }

  async function editGlossary(id: string, spelling: string, respell: string) {
    await runAction(`glossary-${id}`, async () => {
      const glossary = renameGlossaryEntry(project.glossary ?? [], id, spelling, respell);
      await persistProject({ ...project, glossary, updated_at: new Date().toISOString() });
    });
  }

  async function removeGlossary(id: string) {
    await runAction(`glossary-delete-${id}`, async () => {
      const glossary = deleteGlossaryEntry(project.glossary ?? [], id);
      await persistProject({ ...project, glossary, updated_at: new Date().toISOString() });
    });
  }

  async function saveNote() {
    if (!selectedChapter || !identity) {
      setNotice("Choose your local identity before adding a chapter note.");
      return;
    }
    await runAction("chapter-note", async () => {
      const nextProject = addChapterNote(
        project,
        selectedChapter.id,
        identity.personName,
        chapterNote,
      );
      await persistProject(nextProject);
      setChapterNote("");
    });
  }

  async function changeAuthorStatus(status: AuthorStatus) {
    if (!selectedChapter || !identity) {
      setNotice("Choose an author identity before changing chapter status.");
      return;
    }
    await runAction(`status-${status}`, async () => {
      await persistProject(
        setChapterAuthorStatus(project, selectedChapter.id, status, identity.personName),
      );
    });
  }

  function playPickup(pickup: Pickup) {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.currentTime = Math.max(0, pickup.t_start - 0.5);
    void audioRef.current.play();
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusyAction(name);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setNotice(messageFor(reason, "That action could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="app-shell project-shell">
      <AppHeader eyebrow="Book home" title={project.name}>
        <button className="text-button" type="button" onClick={onClose}>
          Close project
        </button>
      </AppHeader>

      <section className="book-home" aria-labelledby="book-home-title">
        <div className="book-home-heading">
          <div>
            <p className="phase-label">Project folder</p>
            <h2 id="book-home-title">
              {activePanel === "chapters" ? "Chapters" : activePanel === "glossary" ? "Glossary" : "Collaboration"}
            </h2>
            <p className="folder-path">{folder}</p>
          </div>
          <div className="heading-actions">
            <button className="compact-button" type="button" onClick={() => setComposerOpen(true)}>
              Paste chapter
            </button>
            <button
              className="primary-button compact-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void importChapter()}
            >
              Import text
            </button>
            <button
              className="secondary-button compact-button"
              type="button"
              disabled={project.chapters.length === 0 || busyAction !== null}
              onClick={() => void exportAcx()}
            >
              {busyAction === "export" ? "Exporting…" : "Export ACX pack"}
            </button>
            <button
              className="compact-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void shareProject()}
            >
              {busyAction === "share" ? "Preparing ZIP…" : "Share project ZIP"}
            </button>
          </div>
        </div>

        {notice ? <div className="inline-notice" role="status">{notice}</div> : null}

        <nav className="workspace-tabs" aria-label="Project sections">
          {(["chapters", "glossary", "collaboration"] as const).map((panel) => (
            <button
              key={panel}
              className={activePanel === panel ? "active" : ""}
              type="button"
              onClick={() => setActivePanel(panel)}
            >
              {panel === "chapters" ? "Chapters" : panel === "glossary" ? "Glossary" : "Collaboration"}
            </button>
          ))}
        </nav>

        {activePanel === "glossary" ? (
          <GlossaryPanel
            glossary={project.glossary ?? []}
            spelling={glossarySpelling}
            respell={glossaryRespell}
            busyAction={busyAction}
            onSpelling={setGlossarySpelling}
            onRespell={setGlossaryRespell}
            onAdd={() => void addGlossary()}
            onRename={(id, spelling, respell) => void editGlossary(id, spelling, respell)}
            onDelete={(id) => void removeGlossary(id)}
          />
        ) : activePanel === "collaboration" ? (
          <CollaborationPanel
            project={project}
            identity={identity}
            identityLoaded={identityLoaded}
            identityName={identityName}
            identityRole={identityRole}
            identitySeat={identitySeat}
            lightPack={lightPack}
            chapterNote={chapterNote}
            selectedChapterId={selectedChapterId}
            busyAction={busyAction}
            onIdentityName={setIdentityName}
            onIdentityRole={setIdentityRole}
            onIdentitySeat={setIdentitySeat}
            onLightPack={setLightPack}
            onChapterNote={setChapterNote}
            onSaveIdentity={() => void saveLocalIdentity()}
            onShare={() => void shareProject()}
            onSaveNote={() => void saveNote()}
            onStatus={(status) => void changeAuthorStatus(status)}
            onSelectChapter={setSelectedChapterId}
          />
        ) : project.chapters.length === 0 ? (
          <div className="empty-chapters">
            <div className="empty-icon" aria-hidden="true">+</div>
            <h3>Drop a manuscript or paste chapter 1.</h3>
            <p>
              Start with one plain-text chapter. Voice seats are already in the
              project model, even for solo narration.
            </p>
            <button
              className="example-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void loadExample()}
            >
              {busyAction === "example" ? "Loading fixture…" : "Try the proof fixture"}
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            <ChapterTable
              chapters={project.chapters}
              selectedId={selectedChapterId}
              busyAction={busyAction}
              onSelect={setSelectedChapterId}
              onAttach={(chapter) => void attachAudio(chapter)}
            />
            {selectedChapter ? (
              <ChapterDesk
                chapter={selectedChapter}
                chapterText={chapterText}
                transcriptText={transcriptText}
                onTranscriptChange={setTranscriptText}
                busyAction={busyAction}
                audioUrl={audioUrl}
                audioRef={audioRef}
                proof={proof}
                acxReport={acxReport}
                modelAvailable={modelAvailable}
                modelProgress={modelProgress}
                onDownloadModel={() => void downloadWhisperModel()}
                onProof={() => void runProof(selectedChapter)}
                onMeasure={() => void runAcxCheck(selectedChapter)}
                onPlayPickup={playPickup}
              />
            ) : null}
          </div>
        )}
      </section>

      {exportResult ? (
        <p className="export-summary">
          Last export: {exportResult.files.length} MP3 file{exportResult.files.length === 1 ? "" : "s"} · REPORT.txt included
        </p>
      ) : null}

      {composerOpen ? (
        <ChapterComposer
          title={chapterTitle}
          text={pastedText}
          busy={busyAction === "paste"}
          onTitle={setChapterTitle}
          onText={setPastedText}
          onCancel={() => setComposerOpen(false)}
          onSave={() => void addPastedChapter()}
        />
      ) : null}

      <footer>Project data is stored in this folder · schema {project.schema}</footer>
    </main>
  );
}

function GlossaryPanel({
  glossary,
  spelling,
  respell,
  busyAction,
  onSpelling,
  onRespell,
  onAdd,
  onRename,
  onDelete,
}: {
  glossary: GlossaryEntry[];
  spelling: string;
  respell: string;
  busyAction: string | null;
  onSpelling: (value: string) => void;
  onRespell: (value: string) => void;
  onAdd: () => void;
  onRename: (id: string, spelling: string, respell: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="phase-panel glossary-panel" aria-labelledby="glossary-panel-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Offline, deterministic draft</p>
          <h3 id="glossary-panel-title">Pronunciation bible</h3>
        </div>
        <span className="result-count">{glossary.length} entries</span>
      </header>
      <p className="panel-honesty">
        We guessed names from capitals and uncommon spellings. Fix this list and record a clip for
        anything a stranger would misread. An empty glossary is valid.
      </p>

      <div className="glossary-add-row">
        <label>
          Spelling
          <input value={spelling} onChange={(event) => onSpelling(event.target.value)} placeholder="Leominster" />
        </label>
        <label>
          Respell (optional)
          <input value={respell} onChange={(event) => onRespell(event.target.value)} placeholder="LEM-ster" />
        </label>
        <button type="button" disabled={busyAction !== null} onClick={onAdd}>Add</button>
      </div>

      {glossary.length === 0 ? (
        <div className="panel-empty">Import a manuscript to draft candidates, or add one by hand.</div>
      ) : (
        <div className="glossary-table-wrap">
          <table className="glossary-table">
            <thead>
              <tr><th>Spelling</th><th>Respell</th><th>Count</th><th>Source</th><th /></tr>
            </thead>
            <tbody>
              {glossary.map((entry) => (
                <GlossaryRow
                  key={entry.id}
                  entry={entry}
                  busy={busyAction !== null}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GlossaryRow({
  entry,
  busy,
  onRename,
  onDelete,
}: {
  entry: GlossaryEntry;
  busy: boolean;
  onRename: (id: string, spelling: string, respell: string) => void;
  onDelete: (id: string) => void;
}) {
  const [spelling, setSpelling] = useState(entry.spelling);
  const [respell, setRespell] = useState(entry.respell ?? "");

  useEffect(() => {
    setSpelling(entry.spelling);
    setRespell(entry.respell ?? "");
  }, [entry.spelling, entry.respell]);

  return (
    <tr>
      <td><input value={spelling} onChange={(event) => setSpelling(event.target.value)} /></td>
      <td><input value={respell} onChange={(event) => setRespell(event.target.value)} placeholder="Human pronunciation" /></td>
      <td>{entry.frequency}</td>
      <td>{entry.source}</td>
      <td className="glossary-actions">
        <button
          type="button"
          disabled={busy || spelling.trim().length === 0}
          onClick={() => onRename(entry.id, spelling, respell)}
        >
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => onDelete(entry.id)}>Delete</button>
      </td>
    </tr>
  );
}

function CollaborationPanel({
  project,
  identity,
  identityLoaded,
  identityName,
  identityRole,
  identitySeat,
  lightPack,
  chapterNote,
  selectedChapterId,
  busyAction,
  onIdentityName,
  onIdentityRole,
  onIdentitySeat,
  onLightPack,
  onChapterNote,
  onSaveIdentity,
  onShare,
  onSaveNote,
  onStatus,
  onSelectChapter,
}: {
  project: ProjectFile;
  identity: LocalIdentity | null;
  identityLoaded: boolean;
  identityName: string;
  identityRole: "author" | "narrator";
  identitySeat: "N1" | "N2";
  lightPack: boolean;
  chapterNote: string;
  selectedChapterId: string | null;
  busyAction: string | null;
  onIdentityName: (value: string) => void;
  onIdentityRole: (value: "author" | "narrator") => void;
  onIdentitySeat: (value: "N1" | "N2") => void;
  onLightPack: (value: boolean) => void;
  onChapterNote: (value: string) => void;
  onSaveIdentity: () => void;
  onShare: () => void;
  onSaveNote: () => void;
  onStatus: (status: AuthorStatus) => void;
  onSelectChapter: (id: string) => void;
}) {
  const selected = project.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const authorCanApprove = Boolean(identity && canApproveChapters(project, identity.personName));
  const notes = (project.chapter_notes ?? []).filter((note) => note.chapter_id === selectedChapterId);

  return (
    <section className="phase-panel collaboration-panel" aria-labelledby="collaboration-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Folder handoff, no account</p>
          <h3 id="collaboration-title">Author ↔ narrator</h3>
        </div>
        <span className="status-pill attached">{identity ? `${identity.personName} · ${identity.role}` : "Identity not set"}</span>
      </header>
      <p className="panel-honesty">
        This folder is the collaboration. Roles and work travel in project.json; “who I am” stays
        only in this app’s local data.
      </p>

      <div className="collaboration-grid">
        <div className="collaboration-card">
          <h4>Who am I on this computer?</h4>
          {!identityLoaded ? <p>Loading local identity…</p> : null}
          <label>Name<input value={identityName} onChange={(event) => onIdentityName(event.target.value)} placeholder="Alex Author" /></label>
          <label>
            Role
            <select value={identityRole} onChange={(event) => onIdentityRole(event.target.value as "author" | "narrator")}>
              <option value="author">I am the author</option>
              <option value="narrator">I am a narrator</option>
            </select>
          </label>
          {identityRole === "narrator" ? (
            <label>
              Seat
              <select value={identitySeat} onChange={(event) => onIdentitySeat(event.target.value as "N1" | "N2")}>
                <option value="N1">N1</option>
                <option value="N2">N2</option>
              </select>
            </label>
          ) : null}
          <button type="button" disabled={busyAction !== null} onClick={onSaveIdentity}>
            {busyAction === "identity" ? "Saving…" : "Save local identity"}
          </button>
          {project.people.length > 0 ? (
            <ul className="people-list">
              {project.people.map((person) => (
                <li key={`${person.name}-${person.role}`}>{person.name} · {person.role}{person.seat ? ` · ${person.seat}` : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="collaboration-card">
          <h4>Share the project</h4>
          <label className="checkbox-label">
            <input type="checkbox" checked={lightPack} onChange={(event) => onLightPack(event.target.checked)} />
            Light pack: omit generated exports and unreferenced raw takes
          </label>
          <p>Scripts, proof alignment, notes, project roles, and glossary clips stay included.</p>
          <button type="button" disabled={busyAction !== null} onClick={onShare}>
            {busyAction === "share" ? "Preparing ZIP…" : "Zip project for collaborator"}
          </button>
        </div>

        <div className="collaboration-card chapter-review-card">
          <h4>Chapter review</h4>
          {project.chapters.length === 0 ? <p>Add a chapter before leaving review notes.</p> : (
            <>
              <label>
                Chapter
                <select value={selectedChapterId ?? ""} onChange={(event) => onSelectChapter(event.target.value)}>
                  {project.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                </select>
              </label>
              <p>Current author status: <strong>{selected?.author_status.replaceAll("_", " ")}</strong></p>
              <div className="status-actions">
                {(["needs_pickup", "approved", "ignore_this_flag"] as const).map((status) => (
                  <button key={status} type="button" disabled={!authorCanApprove || busyAction !== null} onClick={() => onStatus(status)}>
                    {status.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
              {!authorCanApprove ? <p className="permission-note">Narrators can read author status and notes, but cannot approve the book.</p> : null}
              <label>
                Author note
                <textarea rows={3} value={chapterNote} onChange={(event) => onChapterNote(event.target.value)} placeholder="That’s Leominster, LEM-ster." />
              </label>
              <button type="button" disabled={!authorCanApprove || chapterNote.trim().length === 0 || busyAction !== null} onClick={onSaveNote}>Add note</button>
              {notes.length > 0 ? (
                <ul className="note-list">
                  {notes.map((note) => <li key={note.id}><strong>{note.author}</strong> {note.body}</li>)}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ChapterTable({
  chapters,
  selectedId,
  busyAction,
  onSelect,
  onAttach,
}: {
  chapters: ChapterFile[];
  selectedId: string | null;
  busyAction: string | null;
  onSelect: (id: string) => void;
  onAttach: (chapter: ChapterFile) => void;
}) {
  return (
    <div className="chapter-table-wrap">
      <table className="chapter-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Est.</th>
            <th>Audio</th>
            <th>Author</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter) => (
            <tr
              key={chapter.id}
              className={chapter.id === selectedId ? "selected-row" : ""}
              onClick={() => onSelect(chapter.id)}
            >
              <td>{String(chapter.index).padStart(2, "0")}</td>
              <td>
                {chapter.title}
                {chapter.duration_warning ? <span className="duration-warning" title={chapter.duration_warning}> · long</span> : null}
              </td>
              <td>{chapter.estimated_duration_minutes ? `${chapter.estimated_duration_minutes.toFixed(1)}m` : "—"}</td>
              <td>
                <button
                  className="table-action"
                  type="button"
                  disabled={busyAction === `attach-${chapter.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAttach(chapter);
                  }}
                >
                  {chapter.audio_path ? "Replace" : "Attach"}
                </button>
              </td>
              <td>{chapter.author_status.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChapterDesk({
  chapter,
  chapterText,
  transcriptText,
  onTranscriptChange,
  busyAction,
  audioUrl,
  audioRef,
  proof,
  acxReport,
  modelAvailable,
  modelProgress,
  onDownloadModel,
  onProof,
  onMeasure,
  onPlayPickup,
}: {
  chapter: ChapterFile;
  chapterText: string;
  transcriptText: string;
  onTranscriptChange: (value: string) => void;
  busyAction: string | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  proof: ProofResult | null;
  acxReport: AcxReport | null;
  modelAvailable: boolean | null;
  modelProgress: number;
  onDownloadModel: () => void;
  onProof: () => void;
  onMeasure: () => void;
  onPlayPickup: (pickup: Pickup) => void;
}) {
  return (
    <article className="chapter-desk">
      <header className="chapter-desk-heading">
        <div>
          <p className="card-kicker">Selected chapter</p>
          <h3>{chapter.title}</h3>
        </div>
        <span className={chapter.audio_path ? "status-pill attached" : "status-pill"}>
          {chapter.audio_path ? "Audio attached" : "No audio"}
        </span>
      </header>

      {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}

      <details className="manuscript-preview">
        <summary>Manuscript preview</summary>
        <p>{chapterText || "Loading manuscript…"}</p>
      </details>

      <div className="proof-input">
        <label htmlFor="local-transcript">Local word transcript</label>
        <textarea
          id="local-transcript"
          rows={4}
          value={transcriptText}
          onChange={(event) => onTranscriptChange(event.target.value)}
          placeholder="Leave blank to transcribe locally, or paste the words heard in the take…"
        />
        <p>
          Proof uses local Whisper when its model is installed. A pasted
          transcript is an offline fixture/development fallback. Nothing is uploaded.
        </p>
        {modelAvailable === false ? (
          <div className="model-note">
            <span>Local Whisper model is not installed.</span>
            <button type="button" onClick={onDownloadModel} disabled={busyAction !== null}>
              {busyAction === "model"
                ? `Downloading ${Math.round(modelProgress * 100)}%…`
                : "Download locally"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="desk-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!chapter.audio_path || busyAction !== null}
          onClick={onProof}
        >
          {busyAction === `proof-${chapter.id}` ? "Proofing…" : "Proof chapter"}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!chapter.audio_path || busyAction !== null}
          onClick={onMeasure}
        >
          {busyAction === `meter-${chapter.id}` ? "Measuring…" : "Check ACX"}
        </button>
      </div>

      {proof ? <PickupList pickups={proof.pickups} onPlay={onPlayPickup} /> : null}
      {acxReport ? <AcxMeter report={acxReport} /> : null}
    </article>
  );
}

function PickupList({ pickups, onPlay }: { pickups: Pickup[]; onPlay: (pickup: Pickup) => void }) {
  return (
    <section className="result-panel" aria-labelledby="pickup-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Word mismatches only</p>
          <h4 id="pickup-title">Pickups</h4>
        </div>
        <span className="result-count">{pickups.length} open</span>
      </div>
      {pickups.length === 0 ? (
        <p className="result-empty">No text mismatches found. Listen once for acting and noise.</p>
      ) : (
        <ul className="pickup-list">
          {pickups.map((pickup) => (
            <li key={pickup.id}>
              <button type="button" onClick={() => onPlay(pickup)}>Play</button>
              <time>{formatTime(pickup.t_start)}</time>
              <div>
                <span className="expected">{pickup.expected || "—"}</span>
                <span className="arrow" aria-hidden="true">→</span>
                <span className="heard">{pickup.heard || "—"}</span>
              </div>
              <span className="kind-badge">{pickup.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AcxMeter({ report }: { report: AcxReport }) {
  const rows = [
    ["RMS", "−23 to −18 dBFS", formatDb(report.rms_dbfs), report.checks.rms],
    ["True peak", "≤ −3.0 dBFS", formatDb(report.true_peak_dbfs), report.checks.true_peak],
    ["Noise floor", "≤ −60 dBFS", formatDb(report.noise_floor_dbfs), report.checks.noise_floor],
    ["Sample rate", "44.1 kHz", `${(report.sample_rate / 1000).toFixed(1)} kHz`, report.checks.sample_rate],
    ["Channels", "Mono or stereo", String(report.channels), report.checks.channels],
    ["Head room tone", "0.5–5.0 s", `${report.head_room_tone_s.toFixed(2)} s`, report.checks.head_room_tone],
    ["Tail room tone", "0.5–5.0 s", `${report.tail_room_tone_s.toFixed(2)} s`, report.checks.tail_room_tone],
  ] as const;

  return (
    <section className="result-panel" aria-labelledby="acx-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Measured locally</p>
          <h4 id="acx-title">ACX check</h4>
        </div>
        <span className={`traffic-light ${report.traffic_light}`}>
          {report.traffic_light}
        </span>
      </div>
      <table className="meter-table">
        <thead>
          <tr><th>Spec</th><th>Required</th><th>Measured</th><th /></tr>
        </thead>
        <tbody>
          {rows.map(([label, required, measured, status]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{required}</td>
              <td>{measured}</td>
              <td><span className={`check-dot ${status}`}>{status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meter-honesty">
        Measurable specs only. ACX can still reject clicks, echo, or a wrong read.
      </p>
    </section>
  );
}

function ChapterComposer({
  title,
  text,
  busy,
  onTitle,
  onText,
  onCancel,
  onSave,
}: {
  title: string;
  text: string;
  busy: boolean;
  onTitle: (value: string) => void;
  onText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="chapter-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <p className="phase-label">Plain text chapter</p>
        <h2 id="composer-title">Paste chapter 1</h2>
        <label htmlFor="chapter-title">Title</label>
        <input id="chapter-title" value={title} onChange={(event) => onTitle(event.target.value)} />
        <label htmlFor="chapter-text">Manuscript</label>
        <textarea
          id="chapter-text"
          rows={13}
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder="Paste the chapter exactly as written…"
          autoFocus
        />
        <div className="actions">
          <button className="primary-button" type="button" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Add chapter"}
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function AppHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">BD</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <span className="local-badge">Local only</span>
      {children}
    </header>
  );
}

function PrivacyNote() {
  return (
    <div className="privacy-note">
      <span className="privacy-icon" aria-hidden="true">✓</span>
      <p>
        <strong>This app does not upload your book or your voice.</strong>
        <br />
        It does not read the book for you.
      </p>
    </div>
  );
}

function AppFooter() {
  return <footer>Free · MIT licensed · No account · No telemetry</footer>;
}

function timedTranscript(text: string, durationSeconds: number): TranscriptWord[] {
  const tokens = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const step = durationSeconds / Math.max(1, tokens.length);
  return tokens.map((token, index) => ({
    text: token,
    start: index * step,
    end: Math.min(durationSeconds, (index + 0.8) * step),
    confidence: 1,
  }));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function float32FromBase64(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, seconds - minutes * 60);
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function formatDb(value: number): string {
  return value === -Infinity ? "−∞ dBFS" : `${value.toFixed(1).replace("-", "−")} dBFS`;
}

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
