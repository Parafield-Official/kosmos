import type { ReactNode } from "react";
import type { BookTab } from "./chapter-flow";
import type { BookProject } from "./store";

export function BookShell({
  project,
  tab,
  onTab,
  onBack,
  children,
}: {
  project: BookProject;
  tab: BookTab;
  onTab: (tab: BookTab) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="ma-book-shell">
      <nav className="ma-book-nav" aria-label="Book">
        <button type="button" className="ma-book-nav-back" onClick={onBack}>
          <ChevronLeft />
          Projects
        </button>
        <button
          type="button"
          className={tab === "dashboard" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("dashboard")}
        >
          <BookNavIcon tab="dashboard" />
          Home
        </button>
        <button
          type="button"
          className={tab === "chapters" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("chapters")}
        >
          <BookNavIcon tab="chapters" />
          Chapters
        </button>
        <button
          type="button"
          className={tab === "pronunciation" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("pronunciation")}
        >
          <BookNavIcon tab="pronunciation" />
          Pronunciation
        </button>
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
