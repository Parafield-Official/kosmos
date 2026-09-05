import { useMemo, useRef, useState } from "react";
import { ExportAcxScreen } from "./ExportAcxScreen";
import { MasteringDesk, type MasteringTake } from "./MasteringDesk";
import {
  AUDIO_FILE_ACCEPT,
  collectAudioFiles,
  importMasteringFiles,
  masterAllChapters,
} from "./mastering-flow";
import { ReorderGrip, useReorder } from "./reorder";
import {
  fileManagerName,
  persistBook,
  reorderChapters,
  revealBookFolder,
  revealFolderLabel,
  type BookProject,
} from "./store";

const FILE_TAKES: MasteringTake[] = ["original", "mastered"];

export function SoundMasteringScreen({
  project,
  onBack,
  onChange,
  onDelete,
}: {
  project: BookProject;
  onBack: () => void;
  onChange: (next: BookProject) => void;
  onDelete?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(project.chapters[0]?.id ?? "");
  const [surface, setSurface] = useState<"desk" | "export">("desk");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(
    () => project.chapters.find((chapter) => chapter.id === selectedId) ?? project.chapters[0] ?? null,
    [project.chapters, selectedId],
  );
  const mastered = project.chapters.filter((chapter) => chapter.mastered).length;
  const total = project.chapters.length;
  const canExport = total > 0 && mastered === total;
  const pending = project.chapters.filter((chapter) => !chapter.mastered).length;
  const reorder = useReorder(project.chapters, (next) => {
    const reordered = reorderChapters(
      project,
      next.map((chapter) => chapter.id),
    );
    onChange(reordered);
    void persistBook(reordered).then(onChange);
  });

  async function addFiles(list: FileList | File[] | null | undefined) {
    const files = collectAudioFiles(list);
    if (!files.length || busy) {
      return;
    }
    setError(null);
    setBusy("Adding files…");
    try {
      const next = await persistBook(await importMasteringFiles(project, files));
      onChange(next);
      const newest = next.chapters[next.chapters.length - 1];
      if (newest) {
        setSelectedId(newest.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add those files.");
    } finally {
      setBusy(null);
    }
  }

  async function masterAll() {
    if (busy) {
      return;
    }
    setError(null);
    setBusy("Mastering…");
    try {
      const { project: next, failures } = await masterAllChapters(project, (updated, chapterId) => {
        onChange(updated);
        setSelectedId(chapterId);
      });
      onChange(await persistBook(next));
      if (failures.length) {
        setError(failures.map((item) => `${item.title}: ${item.reason}`).join(" "));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mastering failed.");
    } finally {
      setBusy(null);
    }
  }

  const canReveal = Boolean(project.folder && window.kosmosNext?.revealProjectFolder);
  const leadControl =
    pending > 0 ? (
      <button
        type="button"
        className="sound-master-all"
        disabled={Boolean(busy)}
        onClick={() => void masterAll()}
      >
        {busy ? busy : "Master all"}
      </button>
    ) : canExport ? (
      <button type="button" className="sound-master-primary" onClick={() => setSurface("export")}>
        Export ACX
      </button>
    ) : null;
  const leadAction = leadControl ? (
    <>
      <div className="sound-master-or">
        <span className="sound-master-or-line" aria-hidden="true" />
        <span className="sound-master-or-word">or</span>
        <span className="sound-master-or-line" aria-hidden="true" />
      </div>
      {leadControl}
    </>
  ) : null;

  async function revealFolder() {
    const result = await revealBookFolder(project);
    if (!result.ok) {
      setError(result.reason ?? "Could not open the project folder.");
    }
  }

  if (surface === "export") {
    return (
      <section className="sound-master is-export" aria-label="Export ACX">
        <header className="sound-master-head">
          <button type="button" className="vault-media-back" onClick={() => setSurface("desk")} aria-label="Back to mastering">
            <ChevronLeft />
            <span>Back</span>
          </button>
          <div className="sound-master-title">
            <h1>Export ACX</h1>
          </div>
          <span className="sound-master-head-end" aria-hidden="true" />
        </header>
        <ExportAcxScreen project={project} onChange={onChange} />
      </section>
    );
  }

  return (
    <section className="sound-master" aria-label="Sound mastering">
      <header className="sound-master-head">
        <button type="button" className="vault-media-back" onClick={onBack} aria-label="Back to library">
          <ChevronLeft />
          <span>Back</span>
        </button>
        <div className="sound-master-title">
          <h1>{project.title}</h1>
          <p>
            {total === 0
              ? "Add chapter audio to master."
              : `${mastered} of ${total} mastered`}
          </p>
        </div>
        <div className="sound-master-head-actions">
          {canReveal ? (
            <button
              type="button"
              className="sound-master-reveal"
              onClick={() => void revealFolder()}
              aria-label={revealFolderLabel()}
            >
              <FolderGlyph />
              <span>{fileManagerName()}</span>
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className="sound-master-delete" onClick={onDelete} aria-label={`Delete ${project.title}`}>
              Delete
            </button>
          ) : null}
          {!canReveal && !onDelete ? <span className="sound-master-head-end" aria-hidden="true" /> : null}
        </div>
      </header>

      {error ? <p className="ma-error sound-master-error">{error}</p> : null}

      <div className="sound-master-body">
        <aside className="sound-master-rail">
          <div className="sound-master-rail-head">
            <p className="sound-master-kicker">Chapters</p>
            <button type="button" className="sound-master-add" onClick={() => addRef.current?.click()} disabled={Boolean(busy)}>
              Add
            </button>
            <input
              ref={addRef}
              type="file"
              accept={AUDIO_FILE_ACCEPT}
              multiple
              className="ma-visually-hidden"
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {total === 0 ? (
            <p className="sound-master-empty">Add the chapter files you want mastered.</p>
          ) : (
            <ol className={`sound-master-list${reorder.drag ? " is-dragging" : ""}`}>
              {project.chapters.map((chapter, index) => {
                const on = selected?.id === chapter.id;
                const shift = reorder.shiftFor(index);
                const dragging = Boolean(reorder.drag?.from === index && reorder.drag.armed);
                return (
                  <li
                    key={chapter.id}
                    className={dragging ? "is-dragging" : undefined}
                    style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                  >
                    {reorder.showGrip ? (
                      <ReorderGrip
                        label={`Reorder ${chapter.title}`}
                        disabled={Boolean(busy)}
                        onPointerDown={(event) => reorder.startDrag(event, index)}
                        onPointerMove={reorder.moveDrag}
                        onPointerUp={reorder.endDrag}
                      />
                    ) : (
                      <span className="sound-master-grip is-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className={on ? "sound-master-row is-on" : "sound-master-row"}
                      onClick={() => setSelectedId(chapter.id)}
                    >
                      <span className="sound-master-file-copy">
                        <strong>{chapter.title}</strong>
                      </span>
                      <span
                        className={`sound-master-dot${chapter.mastered ? " is-on" : ""}`}
                        aria-label={chapter.mastered ? "Mastered" : "Not mastered"}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
        <div className="sound-master-stage">
          {selected ? (
            <MasteringDesk
              key={selected.id}
              project={project}
              chapterId={selected.id}
              heading={selected.title}
              leadAction={leadAction}
              onChange={onChange}
              compareTakes={FILE_TAKES}
              locked={Boolean(busy)}
            />
          ) : (
            <p className="sound-master-empty">Upload chapter audio to begin.</p>
          )}
        </div>
      </div>
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

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M4 8.2A1.7 1.7 0 0 1 5.7 6.5h4.1L12 8.6h6.3A1.7 1.7 0 0 1 20 10.3v6.5A1.7 1.7 0 0 1 18.3 18.5H5.7A1.7 1.7 0 0 1 4 16.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
