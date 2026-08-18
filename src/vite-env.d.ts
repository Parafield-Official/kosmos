/// <reference types="vite/client" />

interface BoothDeskBridge {
  platform: string;
  desktop: true;
  newProject: () => Promise<ProjectEnvelope | null>;
  openProject: () => Promise<ProjectEnvelope | null>;
  reopenRecentProject: () => Promise<ProjectEnvelope | null>;
  saveProject: (payload: ProjectEnvelope) => Promise<ProjectEnvelope>;
}

interface ProjectEnvelope {
  folder: string;
  project: import("./core/project/types").ProjectFile;
}

interface Window {
  boothDesk?: BoothDeskBridge;
}
