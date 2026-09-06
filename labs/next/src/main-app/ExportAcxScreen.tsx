import { useEffect, useMemo, useRef, useState } from "react";
import { completionPct } from "./book-stats";
import {
  readEnginePrefs,
  SPEC_PRESET_OPTIONS,
  writeEnginePrefs,
  type SpecPresetId,
} from "./engine-prefs";
import { exportBookPack, type ExportPackMode } from "./punch";
import { appendChapter, readChapterAudioUrl, bookInitials, chapterStage, type AcxSubmission, type BookChapter, type BookProject } from "./store";
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

  const [reviewed, setReviewed] = useState(false);
  const [success, setSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement>(null);
  const submission: AcxSubmission = project.acxSubmission ?? { openingChapterId: "", closingChapterId: "", retailChapterId: "", retailStartSeconds: 1.5, retailDurationSeconds: 60 };
  const reviewVersion = JSON.stringify([project.chapters, project.acxSubmission]);
  useEffect(() => { setReviewed(false); setSuccess(false); }, [reviewVersion]);
  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    let objectUrl: string | undefined;
    const chapter = project.chapters.find(item => item.id === submission.retailChapterId);
    if (chapter?.masteredFile && !submission.skipRetailSample) {
      void readChapterAudioUrl(project, chapter.masteredFile).then(url => {
        if (url) { objectUrl = url; if (active) setPreviewUrl(url); else URL.revokeObjectURL(url); }
      }).catch(() => { if (active) setError("We couldn’t open this preview. Check that the chapter’s mastered recording is still in your project."); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [project.folder, project.chapters, submission.retailChapterId, submission.skipRetailSample]);
  function changeSubmission(next: Partial<typeof submission>) {
    setReviewed(false); setSuccess(false);
    onChange({ ...project, completedAt: undefined, acxSubmission: { ...submission, ...next } });
  }
  function addCredit(kind: "opening" | "closing") {
    const next = appendChapter(project, kind === "opening" ? "Opening credits" : "Closing credits");
    onChange({ ...next, completedAt: undefined, acxSubmission: { ...submission, [kind === "opening" ? "openingChapterId" : "closingChapterId"]: next.chapters[next.chapters.length - 1].id } });
  }
  const creditsValid = submission.skipCredits === true || (submission.openingChapterId !== submission.closingChapterId
    && [submission.openingChapterId, submission.closingChapterId].every(id => project.chapters.some(chapter => chapter.id === id)));
  const sampleValid = submission.skipRetailSample === true || (project.chapters.some(chapter => chapter.id === submission.retailChapterId)
    && ![submission.openingChapterId, submission.closingChapterId].includes(submission.retailChapterId)
    && Number.isFinite(submission.retailStartSeconds) && submission.retailStartSeconds >= 0
    && Number.isFinite(submission.retailDurationSeconds) && submission.retailDurationSeconds >= 60 && submission.retailDurationSeconds <= 296);
  const selectionValid = creditsValid && sampleValid;
  const exportChapters = submission.skipCredits ? project.chapters.filter(chapter => ![submission.openingChapterId, submission.closingChapterId].includes(chapter.id)) : project.chapters;
  const skippedParts = [submission.skipCredits ? "recorded credits" : null, submission.skipRetailSample ? "retail sample" : null].filter(Boolean).join(" and ");
  const progress = completionPct(project);
  const mastered = exportChapters.filter((chapter) => chapter.mastered).length;
  const total = exportChapters.length;
  const canExportAcx = total > 0 && mastered === total && selectionValid && reviewed;
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
    setSuccess(false);
    setBusy(mode);
    try {
      onChange(await exportBookPack(project, mode, reviewed));
      setSuccess(mode === "acx");
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
    <section className="ma-screen ma-export" aria-label="Export for ACX">
      <header className="ma-export-head">
        <h1 className="ma-title">Export for ACX</h1>
        <p className="ma-set-sub">
          Choose what to include in your audiobook export. We’ll check the audio and save your files in the book’s export folder.
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
              <p>{project.author.trim() || "Author not added"}</p>
              <div className="ma-dash-meter" aria-label={`${progress}% complete`}>
                <span className="ma-dash-meter-track">
                  <i style={{ width: `${progress}%` }} />
                </span>
                <span className="ma-dash-meter-label">{progress}% complete</span>
              </div>
              <p className="ma-export-count">
                {total === 0
                  ? "No sections selected for export."
                  : `${mastered} of ${total} section${total === 1 ? "" : "s"} mastered`}
              </p>
            </div>
          </div>

          {total > 0 ? (
            <ol className="ma-export-chapters">
              {project.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <strong>{chapter.title}</strong>
                  <em>{submission.skipCredits && [submission.openingChapterId, submission.closingChapterId].includes(chapter.id) ? "Skipped in this export" : packChapterLabel(chapter)}</em>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ma-export-empty">Add a chapter to your book to get started.</p>
          )}
        </article>

        <article className="ma-export-card ma-export-pack">
          <header className="ma-export-pack-head">
            <p className="ma-export-kicker">The finishing touches</p>
            <h2>Prepare your audiobook</h2>
            <p className="ma-set-sub">Include your credits and a short listening sample, or skip either for now.</p>
          </header>
          <details className="ma-acx-handoff-settings"><summary>Audio format</summary>
            <p>Mono MP3 · 44.1 kHz · 192 kbps constant bitrate. We check each exported file, including any credits and sample you include.</p>
          </details>
          {presetId !== "acx" ? <p>Your mastering setting is {SPEC_PRESET_OPTIONS.find(option => option.value === presetId)?.label ?? presetId}. You can switch to ACX here, then run Master again on any sections that need it.
            <button type="button" disabled={busy !== null} onClick={() => choosePreset("acx")}>Use ACX for mastering</button>
          </p> : null}
          <fieldset disabled={busy !== null} className="ma-acx-submission">
            <legend><span>01</span> Recorded credits</legend>
            <label className="ma-acx-skip"><input type="checkbox" checked={submission.skipCredits === true} onChange={event => changeSubmission({ skipCredits: event.target.checked })} />Skip credits for this export</label>
            {submission.skipCredits ? <p>We’ll leave the selected credits out of this export. They’ll stay in your project for later.</p> : <>
            <p>Choose your credit recordings below. To make new ones, add a section, then open Chapters to record or import and master it.</p>
            {(["opening", "closing"] as const).map(kind => (
              <label key={kind}>{kind === "opening" ? "Opening credits" : "Closing credits"}
                <select value={submission[kind === "opening" ? "openingChapterId" : "closingChapterId"]}
                  onChange={event => changeSubmission({ [kind === "opening" ? "openingChapterId" : "closingChapterId"]: event.target.value })}>
                  <option value="">Choose a section</option>
                  {project.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                </select>
                <button type="button" onClick={() => addCredit(kind)}>Add {kind} credits</button>
              </label>
            ))}
            <p>In your opening credits, say the book’s title, author and narrator. Use your closing credits to clearly mark the end. We’ll save each as its own MP3.</p></>}
          </fieldset>
          <fieldset disabled={busy !== null} className="ma-acx-submission">
            <legend><span>02</span> Listening sample</legend>
            <label className="ma-acx-skip"><input type="checkbox" checked={submission.skipRetailSample === true} onChange={event => changeSubmission({ skipRetailSample: event.target.checked })} />Skip sample for this export</label>
            {submission.skipRetailSample ? <p>We’ll leave the sample out of this export and keep your selection for later.</p> : <>
            <p>This is the short preview listeners hear on the book’s page. ACX calls it the retail sample.</p>
            <label>Choose a chapter
              <select value={submission.retailChapterId} onChange={event => changeSubmission({ retailChapterId: event.target.value })}>
                <option value="">Choose a chapter</option>
                {project.chapters.filter(chapter => ![submission.openingChapterId, submission.closingChapterId].includes(chapter.id)).map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </label>
            <div className="ma-acx-timing"><label>Start at (seconds)<input type="number" min="0" step="0.1" value={submission.retailStartSeconds} onChange={event => changeSubmission({ retailStartSeconds: event.target.valueAsNumber })} /></label>
            <label>Length (seconds)<input type="number" min="60" max="296" step="0.1" value={submission.retailDurationSeconds} onChange={event => changeSubmission({ retailDurationSeconds: event.target.valueAsNumber })} /></label></div>
            <p>Choose a passage from 1 minute to 4 minutes 56 seconds (60–296 seconds). Start and end between sentences, and avoid explicit content. We leave room for the short pauses at each end so the finished sample stays under five minutes.</p>
            {previewUrl ? <>
              <audio ref={preview} src={previewUrl} controls onTimeUpdate={() => {
                const player = preview.current;
                if (player && player.currentTime >= submission.retailStartSeconds + submission.retailDurationSeconds) player.pause();
              }} />
              <button type="button" onClick={() => {
                const player = preview.current;
                if (player) { player.currentTime = submission.retailStartSeconds; void player.play().catch(() => setError("We couldn’t play this passage. Try opening the chapter’s mastered recording.")); }
              }}>Listen to this passage</button>
            </> : <p>Choose a chapter you’ve mastered to listen to your selection here.</p>}</>}
          </fieldset>
          <label className="ma-acx-review"><input type="checkbox" checked={reviewed} disabled={busy !== null} onChange={event => setReviewed(event.target.checked)} />
            I’ve listened through the recordings I’m exporting. The narration is complete, the chapter announcements are correct, and I haven’t heard unwanted noise or changes in sound quality.{!submission.skipCredits ? " I’ve checked the opening and closing credits." : ""}{!submission.skipRetailSample ? " I’ve checked that the sample starts and ends cleanly and has no explicit content." : ""}
          </label>
          <p className="ma-acx-footnote">{skippedParts ? `You’re leaving out the ${skippedParts}. You can export now and add them separately when you submit your book to ACX.` : "We check the exported audio, but ACX still reviews the finished audiobook before accepting it."}</p>
          <details className="ma-acx-handoff-settings"><summary>Sending files to an editor?</summary>
            <p>A handoff includes the recordings available so far, even if the book isn’t finished. Choose the format your editor needs.</p>
            <p>{presetHint}</p>
            <select aria-label="Editor handoff format" value={presetId} disabled={busy !== null} onChange={event => choosePreset(event.target.value as SpecPresetId)}>
              {SPEC_PRESET_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </details>

          <div className="ma-export-acts">
            <button
              type="button"
              className="ma-export-listen"
              disabled={!canListen}
              onClick={() => setSurface("listen")}
            >
              <ListenGlyph />
              {canExportAcx ? "Listen to your book" : "Listen to recordings"}
            </button>
            <button
              type="button"
              className="ma-export-acx"
              disabled={!canExportAcx || busy !== null}
              onClick={() => void run("acx")}
            >
              <ExportGlyph />
              {busy === "acx" ? "Checking and exporting…" : "Export audiobook"}
            </button>
            <button
              type="button"
              className="ma-export-handoff"
              disabled={!canHandoff || busy !== null}
              onClick={() => void run("handoff")}
            >
              {busy === "handoff" ? "Preparing files…" : "Export for editor"}
            </button>
            <p className="ma-export-hint">
              {canExportAcx
                ? "Ready when you are. We’ll check the files as we export."
                : canHandoff
                  ? "Finish the steps above to export your audiobook, or export your recordings for an editor."
                  : "Record or import a chapter to get started."}
            </p>
          </div>
          {!selectionValid ? <p>Choose your credits and sample above, or check Skip to leave them out for now.</p> : null}
          {success ? <p className="ma-acx-receipt" role="status">{skippedParts ? `Your files are exported. This export leaves out the ${skippedParts}.` : "Your audiobook is exported."} The included MP3s passed our audio checks. You’ll find the files and REPORT.txt in your book’s export folder. Read the report for any measurements close to ACX’s limits before you submit.</p> : null}
          {error ? <p className="ma-error" role="alert">{error}</p> : null}
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
    return "Recorded";
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
