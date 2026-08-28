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
        <p className="ma-book-nav-title" title={project.title}>
          {project.title}
        </p>
        <button
          type="button"
          className={tab === "dashboard" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("dashboard")}
        >
          Home
        </button>
        <button
          type="button"
          className={tab === "chapters" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("chapters")}
        >
          Chapters
        </button>
        <button
          type="button"
          className={tab === "pronunciation" ? "ma-book-nav-item is-on" : "ma-book-nav-item"}
          onClick={() => onTab("pronunciation")}
        >
          Pronunciation
        </button>
      </nav>
      <div className="ma-book-main">{children}</div>
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
