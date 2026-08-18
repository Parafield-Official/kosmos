import { useEffect, useMemo, useRef, useState } from "react";
import { measurePcm, type AcxReport } from "../core/acx/measure";
import { alignTranscript, type TranscriptWord } from "../core/proof/align";
import { addChapter, createEmptyProject } from "../core/project/project";
import type { ChapterFile, Pickup, ProjectFile } from "../core/project/types";

interface ProjectEnvelope {
  folder: string;
  project: ProjectFile;
}

interface ProofResult {
  pickups: Pickup[];
  transcript: TranscriptWord[];
}

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

  async function importChapter() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setComposerOpen(true);
      return;
    }

    await runAction("import", async () => {
      const result = await window.boothDesk?.importText(envelope);
      if (result) {
        onChange(result);
        const chapter = result.project.chapters[result.project.chapters.length - 1];
        setSelectedChapterId(chapter.id);
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
            <h2 id="book-home-title">Chapters</h2>
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
          </div>
        </div>

        {notice ? <div className="inline-notice" role="status">{notice}</div> : null}

        {project.chapters.length === 0 ? (
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
              <td>{chapter.title}</td>
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
