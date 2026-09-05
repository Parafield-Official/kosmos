import { useRef, useState } from "react";
import {
  AUDIO_FILE_ACCEPT,
  audioFilesInOrder,
  audioTitleFromName,
  sortAudioFiles,
} from "./mastering-flow";
import { ReorderGrip, useReorder } from "./reorder";
import { pickProjectParent } from "./store";

export interface SoundMasteringInput {
  title: string;
  files: File[];
  parentFolder?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function SoundMasteringDialog({
  onCreated,
  onClose,
  busy = false,
}: {
  onCreated: (input: SoundMasteringInput) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [parentFolder, setParentFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [dropHot, setDropHot] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleTouched = useRef(false);
  const hasBridge = Boolean(window.kosmosNext?.createProject);

  function addFiles(list: FileList | File[] | null | undefined) {
    const incoming = sortAudioFiles(audioFilesInOrder(list));
    if (!incoming.length) {
      return;
    }
    const seen = new Set(files.map((file) => `${file.name}:${file.size}`));
    const next = [...files];
    for (const file of incoming) {
      const key = `${file.name}:${file.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        next.push(file);
      }
    }
    setFiles(next);
    if (!titleTouched.current) {
      setTitle((current) =>
        current.trim() ? current : next.length === 1 ? audioTitleFromName(next[0]?.name ?? "") : current,
      );
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  const reorder = useReorder(files, setFiles);

  function submit() {
    if (!files.length) {
      return;
    }
    onCreated({
      title: title.trim() || audioTitleFromName(files[0].name),
      files,
      parentFolder: parentFolder ?? undefined,
    });
  }

  return (
    <div className="vault-create-wrap" role="dialog" aria-modal="true" aria-label="Sound mastering" onClick={(event) => event.stopPropagation()}>
      <article className="vault-create sound-master-create" onClick={(event) => event.stopPropagation()}>
        <p className="vault-create-kicker">Sound mastering</p>
        <h2 className="ma-dialog-title" id="sound-master-title">
          Master existing audio
        </h2>
        <p className="ma-dialog-sub">
          Upload chapter audio first. No manuscript, recording, or proof — then export ACX audio files.
        </p>

        <section className="vault-create-step">
          <p className="vault-create-step-kicker">Chapter files</p>
          {files.length === 0 ? (
            <button
              type="button"
              className={`vault-create-drop${dropHot ? " is-hot" : ""}`}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDropHot(true);
              }}
              onDragLeave={() => setDropHot(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropHot(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <UploadIcon />
              <strong>Add chapter audio</strong>
              <span>Drop files, or choose one or more</span>
            </button>
          ) : (
            <button
              type="button"
              className="vault-create-folder-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon />
              Add more
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={AUDIO_FILE_ACCEPT}
            multiple
            className="ma-visually-hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {files.length > 0 ? (
            <>
              <p className="vault-create-step-hint">Drag to set chapter order. This is the order they export in.</p>
              <ol
                className={`sound-master-files${reorder.drag ? " is-dragging" : ""}`}
                aria-label="Files to master"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(event.dataTransfer.files);
                }}
              >
                {files.map((file, index) => {
                  const shift = reorder.shiftFor(index);
                  const dragging = Boolean(reorder.drag?.from === index && reorder.drag.armed);
                  return (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className={dragging ? "is-dragging" : undefined}
                      style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                    >
                      {reorder.showGrip ? (
                        <ReorderGrip
                          label={`Reorder ${audioTitleFromName(file.name)}`}
                          disabled={busy}
                          onPointerDown={(event) => reorder.startDrag(event, index)}
                          onPointerMove={reorder.moveDrag}
                          onPointerUp={reorder.endDrag}
                        />
                      ) : (
                        <span className="sound-master-grip is-spacer" aria-hidden="true" />
                      )}
                      <span className="sound-master-file-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="sound-master-file-copy">
                        <strong>{audioTitleFromName(file.name)}</strong>
                        <em>
                          {file.name}
                          <span aria-hidden="true"> · </span>
                          {formatBytes(file.size)}
                        </em>
                      </span>
                      <button type="button" className="sound-master-file-remove" onClick={() => removeFile(index)} disabled={busy} aria-label={`Remove ${file.name}`}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </section>

        {files.length > 0 ? (
          <>
            <section className="vault-create-step">
              <p className="vault-create-step-kicker">Title</p>
              <label className="ma-field vault-create-title">
                <span className="ma-visually-hidden">Title</span>
                <input
                  className="ma-create-input"
                  value={title}
                  placeholder="The Silent Orbit"
                  onChange={(event) => {
                    titleTouched.current = true;
                    setTitle(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && files.length) {
                      submit();
                    }
                  }}
                />
              </label>
            </section>

            <section className="vault-create-step">
              <p className="vault-create-step-kicker">Save</p>
              {hasBridge ? (
                <div className="vault-create-folder">
                  <button
                    type="button"
                    className="vault-create-folder-btn"
                    disabled={busy || picking}
                    onClick={() => {
                      setPicking(true);
                      void pickProjectParent()
                        .then((path) => {
                          if (path) {
                            setParentFolder(path);
                          }
                        })
                        .finally(() => setPicking(false));
                    }}
                  >
                    <UploadIcon />
                    {picking ? "Opening…" : parentFolder ? "Change folder" : "Choose folder"}
                  </button>
                  {parentFolder ? (
                    <p className="vault-create-path" title={parentFolder}>
                      {parentFolder}
                    </p>
                  ) : (
                    <p className="vault-create-path is-empty">A project folder is created inside it.</p>
                  )}
                </div>
              ) : (
                <p className="vault-create-step-hint">In the browser preview, the job is stored in this browser.</p>
              )}
            </section>
          </>
        ) : null}

        <div className="ma-dialog-actions">
          <button type="button" className="vault-create-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="vault-create-btn is-primary"
            onClick={submit}
            disabled={busy || !files.length || (hasBridge && !parentFolder)}
          >
            {busy ? "Saving files…" : "Start mastering"}
          </button>
        </div>
      </article>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M12 15V4m0 0L8 8m4-4 4 4M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
