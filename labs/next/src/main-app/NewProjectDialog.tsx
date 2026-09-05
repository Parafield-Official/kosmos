import { useRef, useState } from "react";
import { unzipSync } from "fflate";
import {
  docxMetaFromBytes,
  epubMetaFromBytes,
  textMeta,
  type ManuscriptMeta,
} from "./manuscript-meta";
import { pickProjectParent } from "./store";

const MAX_COVER_BYTES = 6 * 1024 * 1024;

export interface NewProjectInput {
  title: string;
  author: string;
  coverDataUrl?: string;
  manuscript?: File;
  parentFolder?: string;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

/** Detect a title and author(s) from a manuscript, using each format's metadata. */
async function detectManuscriptMeta(file: File): Promise<ManuscriptMeta> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".epub") || file.type === "application/epub+zip") {
    return epubMetaFromBytes(new Uint8Array(await file.arrayBuffer()));
  }
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    return docxMetaFromBytes(new Uint8Array(await file.arrayBuffer()));
  }
  if (file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    try {
      return textMeta(await file.text());
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeZipPath(input: string): string {
  const parts: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== "." && segment !== "") {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function imageMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Pull the embedded cover image out of an EPUB (a zip) using its OPF metadata. */
async function extractEpubCover(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(bytes);
    const decoder = new TextDecoder();

    let opfPath: string | null = null;
    const container = entries["META-INF/container.xml"];
    if (container) {
      const xml = new DOMParser().parseFromString(decoder.decode(container), "application/xml");
      opfPath = xml.querySelector("rootfile")?.getAttribute("full-path") ?? null;
    }

    let coverHref: string | null = null;
    let opfDir = "";
    if (opfPath && entries[opfPath]) {
      opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
      const opf = new DOMParser().parseFromString(decoder.decode(entries[opfPath]), "application/xml");
      const items = Array.from(opf.querySelectorAll("manifest > item"));
      let item = items.find((node) =>
        (node.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image"),
      );
      if (!item) {
        const coverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute("content");
        if (coverId) {
          item = items.find((node) => node.getAttribute("id") === coverId);
        }
      }
      coverHref = item?.getAttribute("href") ?? null;
    }

    let entryPath = coverHref ? normalizeZipPath(opfDir + coverHref) : null;
    if (!entryPath || !entries[entryPath]) {
      const names = Object.keys(entries);
      entryPath =
        names.find((name) => /cover[^/]*\.(jpe?g|png|webp|gif)$/i.test(name)) ??
        names.find((name) => /\.(jpe?g|png|webp)$/i.test(name)) ??
        null;
    }
    if (!entryPath || !entries[entryPath]) {
      return null;
    }
    return `data:${imageMime(entryPath)};base64,${bytesToBase64(entries[entryPath])}`;
  } catch {
    return null;
  }
}

/** Detect a cover from the manuscript when the format embeds one (EPUB today). */
async function detectManuscriptCover(file: File): Promise<string | null> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".epub") || file.type === "application/epub+zip") {
    return extractEpubCover(file);
  }
  return null;
}

