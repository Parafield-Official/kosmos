import { parseProject, serializeProject } from "./project";
import type { ProjectFile } from "./types";

export interface ProjectFileSystem {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ProjectFolderLayout {
  projectJson: string;
  acxSpecJson: string;
  manuscript: string;
  chapters: string;
  audio: string;
  alignment: string;
  glossary: string;
  export: string;
}

export function folderLayout(folder: string): ProjectFolderLayout {
  const join = (child: string) => `${folder.replace(/[\\/]$/, "")}/${child}`;
  return {
    projectJson: join("project.json"),
    acxSpecJson: join("acx_spec.json"),
    manuscript: join("manuscript"),
    chapters: join("manuscript/chapters"),
    audio: join("audio"),
    alignment: join("alignment"),
    glossary: join("audio/glossary"),
    export: join("export"),
  };
}

export async function writeProjectFolder(
  folder: string,
  project: ProjectFile,
  fileSystem: ProjectFileSystem,
): Promise<ProjectFolderLayout> {
  const layout = folderLayout(folder);
  await Promise.all([
    fileSystem.mkdir(layout.manuscript),
    fileSystem.mkdir(layout.chapters),
    fileSystem.mkdir(layout.audio),
    fileSystem.mkdir(layout.alignment),
    fileSystem.mkdir(layout.glossary),
    fileSystem.mkdir(layout.export),
  ]);
  await fileSystem.writeFile(layout.projectJson, serializeProject(project));
  return layout;
}

export async function readProjectFolder(
  folder: string,
  fileSystem: ProjectFileSystem,
): Promise<ProjectFile> {
  const layout = folderLayout(folder);
  return parseProject(await fileSystem.readFile(layout.projectJson));
}

