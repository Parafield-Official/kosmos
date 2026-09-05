import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createBook,
  getWorkspacePath,
  linkExternal,
  loadProjects,
  moveIntoWorkspace,
  notifyProjectsChanged,
  openBook,
  persistBook,
  saveProject,
  shelfIdentity,
  writeManuscript,
  type BookProject,
} from "./store";
import { ConfirmAlert } from "./ConfirmAlert";
import { importMasteringFiles } from "./mastering-flow";
import { NewProjectDialog } from "./NewProjectDialog";
import { SoundMasteringDialog } from "./SoundMasteringDialog";
import { VaultRoom } from "./VaultRoom";

export function LibraryScreen({
  onOpen,
  onCreated,
  onMasteringCreated,
  onSettings,
  onHome,
  pane = "home",
  nav = "home",
  overlay = null,
}: {
  onOpen: (project: BookProject) => void;
  onCreated: (project: BookProject, file?: File) => void;
  onMasteringCreated: (project: BookProject) => void;
  onSettings: () => void;
  onHome: () => void;
  pane?: "home" | "glass";
  nav?: "home" | "settings" | "none";
  overlay?: ReactNode;
}) {
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createMode, setCreateMode] = useState<"book" | "mastering" | null>(null);
  const [savingMaster, setSavingMaster] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [externalPrompt, setExternalPrompt] = useState<BookProject | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const identityRef = useRef("");
  const paneRef = useRef(pane);
  const refreshGen = useRef(0);
  const hasBridge = Boolean(window.kosmosNext?.listProjects);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const gen = ++refreshGen.current;
    if (!opts?.silent) {
      setLoading(true);
    }
    try {
      const [list, ws] = await Promise.all([loadProjects(), getWorkspacePath()]);
      if (gen !== refreshGen.current) {
        return;
      }
      const nextIdentity = shelfIdentity(list, ws);
      if (nextIdentity !== identityRef.current) {
        identityRef.current = nextIdentity;
        setProjects(list);
        setWorkspace(ws);
      }
    } catch (error) {
      if (gen !== refreshGen.current) {
        return;
      }
      setNotice(error instanceof Error ? error.message : "Could not read your workspace.");
    } finally {
      if (gen === refreshGen.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onWorkspaceChanged() {
      void refresh({ silent: true });
    }
    window.addEventListener("kosmos-workspace-changed", onWorkspaceChanged);
    const stop = window.kosmosNext?.onProjectsChanged?.(onWorkspaceChanged);
    return () => {
      window.removeEventListener("kosmos-workspace-changed", onWorkspaceChanged);
      stop?.();
    };
  }, [refresh]);

  useEffect(() => {
    const previous = paneRef.current;
    paneRef.current = pane;
    if (previous !== "home" && pane === "home") {
      void refresh({ silent: true });
    }
  }, [pane, refresh]);

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
      setCreateMode("book");
    }
  }

  async function startMastering() {
    if (await ensureWorkspace()) {
      setCreateMode("mastering");
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
        loading={loading}
        notice={notice}
        pane={pane}
        nav={nav}
        overlay={overlay}
        createSheet={
          createMode === "book" ? (
            <NewProjectDialog
              embedded
              onClose={() => setCreateMode(null)}
              onCreated={async (input) => {
                setCreateMode(null);
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
                  notifyProjectsChanged();
                  onCreated(project, input.manuscript);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not create the book.");
                }
              }}
            />
          ) : createMode === "mastering" ? (
            <SoundMasteringDialog
              busy={savingMaster}
              onClose={() => {
                if (!savingMaster) {
                  setCreateMode(null);
                }
              }}
              onCreated={async (input) => {
                setSavingMaster(true);
                try {
                  let project = await createBook({
                    title: input.title,
                    author: "",
                    parentFolder: input.parentFolder,
                    kind: "mastering",
                  });
                  project = await persistBook(await importMasteringFiles(project, input.files));
                  notifyProjectsChanged();
                  setCreateMode(null);
                  onMasteringCreated(project);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not start sound mastering.");
                } finally {
                  setSavingMaster(false);
                }
              }}
            />
          ) : null
        }
        onOpen={onOpen}
        onHome={onHome}
        onCreate={() => void startNewBook()}
        onImport={() => void openExisting()}
        onMaster={() => void startMastering()}
        onSettings={onSettings}
        onCreateClose={() => {
          if (!savingMaster) {
            setCreateMode(null);
          }
        }}
      />

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
    </section>
  );
}

export function ConfirmDelete({
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
  return (
    <ConfirmAlert
      title="Delete book?"
      body={`“${project.title}” and all of its chapters and recordings will be permanently deleted. This can’t be undone.`}
      confirm="Delete"
      busy={busy}
      busyLabel="Deleting…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
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
