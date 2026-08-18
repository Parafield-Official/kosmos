import { useEffect, useState } from "react";
import { createEmptyProject } from "../core/project/project";
import type { ProjectFile } from "../core/project/types";

interface ProjectEnvelope {
  folder: string;
  project: ProjectFile;
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
      setError(reason instanceof Error ? reason.message : "Could not open that project.");
    } finally {
      setBusy(false);
    }
  }

  if (project) {
    return (
      <ProjectHome
        envelope={project}
        busy={busy}
        onClose={() => setProject(null)}
        onSave={setProject}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          BD
        </div>
        <div>
          <p className="eyebrow">Offline audiobook workspace</p>
          <h1>Booth Desk</h1>
        </div>
        <span className="local-badge">Local only</span>
      </header>

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="phase-label">Phase 0 · Foundation</p>
          <h2 id="welcome-title">Keep the page and the take together.</h2>
          <p className="lede">
            Create a project folder for one book. Booth Desk keeps its script,
            human recordings, pickups, and ACX checks together on disk.
          </p>

          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">
              ✓
            </span>
            <p>
              <strong>This app does not upload your book or your voice.</strong>
              <br />
              It does not read the book for you.
            </p>
          </div>

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

      <footer>Free · MIT licensed · No account · No telemetry</footer>
    </main>
  );
}

function ProjectHome({
  envelope,
  busy,
  onClose,
  onSave,
}: {
  envelope: ProjectEnvelope;
  busy: boolean;
  onClose: () => void;
  onSave: (next: ProjectEnvelope) => void;
}) {
  const { project, folder } = envelope;

  async function save() {
    if (!window.boothDesk || folder === "(browser preview)") {
      return;
    }
    const saved = await window.boothDesk.saveProject(envelope);
    onSave(saved);
  }

  return (
    <main className="app-shell project-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          BD
        </div>
        <div>
          <p className="eyebrow">Book home</p>
          <h1>{project.name}</h1>
        </div>
        <span className="local-badge">Local only</span>
        <button className="text-button" type="button" onClick={onClose}>
          Close project
        </button>
      </header>

      <section className="book-home" aria-labelledby="book-home-title">
        <div className="book-home-heading">
          <div>
            <p className="phase-label">Project folder</p>
            <h2 id="book-home-title">Chapters</h2>
            <p className="folder-path">{folder}</p>
          </div>
          <button
            className="compact-button"
            type="button"
            onClick={() => void save()}
            disabled={busy}
          >
            Save project
          </button>
        </div>

        {project.chapters.length === 0 ? (
          <div className="empty-chapters">
            <div className="empty-icon" aria-hidden="true">
              +
            </div>
            <h3>Drop a manuscript or paste chapter 1.</h3>
            <p>
              The chapter table will show duration, proof pickups, author
              status, ACX lights, and attached audio here.
            </p>
          </div>
        ) : (
          <div className="chapter-table-wrap">
            <table className="chapter-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Audio</th>
                  <th>Proof</th>
                  <th>Author</th>
                  <th>ACX</th>
                </tr>
              </thead>
              <tbody>
                {project.chapters.map((chapter) => (
                  <tr key={chapter.id}>
                    <td>{String(chapter.index).padStart(2, "0")}</td>
                    <td>{chapter.title}</td>
                    <td>{chapter.audio_path ? "Attached" : "—"}</td>
                    <td>Not run</td>
                    <td>{chapter.author_status}</td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>Project data is stored in this folder · schema {project.schema}</footer>
    </main>
  );
}