export function NewProjectDialog({
  onCreated,
  onClose,
  embedded,
}: {
  onCreated: (input: NewProjectInput) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [coverDataUrl, setCoverDataUrl] = useState<string | undefined>(undefined);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [manuscript, setManuscript] = useState<File | null>(null);
  const [parentFolder, setParentFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const manuscriptRef = useRef<HTMLInputElement>(null);
  const hasBridge = Boolean(window.kosmosNext?.createProject);

  async function pickManuscript(file: File | undefined) {
    if (!file) {
      return;
    }
    setManuscript(file);
    setTitle(titleFromFileName(file.name));
    setAuthor("");

    const [meta, cover] = await Promise.all([
      detectManuscriptMeta(file),
      detectManuscriptCover(file),
    ]);

    if (meta.title) {
      setTitle(meta.title);
    }
    if (meta.authors && meta.authors.length) {
      setAuthor(meta.authors.join(", "));
    }
    if (cover) {
      setCoverError(null);
      setCoverDataUrl(cover);
    }
  }

  function pickCover(file: File | undefined) {
    setCoverError(null);
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setCoverError("Pick an image file.");
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCoverError("That image is over 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCoverDataUrl(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => setCoverError("Could not read that image.");
    reader.readAsDataURL(file);
  }

  function submit() {
    if (!title.trim() || !manuscript) {
      return;
    }
    onCreated({
      title: title.trim(),
      author: author.trim(),
      coverDataUrl,
      manuscript,
      parentFolder: parentFolder ?? undefined,
    });
  }

  return (
    <div className={embedded ? "vault-create-wrap" : "ma-scrim"} role="dialog" aria-modal="true" aria-label="New project" onClick={embedded ? undefined : onClose}>
      <article
        className={embedded ? "vault-create" : "ma-dialog neu-panel"}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="vault-create-kicker">New project</p>
        <h2 className="ma-dialog-title" id="vault-create-title">
          Create a project
        </h2>
        <p className="ma-dialog-sub">
          Upload the manuscript first. Title, author, and cover fill in from the file — then you can edit them and choose where to save.
        </p>

        <section className="vault-create-step">
          <p className="vault-create-step-kicker">Manuscript</p>
          {manuscript ? (
            <div className="vault-create-chip">
              <UploadIcon />
              <span className="ma-manuscript-name" title={manuscript.name}>
                {manuscript.name}
              </span>
              <button type="button" className="vault-create-chip-act" onClick={() => manuscriptRef.current?.click()}>
                Change
              </button>
            </div>
          ) : (
            <button type="button" className="vault-create-drop" onClick={() => manuscriptRef.current?.click()}>
              <UploadIcon />
              <strong>Choose a manuscript</strong>
              <span>.txt, .md, .docx, .epub, or .pdf</span>
            </button>
          )}
          <input
            ref={manuscriptRef}
            type="file"
            accept=".txt,.md,.docx,.epub,.pdf,text/plain"
            className="ma-visually-hidden"
            onChange={(event) => pickManuscript(event.target.files?.[0])}
          />
        </section>

        {manuscript ? (
          <>
            <section className="vault-create-step">
              <p className="vault-create-step-kicker">Details</p>
              <p className="vault-create-step-hint">Filled from the manuscript. Edit anything that’s off.</p>
              <div className="ma-dialog-body">
                <button
                  type="button"
                  className="ma-cover-pick"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Choose cover image"
                >
                  {coverDataUrl ? (
                    <img src={coverDataUrl} alt="" className="ma-cover-preview" />
                  ) : (
                    <span className="ma-cover-empty">
                      <PlusIcon />
                      <span>Cover</span>
                    </span>
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="ma-visually-hidden"
                  onChange={(event) => pickCover(event.target.files?.[0])}
                />

                <div className="ma-fields">
                  <label className="ma-field">
                    <span>Title</span>
                    <input
                      className="ma-create-input"
                      value={title}
                      placeholder="The Silent Orbit"
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && title.trim()) {
                          submit();
                        }
                      }}
                    />
                  </label>
                  <label className="ma-field">
                    <span>Author</span>
                    <input
                      className="ma-create-input"
                      value={author}
                      placeholder="Your name"
                      onChange={(event) => setAuthor(event.target.value)}
                    />
                  </label>
                  {coverError ? <p className="ma-error">{coverError}</p> : null}
                </div>
              </div>
            </section>

            <section className="vault-create-step">
              <p className="vault-create-step-kicker">Save</p>
              {hasBridge ? (
                <div className="vault-create-folder">
                  <button
                    type="button"
                    className="vault-create-folder-btn"
                    disabled={picking}
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
                <p className="vault-create-step-hint">In the browser preview, the book is stored in this browser.</p>
              )}
            </section>
          </>
        ) : null}

        <div className="ma-dialog-actions">
          <button type="button" className="vault-create-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="vault-create-btn is-primary"
            onClick={submit}
            disabled={!title.trim() || !manuscript || (hasBridge && !parentFolder)}
          >
            Create project
          </button>
        </div>
      </article>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
