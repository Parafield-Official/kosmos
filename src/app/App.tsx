export function App() {
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
            <button className="primary-button" type="button">
              New project
            </button>
            <button className="secondary-button" type="button">
              Open project
            </button>
          </div>
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

      <footer>
        Free · MIT licensed · No account · No telemetry
      </footer>
    </main>
  );
}

