import type { ReactNode } from "react";
import type { BookTab } from "./chapter-flow";
import type { BookProject } from "./store";

export function BookShell({
  project,
  tab,
  onTab,
  onBack,
  onDelete,
  onExport,
  canExport = false,
  exportBusy = false,
  children,
}: {
  project: BookProject;
  tab: BookTab;
  onTab: (tab: BookTab) => void;
  onBack: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  canExport?: boolean;
  exportBusy?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ma-book-shell">
      <nav className="ma-book-nav" aria-label="Book">
        <button type="button" className="ma-book-nav-back" onClick={onBack}>
          <ChevronLeft />
          Back
        </button>
        <button
          type="button"
          className={tab === "dashboard" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("dashboard")}
        >
          <BookNavIcon tab="dashboard" />
          Home
          {tab === "dashboard" ? <span className="ma-book-nav-dot" aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          className={tab === "chapters" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("chapters")}
        >
          <BookNavIcon tab="chapters" />
          Chapters
          {tab === "chapters" ? <span className="ma-book-nav-dot" aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          className={tab === "pronunciation" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("pronunciation")}
        >
          <BookNavIcon tab="pronunciation" />
          Pronunciation
          {tab === "pronunciation" ? <span className="ma-book-nav-dot" aria-hidden="true" /> : null}
        </button>
        {onExport ? (
          <button
            type="button"
            className="ma-book-nav-item ma-book-nav-export"
            onClick={onExport}
            disabled={!canExport || exportBusy}
          >
            <ExportGlyph />
            {exportBusy ? "Exporting…" : "Export ACX"}
          </button>
        ) : null}
        {onDelete ? (
          <>
            <span className="ma-book-nav-rule" aria-hidden="true" />
            <button
              type="button"
              className="ma-book-nav-item ma-book-nav-delete"
              onClick={onDelete}
              aria-label={`Delete ${project.title}`}
            >
              <DeleteGlyph />
              Delete
            </button>
          </>
        ) : null}
      </nav>
      <div className="ma-book-main">{children}</div>
    </div>
  );
}

function BookNavIcon({ tab }: { tab: BookTab }) {
  if (tab === "dashboard") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.5 8.3 10 3l6.5 5.3v7.2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V8.3Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
        <path d="M8 17v-5h4v5" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tab === "chapters") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.5 4.5A1.5 1.5 0 0 1 5 3h4.2c.8 0 1.5.7 1.5 1.5V17a2.4 2.4 0 0 0-2.2-1.5H5A1.5 1.5 0 0 1 3.5 14V4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M16.5 4.5A1.5 1.5 0 0 0 15 3h-2.8c-.8 0-1.5.7-1.5 1.5V17a2.4 2.4 0 0 1 2.2-1.5H15a1.5 1.5 0 0 0 1.5-1.5V4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 11.8V8.2m3 6.2V5.6m3 11V3.4m3 11V5.6m3 6.2V8.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

function DeleteGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.2 5.6h11.6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path
        d="M8.05 3.35h3.9c.5 0 .9.35.9.85v1.4H7.15V4.2c0-.5.4-.85.9-.85Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 5.6h7.2l-.48 9.05a1.45 1.45 0 0 1-1.45 1.35H8.33a1.45 1.45 0 0 1-1.45-1.35L6.4 5.6Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
}
