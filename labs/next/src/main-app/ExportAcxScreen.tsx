import { useMemo, useState } from "react";
import { completionPct } from "./book-stats";
import {
  readEnginePrefs,
  SPEC_PRESET_OPTIONS,
  writeEnginePrefs,
  type SpecPresetId,
} from "./engine-prefs";
import { exportBookPack, type ExportPackMode } from "./punch";
import { bookInitials, chapterStage, type BookChapter, type BookProject } from "./store";
import { VaultListenSheet } from "./vault-media";

export function ExportAcxScreen({
  project,
  onChange,
}: {
  project: BookProject;
  onChange: (next: BookProject) => void;
}) {
  const [surface, setSurface] = useState<"desk" | "listen">("desk");
  const [presetId, setPresetId] = useState<SpecPresetId>(() => readEnginePrefs().spec_preset_id);
  const [busy, setBusy] = useState<ExportPackMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = completionPct(project);
  const mastered = project.chapters.filter((chapter) => chapter.mastered).length;
  const total = project.chapters.length;
  const canExportAcx = total > 0 && mastered === total;
  const playable = useMemo(
    () =>
      project.chapters.filter(
        (chapter) => chapter.masteredFile || chapter.workingFile || chapter.originalFile,
      ),
    [project.chapters],
  );
  const canListen = playable.length > 0;
  const canHandoff = project.chapters.some(chapterHasTape);
  const presetHint =
    SPEC_PRESET_OPTIONS.find((option) => option.value === presetId)?.hint ??
    "Loudness as RMS (−23 to −18 dBFS), true peak, noise floor, and room tone.";
  const listenSeed = useMemo(
    () => (playable.length ? { ...project, chapters: playable } : project),
    [playable, project],
  );

  function choosePreset(value: SpecPresetId) {
    setPresetId(value);
    writeEnginePrefs({ spec_preset_id: value });
  }

  async function run(mode: ExportPackMode) {
    if (busy) {
      return;
    }
    setError(null);
    setBusy(mode);
    try {
      onChange(await exportBookPack(project, mode));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  if (surface === "listen") {
    return (
      <section className="ma-screen ma-export is-media" aria-label="Listening">
        <VaultListenSheet
          embedded
          allowPartial
          seed={listenSeed}
          library={[listenSeed]}
          renderCover={(item) => <PackCover project={item} />}
          onBack={() => setSurface("desk")}
        />
      </section>
    );
  }

  return (
    <section className="ma-screen ma-export" aria-label="Export ACX">
      <header className="ma-export-head">
        <p className="ma-export-kicker">ACX</p>
        <h1 className="ma-title">Export ACX</h1>
        <p className="ma-set-sub">
          Pack the finished book for Audible, or hand off whatever tape exists so someone else can finish.
        </p>
      </header>

      <div className="ma-export-board">
        <article className="ma-export-card ma-export-status">
          <div className="ma-export-status-top">
            <div className="ma-export-cover">
              <PackCover project={project} />
            </div>
            <div className="ma-export-status-copy">
              <h2>{project.title}</h2>
              <p>{project.author.trim() || "Unknown author"}</p>
              <div className="ma-dash-meter" aria-label={`${progress}% complete`}>
                <span className="ma-dash-meter-track">
                  <i style={{ width: `${progress}%` }} />
                </span>
                <span className="ma-dash-meter-label">{progress}% complete</span>
              </div>
              <p className="ma-export-count">
                {total === 0
                  ? "No chapters yet."
                  : `${mastered} of ${total} chapter${total === 1 ? "" : "s"} mastered`}
              </p>
            </div>
          </div>

          {total > 0 ? (
            <ol className="ma-export-chapters">
              {project.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <strong>{chapter.title}</strong>
                  <em>{packChapterLabel(chapter)}</em>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ma-export-empty">Add chapters before packing the book.</p>
          )}
        </article>

        <article className="ma-export-card ma-export-pack">
          <p className="ma-export-kicker">Pack</p>
          <h2>Delivery</h2>
          <p className="ma-set-sub">{presetHint}</p>
          <div className="ma-seg" role="radiogroup" aria-label="Delivery target">
            {SPEC_PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={presetId === option.value}
                className={presetId === option.value ? "ma-seg-btn is-on" : "ma-seg-btn"}
                onClick={() => choosePreset(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="ma-export-note">Mono, 192 kbps or better. ACX needs every chapter mastered.</p>

          <div className="ma-export-acts">
            <button
              type="button"
              className="ma-export-listen"
              disabled={!canListen}
              onClick={() => setSurface("listen")}
            >
              <ListenGlyph />
              {canExportAcx ? "Play audiobook" : "Play what’s ready"}
            </button>
            <button
              type="button"
              className="ma-export-acx"
              disabled={!canExportAcx || busy !== null}
              onClick={() => void run("acx")}
            >
              <ExportGlyph />
              {busy === "acx" ? "Exporting…" : "Export ACX"}
            </button>
            <button
              type="button"
              className="ma-export-handoff"
              disabled={!canHandoff || busy !== null}
              onClick={() => void run("handoff")}
            >
              {busy === "handoff" ? "Packing…" : "Handoff pack"}
            </button>
            <p className="ma-export-hint">
              {canExportAcx
                ? "Ready for Audible."
                : canHandoff
                  ? "Handoff includes any original, working, or mastered tape so another booth can finish."
                  : "Record at least one chapter before handing the book off."}
            </p>
          </div>
          {error ? <p className="ma-error">{error}</p> : null}
        </article>
      </div>
    </section>
  );
}

function chapterHasTape(chapter: BookChapter): boolean {
  return Boolean(chapter.masteredFile || chapter.workingFile || chapter.originalFile);
}

function packChapterLabel(chapter: BookChapter): string {
  const stage = chapterStage(chapter);
  if (stage === "done") {
    return "Mastered";
  }
  if (stage === "mastering") {
    return "Ready to master";
  }
  if (stage === "proofing") {
    return "Proofread";
  }
  if (chapterHasTape(chapter)) {
    return "On tape";
  }
  return "Not started";
}

function PackCover({ project }: { project: BookProject }) {
  if (project.coverDataUrl) {
    return <img src={project.coverDataUrl} alt="" className="vault-cover-img" />;
  }
  return (
    <span className="vault-cover-gen">
      <span className="vault-cover-initials">{bookInitials(project)}</span>
      <span className="vault-cover-gen-title">{project.title}</span>
    </span>
  );
}

function ListenGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.4 10a6.6 6.6 0 0 1 13.2 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M5.6 10v2.4A1.6 1.6 0 0 0 7.2 14h.5v-4H5.6ZM12.3 10v4h.5a1.6 1.6 0 0 0 1.6-1.6V10h-2.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExportGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.4v8.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.8 6.4 10 3.2l3.2 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.2 11.6v3.2A1.5 1.5 0 0 0 5.7 16.3h8.6a1.5 1.5 0 0 0 1.5-1.5v-3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
