import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBook,
  deleteBook,
  getWorkspacePath,
  linkExternal,
  loadProjects,
  moveIntoWorkspace,
  openBook,
  persistBook,
  saveProject,
  writeManuscript,
  type BookProject,
} from "./store";
import { NewProjectDialog } from "./NewProjectDialog";
import { VaultRoom } from "./VaultRoom";

export function LibraryScreen({
  onOpen,
  onCreated,
  onSettings,
}: {
  onOpen: (project: BookProject) => void;
  onCreated: (project: BookProject, file?: File) => void;
  onSettings: () => void;
}) {
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [externalPrompt, setExternalPrompt] = useState<BookProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const hasBridge = Boolean(window.kosmosNext?.listProjects);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ws] = await Promise.all([loadProjects(), getWorkspacePath()]);
      setProjects(list);
      setWorkspace(ws);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not read your workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onWorkspaceChanged() {
      void refresh();
    }
    window.addEventListener("kosmos-workspace-changed", onWorkspaceChanged);
    return () => window.removeEventListener("kosmos-workspace-changed", onWorkspaceChanged);
  }, [refresh]);

  /** Make sure a workspace folder exists before creating a book. */
  async function ensureWorkspace(): Promise<boolean> {
    if (!hasBridge || workspace) {
      return true;
    }
    if (window.kosmosNext?.requestFolderAccess) {
      const result = await window.kosmosNext.requestFolderAccess();
      if (result.granted) {
        await refresh();
        return true;
      }
      return false;
    }
    return true;
  }

  async function startNewBook() {
    if (await ensureWorkspace()) {
      setDialogOpen(true);
    }
  }

  async function openExisting() {
    if (hasBridge) {
      const result = await openBook();
      if (result.project && result.external) {
        setExternalPrompt(result.project);
      } else if (result.project) {
        onOpen(result.project);
      } else if (result.invalid) {
        setNotice("That folder isn’t a Kosmos project (no project.json).");
      }
      return;
    }
    importRef.current?.click();
  }

  function importExisting(file: File | undefined) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BookProject;
        if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.chapters)) {
          return;
        }
        saveProject(parsed);
        onOpen(parsed);
      } catch {
        // Ignore malformed files.
      }
    };
    reader.readAsText(file);
  }

  return (
    <section className="ma-screen ma-library" aria-label="Your projects">
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="ma-visually-hidden"
        onChange={(event) => importExisting(event.target.files?.[0])}
      />
      <VaultRoom
        projects={projects}
        workspace={workspace}
        loading={loading}
        notice={notice}
        onOpen={onOpen}
        onCreate={() => void startNewBook()}
        onImport={() => void openExisting()}
        onDelete={(project) => setDeleteTarget(project)}
        onSettings={onSettings}
      />

      {dialogOpen ? (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={async (input) => {
            setDialogOpen(false);
            try {
              let project = await createBook({
                title: input.title,
                author: input.author,
                coverDataUrl: input.coverDataUrl,
                parentFolder: input.parentFolder,
              });
              if (input.manuscript) {
                const name = await writeManuscript(project.folder, input.manuscript);
                if (name) {
                  project = await persistBook({ ...project, manuscript: name });
                }
              }
              onCreated(project, input.manuscript);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not create the book.");
            }
          }}
        />
      ) : null}

      {externalPrompt ? (
        <ExternalPrompt
          project={externalPrompt}
          onClose={() => setExternalPrompt(null)}
          onMove={async () => {
            const moved = await moveIntoWorkspace(externalPrompt);
            setExternalPrompt(null);
            onOpen(moved ?? externalPrompt);
          }}
          onKeep={async () => {
            const linked = await linkExternal(externalPrompt);
            setExternalPrompt(null);
            onOpen(linked);
          }}
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
          onConfirm={async () => {
            setDeleting(true);
            try {
              await deleteBook(deleteTarget);
              await refresh();
              setDeleteTarget(null);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not delete the book.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function ConfirmDelete({
  project,
  busy,
  onConfirm,
  onCancel,
}: {
  project: BookProject;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="ma-scrim" role="presentation" onClick={onCancel}>
      <div
        className="ma-alert neu-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ma-alert-title"
        aria-describedby="ma-alert-sub"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ma-alert-copy">
          <h2 className="ma-alert-title" id="ma-alert-title">
            Delete book?
          </h2>
          <p className="ma-alert-sub" id="ma-alert-sub">
            “{project.title}” and all of its chapters and recordings will be permanently deleted. This can’t be undone.
          </p>
        </div>
        <div className="ma-alert-actions">
          <button type="button" className="ma-alert-btn" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="ma-alert-btn ma-alert-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExternalPrompt({
  project,
  onMove,
  onKeep,
  onClose,
}: {
  project: BookProject;
  onMove: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ma-scrim" role="dialog" aria-modal="true" aria-label="Book outside workspace" onClick={onClose}>
      <div className="ma-dialog neu-panel" onClick={(event) => event.stopPropagation()}>
        <h2 className="ma-dialog-title">Outside your workspace</h2>
        <p className="ma-dialog-sub">
          “{project.title}” lives outside your workspace. Move it in, or keep it where it is and link it to
          your shelf.
        </p>
        <div className="ma-dialog-actions">
          <button type="button" className="btn" onClick={onKeep}>
            Keep &amp; link
          </button>
          <button type="button" className="btn btn-clear" onClick={onMove}>
            Move into workspace
          </button>
        </div>
      </div>
    </div>
  );
}
