import { useEffect, useMemo, useRef, useState } from "react";
import { measurePcm, type AcxReport } from "../core/acx/measure";
import { analyzeRoomTest, type RoomTestReport } from "../core/acx/room";
import { encodeWavPcm16 } from "../core/audio/wav";
import { alignTranscript, preservePickupWorkflow, type TranscriptWord } from "../core/proof/align";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  linkGlossarySpans,
  renameGlossaryEntry,
} from "../core/glossary/candidates";
import { addChapter, createEmptyProject } from "../core/project/project";
import {
  addChapterNote,
  canApproveChapters,
  setChapterAuthorStatus,
  updatePickup,
} from "../core/project/collaboration";
import { assignPickupSeats, assignSpanSeat } from "../core/duet/seats";
import { buildDuetTimeline } from "../core/duet/timeline";
import {
  buildPromptLines,
  clampFontSize,
  type PromptTheme,
} from "../core/teleprompter/model";
import type {
  AuthorStatus,
  ChapterFile,
  GlossaryEntry,
  Pickup,
  ProjectFile,
  ScriptSpan,
} from "../core/project/types";

interface ProjectEnvelope {
  folder: string;
  project: ProjectFile;
}

interface ProofResult {
  pickups: Pickup[];
  transcript: TranscriptWord[];
}

type ProjectPanel = "chapters" | "glossary" | "collaboration";

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
    }).catch((reason: unknown) => {
      setError(messageFor(reason, "Could not reopen the last project."));
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
      setError(messageFor(reason, "Could not open that project."));
    } finally {
      setBusy(false);
    }
  }

  if (project) {
    return (
      <ProjectHome
        envelope={project}
        onClose={() => setProject(null)}
        onChange={setProject}
      />
    );
  }

  return (
    <main className="app-shell">
      <AppHeader eyebrow="Offline audiobook workspace" title="Booth Desk" />

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="phase-label">Phase 0 · Foundation</p>
          <h2 id="welcome-title">Keep the page and the take together.</h2>
          <p className="lede">
            Create a project folder for one book. Booth Desk keeps its script,
            human recordings, pickups, and ACX checks together on disk.
          </p>

          <PrivacyNote />

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
            Word mismatches and long pauses only. Listen once for acting and noise.
          </p>
        </aside>
      </section>

      <AppFooter />
    </main>
  );
}

function ProjectHome({
  envelope,
  onClose,
  onChange,
}: {
  envelope: ProjectEnvelope;
  onClose: () => void;
  onChange: (next: ProjectEnvelope) => void;
}) {
  const { project, folder } = envelope;
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    project.chapters[0]?.id ?? null,
  );
  const [chapterText, setChapterText] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("Chapter 1");
  const [pastedText, setPastedText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [exportResult, setExportResult] = useState<AcxExportResult | null>(null);
  const [activePanel, setActivePanel] = useState<ProjectPanel>("chapters");
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityRole, setIdentityRole] = useState<"author" | "narrator">("author");
  const [identitySeat, setIdentitySeat] = useState<"N1" | "N2">("N1");
  const [lightPack, setLightPack] = useState(true);
  const [glossarySpelling, setGlossarySpelling] = useState("");
  const [glossaryRespell, setGlossaryRespell] = useState("");
  const [chapterNote, setChapterNote] = useState("");
  const [chapterManagerOpen, setChapterManagerOpen] = useState(false);
  const [splitOffset, setSplitOffset] = useState(0);
  const [splitTitle, setSplitTitle] = useState("");
  const [chapterSeat, setChapterSeat] = useState<"narration" | "N1" | "N2">("narration");
  const [chapterSpans, setChapterSpans] = useState<ScriptSpan[]>([]);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [promptFontSize, setPromptFontSize] = useState(48);
  const [promptTheme, setPromptTheme] = useState<PromptTheme>("dark");
  const [roomTestOpen, setRoomTestOpen] = useState(false);
  const [roomReport, setRoomReport] = useState<RoomTestReport | null>(null);
  const [punchPickup, setPunchPickup] = useState<Pickup | null>(null);
  const [glossaryRecording, setGlossaryRecording] = useState<GlossaryEntry | null>(null);
  const [pickupSeatFilter, setPickupSeatFilter] = useState<"all" | "narration" | "N1" | "N2">("all");
  const [duetNarrationSeat, setDuetNarrationSeat] = useState<"N1" | "N2">("N1");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const glossaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const glossaryObjectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (glossaryObjectUrlRef.current) {
      URL.revokeObjectURL(glossaryObjectUrlRef.current);
      glossaryObjectUrlRef.current = null;
    }
    glossaryAudioRef.current?.pause();
    glossaryAudioRef.current = null;
  }, []);

  const selectedChapter = useMemo(
    () => project.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [project.chapters, selectedChapterId],
  );

  useEffect(() => {
    if (!selectedChapter && project.chapters.length > 0) {
      setSelectedChapterId(project.chapters[0].id);
    }
  }, [project.chapters, selectedChapter]);

  useEffect(() => {
    setProof(null);
    setAcxReport(null);
    setTranscriptText("");
    setNotice(null);
    setChapterText("");
    setChapterSpans([]);

    if (!selectedChapter) {
      return;
    }

    if (!window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void Promise.all([
      window.boothDesk.readChapterText({ ...envelope, chapterId: selectedChapter.id }),
      window.boothDesk.readAlignment({ ...envelope, chapterId: selectedChapter.id }),
    ])
      .then(([result, alignment]) => {
        setChapterText(result.text);
        setChapterSpans(result.spans);
        if (alignment && alignment.chapter_id === selectedChapter.id) {
          setProof({ pickups: alignment.pickups, transcript: alignment.transcript });
          setTranscriptText(alignment.transcript.map((word) => word.text).join(" "));
        }
      })
      .catch((reason: unknown) => setNotice(messageFor(reason, "Could not read the chapter text.")));
  }, [selectedChapter?.id, folder]);

  useEffect(() => {
    setChapterManagerOpen(false);
    setSplitOffset(Math.max(1, Math.floor(chapterText.length / 2)));
    setSplitTitle(selectedChapter ? `${selectedChapter.title} (continued)` : "");
  }, [selectedChapter?.id]);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    setAudioUrl(null);
    if (!selectedChapter?.audio_path || !window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void window.boothDesk.readAudio({ folder, relativePath: selectedChapter.audio_path })
      .then(({ mime, base64 }) => {
        if (disposed) {
          return;
        }
        const bytes = base64ToBytes(base64);
        const blobBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        objectUrl = URL.createObjectURL(new Blob([blobBuffer], { type: mime }));
        setAudioUrl(objectUrl);
      })
      .catch((reason: unknown) => setNotice(messageFor(reason, "Could not load the attached audio.")));

    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedChapter?.audio_path, folder]);

  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge) {
      return;
    }
    void bridge.modelStatus().then((status) => setModelAvailable(status.available)).catch(() => setModelAvailable(false));
    return bridge.onModelProgress((progress) => {
      setModelProgress(progress.fraction);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    setIdentityLoaded(false);
    const firstPerson = project.people[0];
    if (!window.boothDesk || folder === "(browser preview)") {
      setIdentity(null);
      setIdentityName(firstPerson?.name ?? "");
      setIdentityRole(firstPerson?.role ?? "author");
      setIdentitySeat(firstPerson?.seat ?? "N1");
      setIdentityLoaded(true);
      return;
    }

    void window.boothDesk.getIdentity(project.id)
      .then((current) => {
        if (disposed) {
          return;
        }
        setIdentity(current);
        setIdentityName(current?.personName ?? firstPerson?.name ?? "");
        setIdentityRole(current?.role ?? firstPerson?.role ?? "author");
        setIdentitySeat(current?.seat ?? firstPerson?.seat ?? "N1");
        setIdentityLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setIdentityLoaded(true);
          setNotice(messageFor(reason, "Could not load the local collaborator identity."));
        }
      });
    return () => {
      disposed = true;
    };
  }, [project.id, folder]);

  async function importChapter() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setComposerOpen(true);
      return;
    }

    await runAction("import", async () => {
      const result = await window.boothDesk?.importText(envelope);
      if (result) {
        onChange(result);
        const chapter = result.chapters[0] ?? result.project.chapters[result.project.chapters.length - 1];
        if (chapter) {
          setSelectedChapterId(chapter.id);
        }
        setNotice(
          `${result.chapters.length} ${result.chapters.length === 1 ? "chapter" : "chapters"} imported${result.format ? ` from ${result.format.toUpperCase()}` : ""}. `
          + `${result.project.glossary?.length ?? 0} glossary candidates need a human check.`,
        );
      }
    });
  }

  async function addPastedChapter() {
    if (pastedText.trim().length === 0) {
      setNotice("Paste at least one line of manuscript text.");
      return;
    }

    await runAction("paste", async () => {
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.pasteText({
          ...envelope,
          title: chapterTitle,
          text: pastedText,
        });
        onChange(result);
        const chapter = result.project.chapters[result.project.chapters.length - 1];
        setSelectedChapterId(chapter.id);
      } else {
        const index = project.chapters.length + 1;
        const chapter: ChapterFile = {
          id: `ch${String(index).padStart(2, "0")}`,
          index,
          title: chapterTitle || `Chapter ${index}`,
          text_path: `manuscript/chapters/${String(index).padStart(2, "0")}.json`,
          pickups_path: `alignment/${String(index).padStart(2, "0")}.json`,
          author_status: "draft",
        };
        onChange({ folder, project: addChapter(project, chapter) });
        setSelectedChapterId(chapter.id);
        setChapterText(pastedText);
        setChapterSpans([{ text: pastedText, seat: "narration", style: [] }]);
      }
      setPastedText("");
      setComposerOpen(false);
    });
  }

  async function loadExample() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("The packaged proof fixture is available in the desktop app.");
      return;
    }
    await runAction("example", async () => {
      const result = await window.boothDesk?.loadExample(envelope);
      if (!result) {
        return;
      }
      onChange({ folder: result.folder, project: result.project });
      setSelectedChapterId(result.chapter.id);
      setTranscriptText(result.transcriptText);
      setNotice("Proof fixture loaded. Click Proof chapter to find the deliberate on → in substitution.");
    });
  }

  async function attachAudio(chapter: ChapterFile) {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Audio attachment is available in the desktop app.");
      return;
    }

    await runAction(`attach-${chapter.id}`, async () => {
      const result = await window.boothDesk?.attachAudio({ ...envelope, chapterId: chapter.id });
      if (result) {
        onChange({ folder: result.folder, project: result.project });
        setSelectedChapterId(chapter.id);
      }
    });
  }

  async function attachDuetTrack(kind: "bed" | "overdub") {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Duet track attachment is available in the desktop app after switching to duet mode.");
      return;
    }
    await runAction(`duet-${kind}`, async () => {
      const result = await window.boothDesk?.attachDuetTrack({ ...envelope, chapterId: selectedChapter.id, kind });
      if (result) {
        onChange(result);
        setNotice(`${kind === "bed" ? "N1 bed" : "N2 overdub"} attached at ${result.audioPath}.`);
      }
    });
  }

  async function mixDuetChapter() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Duet mixing is available in the desktop app.");
      return;
    }
    await runAction("duet-mix", async () => {
      const result = await window.boothDesk?.mixDuetChapter({
        ...envelope,
        chapterId: selectedChapter.id,
        narrationSeat: duetNarrationSeat,
        crossfadeMs: 20,
      });
      if (result) {
        onChange(result);
        setNotice(`Duet mix written to ${result.mixPath}; stems are ${result.n1StemPath} and ${result.n2StemPath}. Timing used ${result.timingSource} mapping.`);
      }
    });
  }

  async function runAcxCheck(chapter: ChapterFile) {
    if (!chapter.audio_path || !window.boothDesk) {
      setNotice("Attach an audio file before running the ACX check.");
      return;
    }

    await runAction(`meter-${chapter.id}`, async () => {
      const decoded = await window.boothDesk?.decodeAudio({
        folder,
        relativePath: chapter.audio_path as string,
      });
      if (!decoded) {
        return;
      }
      const samples = float32FromBase64(decoded.pcmBase64);
      const report = measurePcm({
        samples,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        format: decoded.format,
      });
      setAcxReport(report);
      await persistProject({
        ...project,
        chapters: project.chapters.map((candidate) => candidate.id === chapter.id
          ? { ...candidate, acx_traffic_light: report.traffic_light, updated_at: new Date().toISOString() }
          : candidate),
        updated_at: new Date().toISOString(),
      });
    });
  }

  async function runRoomCheck() {
    if (!project.room_test_path || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Record a room test before measuring it.");
      return;
    }
    const bridge = window.boothDesk;
    await runAction("room-meter", async () => {
      const decoded = await bridge.decodeAudio({ folder, relativePath: project.room_test_path as string });
      if (!decoded) {
        return;
      }
      let speechRmsDbfs: number | undefined;
      if (selectedChapter?.audio_path) {
        try {
          const speechAudio = await bridge.decodeAudio({ folder, relativePath: selectedChapter.audio_path });
          speechRmsDbfs = measurePcm({
            samples: float32FromBase64(speechAudio.pcmBase64),
            sampleRate: speechAudio.sampleRate,
            channels: speechAudio.channels,
            format: speechAudio.format,
          }).rms_dbfs;
        } catch {
          speechRmsDbfs = undefined;
        }
      }
      setRoomReport(analyzeRoomTest({
        samples: float32FromBase64(decoded.pcmBase64),
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        speechRmsDbfs,
      }));
    });
  }

  async function runProof(chapter: ChapterFile) {
    if (!chapter.audio_path) {
      setNotice("Attach the chapter audio before proofing.");
      return;
    }
    if (chapterText.trim().length === 0) {
      setNotice("This chapter has no manuscript text to compare.");
      return;
    }
    await runAction(`proof-${chapter.id}`, async () => {
      let duration = audioRef.current?.duration;
      if ((!duration || !Number.isFinite(duration)) && window.boothDesk) {
        const decoded = await window.boothDesk.decodeAudio({
          folder,
          relativePath: chapter.audio_path as string,
        });
        duration = decoded.durationSeconds;
      }
      let transcript: TranscriptWord[];
      if (transcriptText.trim().length > 0) {
        transcript = timedTranscript(transcriptText, duration || 1);
      } else if (window.boothDesk) {
        const local = await window.boothDesk.transcribe({
          folder,
          relativePath: chapter.audio_path as string,
          language: "en",
        });
        transcript = local.words;
        setTranscriptText(local.words.map((word) => word.text).join(" "));
      } else {
        throw new Error("The browser preview cannot run local Whisper. Open the desktop build or paste a transcript.");
      }
      const result = alignTranscript({
        chapterId: chapter.id,
        manuscript: chapterText,
        transcript,
        durationSeconds: duration || 1,
      });
      const freshPickups = project.mode === "duet"
        ? assignPickupSeats(
            result.pickups,
            buildDuetTimeline(chapterSpans, transcript, duration || 1),
          )
        : result.pickups;
      const pickups = preservePickupWorkflow(proof?.pickups ?? [], freshPickups);
      setProof({ pickups, transcript });
      if (window.boothDesk && folder !== "(browser preview)") {
        const saved = await window.boothDesk.saveAlignment({
          ...envelope,
          chapterId: chapter.id,
          pickups,
          transcript,
        });
        onChange(saved);
      }
      const mismatchCount = pickups.filter((pickup) => pickup.kind !== "pause").length;
      const pauseCount = pickups.filter((pickup) => pickup.kind === "pause").length;
      setNotice(
        pickups.length === 0
          ? "No word mismatches or long pauses found in this transcript. Listen once for acting and noise."
          : `${mismatchCount > 0 ? `${mismatchCount} word ${mismatchCount === 1 ? "mismatch" : "mismatches"}` : "No word mismatches"}`
            + `${pauseCount > 0 ? `; ${pauseCount} long ${pauseCount === 1 ? "pause" : "pauses"}` : ""} found.`,
      );
    });
  }

  async function downloadWhisperModel() {
    if (!window.boothDesk) {
      return;
    }
    await runAction("model", async () => {
      setModelProgress(0);
      const status = await window.boothDesk?.downloadModel();
      setModelAvailable(Boolean(status?.available));
      setModelProgress(1);
      setNotice("Whisper is ready. Proof stays on this computer.");
    });
  }

  async function exportAcx() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("ACX export is available in the desktop app after the master core is built.");
      return;
    }
    await runAction("export", async () => {
      const result = await window.boothDesk?.exportAcx(envelope);
      if (result) {
        setExportResult(result);
        setNotice(`ACX pack written to ${result.folder}. Review REPORT.txt and listen once.`);
      }
    });
  }

  async function exportMarkers() {
    if (!selectedChapter || !proof) {
      setNotice("Run Proof chapter first so there are pickups to export.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Marker export is available in the desktop app.");
      return;
    }
    await runAction("markers", async () => {
      const result = await window.boothDesk?.exportMarkers({
        ...envelope,
        chapterId: selectedChapter.id,
        pickups: proof.pickups.filter((pickup) => pickup.status === "open"),
      });
      if (result) {
        setNotice(`Audacity and Reaper markers written to ${result.folder}.`);
      }
    });
  }

  async function updateProofPickup(pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) {
    if (!selectedChapter || !proof) {
      return;
    }
    await runAction(`pickup-${pickup.id}`, async () => {
      const pickups = proof.pickups.map((candidate) => candidate.id === pickup.id
        ? updatePickup(candidate, changes)
        : candidate);
      setProof({ ...proof, pickups });
      if (window.boothDesk && folder !== "(browser preview)") {
        const saved = await window.boothDesk.saveAlignment({
          ...envelope,
          chapterId: selectedChapter.id,
          pickups,
          transcript: proof.transcript,
        });
        onChange(saved);
      }
      setNotice(`Pickup ${changes.status ? changes.status : "note"} saved.`);
    });
  }

  async function saveRecordedWav(
    wavBase64: string,
    kind: "chapter" | "punch" | "room" | "glossary" = "chapter",
    pickupId?: string,
    glossaryId?: string,
  ) {
    if (!window.boothDesk || folder === "(browser preview)") {
      throw new Error("Recording save is available in the desktop app.");
    }
    if (kind !== "room" && kind !== "glossary" && !selectedChapter) {
      throw new Error("Choose a chapter before recording.");
    }
    return runAction(`recording-${kind}`, async () => {
      const result = await window.boothDesk?.saveRecordingWav({
        ...envelope,
        kind,
        chapterId: selectedChapter?.id,
        glossaryId,
        pickupId,
        wavBase64,
      });
      if (result) {
        onChange(result);
        setNotice(
          kind === "punch"
            ? `Punch clip saved to ${result.path}. The original chapter audio is unchanged.`
            : kind === "glossary"
              ? `Pronunciation clip saved to ${result.path}.`
            : kind === "room"
              ? `Room test saved to ${result.path}.`
              : `Chapter WAV saved and attached at ${result.path}.`,
        );
      }
    });
  }

  async function applyPunchRecordingWav(wavBase64: string, pickup: Pickup): Promise<boolean> {
    if (!window.boothDesk || folder === "(browser preview)" || !selectedChapter) {
      throw new Error("Punch splicing is available in the desktop app with an attached chapter take.");
    }
    return runAction("punch", async () => {
      const result = await window.boothDesk?.applyPunchRecording({
        ...envelope,
        chapterId: selectedChapter.id,
        pickupId: pickup.id,
        tStart: pickup.t_start,
        tEnd: pickup.t_end,
        trimSilence: true,
        wavBase64,
      });
      if (result) {
        onChange(result);
        setNotice(`Punch applied to a new edited take at ${result.editedPath}. The raw take remains at ${selectedChapter.raw_audio_path || selectedChapter.audio_path}.`);
      }
    });
  }

  async function persistProject(nextProject: ProjectFile): Promise<void> {
    const nextEnvelope = window.boothDesk && folder !== "(browser preview)"
      ? await window.boothDesk.saveProject({ folder, project: nextProject })
      : { folder, project: nextProject };
    onChange(nextEnvelope);
  }

  async function saveLocalIdentity() {
    const cleanName = identityName.trim();
    if (cleanName.length === 0) {
      setNotice("Enter the name you use in this shared project.");
      return;
    }
    await runAction("identity", async () => {
      const nextIdentity: LocalIdentity = {
        projectId: project.id,
        personName: cleanName,
        role: identityRole,
        ...(identityRole === "narrator" ? { seat: identitySeat } : {}),
      };
      const existing = project.people.filter((person) => person.name.toLocaleLowerCase() !== cleanName.toLocaleLowerCase());
      const nextProject: ProjectFile = {
        ...project,
        people: [
          ...existing,
          {
            name: cleanName,
            role: identityRole,
            ...(identityRole === "narrator" ? { seat: identitySeat } : {}),
          },
        ],
        updated_at: new Date().toISOString(),
      };
      await persistProject(nextProject);
      if (window.boothDesk && folder !== "(browser preview)") {
        await window.boothDesk.setIdentity(nextIdentity);
      }
      setIdentity(nextIdentity);
      setNotice("Your local role is saved. It is kept outside the shared project folder.");
    });
  }

  async function shareProject() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Collaborator ZIP export is available in the desktop app.");
      return;
    }
    await runAction("share", async () => {
      const result = await window.boothDesk?.shareZip({ ...envelope, lightPack });
      if (result) {
        setNotice(
          `${lightPack ? "Light " : "Full "}collaborator pack written: ${result.outputPath} `
          + `(${result.fileCount} files).`,
        );
      }
    });
  }

  async function changeProjectMode(mode: "solo" | "duet") {
    await runAction("mode", async () => {
      await persistProject({ ...project, mode, updated_at: new Date().toISOString() });
      setNotice(mode === "duet"
        ? "Duet mode is on: N1 and N2 keep their voices inside every POV."
        : "Solo mode is on: all spans default to narration.");
    });
  }

  async function shareSeatPack(seat: "N1" | "N2") {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Seat-pack export is available in the desktop app.");
      return;
    }
    await runAction(`seat-pack-${seat}`, async () => {
      const result = await window.boothDesk?.shareSeatPack({ ...envelope, seat });
      if (result) {
        setNotice(`${seat} seat pack written to ${result.outputPath} (${result.fileCount} files).`);
      }
    });
  }

  async function persistGlossary(glossary: GlossaryEntry[]): Promise<void> {
    const nextProject = { ...project, glossary, updated_at: new Date().toISOString() };
    let nextEnvelope: ProjectEnvelope = window.boothDesk && folder !== "(browser preview)"
      ? await window.boothDesk.saveProject({ folder, project: nextProject })
      : { folder, project: nextProject };
    if (window.boothDesk && folder !== "(browser preview)") {
      nextEnvelope = await window.boothDesk.relinkGlossary(nextEnvelope);
    } else {
      setChapterSpans(linkGlossarySpans(chapterSpans, glossary));
    }
    onChange(nextEnvelope);
  }

  async function addGlossary() {
    if (glossarySpelling.trim().length === 0) {
      setNotice("Enter a spelling before adding a glossary row.");
      return;
    }
    await runAction("glossary-add", async () => {
      const glossary = addGlossaryEntry(project.glossary ?? [], glossarySpelling, {
        respell: glossaryRespell,
      });
      await persistGlossary(glossary);
      setGlossarySpelling("");
      setGlossaryRespell("");
    });
  }

  async function editGlossary(id: string, spelling: string, respell: string) {
    await runAction(`glossary-${id}`, async () => {
      const glossary = renameGlossaryEntry(project.glossary ?? [], id, spelling, respell);
      await persistGlossary(glossary);
    });
  }

  async function removeGlossary(id: string) {
    await runAction(`glossary-delete-${id}`, async () => {
      const glossary = deleteGlossaryEntry(project.glossary ?? [], id);
      await persistGlossary(glossary);
    });
  }

  async function attachGlossaryClip(id: string) {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Pronunciation clip attachment is available in the desktop app.");
      return;
    }
    await runAction(`glossary-clip-${id}`, async () => {
      const result = await window.boothDesk?.attachGlossaryClip({
        ...envelope,
        glossaryId: id,
      });
      if (result) {
        onChange(result);
        setNotice(`Pronunciation clip copied into ${result.clipPath}.`);
      }
    });
  }

  async function playGlossaryClip(entry: GlossaryEntry) {
    if (!entry.clip_path || !window.boothDesk || folder === "(browser preview)") {
      setNotice(entry.respell ? `${entry.spelling}: ${entry.respell}` : "Record or attach a pronunciation clip first.");
      return;
    }
    await runAction(`glossary-play-${entry.id}`, async () => {
      const audio = await window.boothDesk?.readAudio({ folder, relativePath: entry.clip_path as string });
      if (!audio) {
        return;
      }
      if (glossaryObjectUrlRef.current) {
        URL.revokeObjectURL(glossaryObjectUrlRef.current);
      }
      const bytes = base64ToBytes(audio.base64);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([buffer], { type: audio.mime }));
      glossaryObjectUrlRef.current = url;
      const player = new Audio(url);
      glossaryAudioRef.current = player;
      player.addEventListener("ended", () => {
        if (glossaryObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          glossaryObjectUrlRef.current = null;
        }
      }, { once: true });
      await player.play();
    });
  }

  async function saveNote() {
    if (!selectedChapter || !identity) {
      setNotice("Choose your local identity before adding a chapter note.");
      return;
    }
    await runAction("chapter-note", async () => {
      const nextProject = addChapterNote(
        project,
        selectedChapter.id,
        identity.personName,
        chapterNote,
      );
      await persistProject(nextProject);
      setChapterNote("");
    });
  }

  async function changeAuthorStatus(status: AuthorStatus) {
    if (!selectedChapter || !identity) {
      setNotice("Choose an author identity before changing chapter status.");
      return;
    }
    await runAction(`status-${status}`, async () => {
      await persistProject(
        setChapterAuthorStatus(project, selectedChapter.id, status, identity.personName),
      );
    });
  }

  async function renameSelectedChapter(title: string) {
    if (!selectedChapter) {
      return;
    }
    await runAction("chapter-rename", async () => {
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.renameChapter({
          ...envelope,
          chapterId: selectedChapter.id,
          title,
        });
        onChange(result);
      } else {
        await persistProject({
          ...project,
          chapters: project.chapters.map((chapter) => chapter.id === selectedChapter.id
            ? { ...chapter, title: title.trim() }
            : chapter),
          updated_at: new Date().toISOString(),
        });
      }
      setNotice("Chapter renamed.");
    });
  }

  async function splitSelectedChapter() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Manual file splitting is available in the desktop app.");
      return;
    }
    await runAction("chapter-split", async () => {
      const result = await window.boothDesk?.splitChapter({
        ...envelope,
        chapterId: selectedChapter.id,
        offset: splitOffset,
        secondTitle: splitTitle,
      });
      if (result) {
        onChange(result);
        setSelectedChapterId(result.chapter.id);
        setChapterManagerOpen(false);
        setNotice("Chapter split. Styles and seats were preserved on both sides.");
      }
    });
  }

  async function mergeSelectedWithNext() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Manual file merging is available in the desktop app.");
      return;
    }
    const ordered = [...project.chapters].sort((left, right) => left.index - right.index);
    const position = ordered.findIndex((chapter) => chapter.id === selectedChapter.id);
    const next = ordered[position + 1];
    if (!next) {
      setNotice("There is no following chapter to merge.");
      return;
    }
    await runAction("chapter-merge", async () => {
      const result = await window.boothDesk?.mergeChapters({
        ...envelope,
        firstChapterId: selectedChapter.id,
        secondChapterId: next.id,
      });
      if (result) {
        onChange(result);
        setChapterManagerOpen(false);
        setNotice(`Chapters merged. The removed chapter source remains at ${result.preservedSourcePath}.`);
      }
    });
  }

  async function applyChapterSeat() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Seat assignment is available in the desktop app.");
      return;
    }
    await runAction("chapter-seat", async () => {
      const result = await window.boothDesk?.setChapterSeat({
        ...envelope,
        chapterId: selectedChapter.id,
        seat: chapterSeat,
      });
      if (result) {
        onChange(result);
        setNotice(`All spans in ${selectedChapter.title} are now assigned to ${chapterSeat}.`);
      }
    });
  }

  async function applySpanSeat(index: number, seat: "narration" | "N1" | "N2") {
    if (!selectedChapter) {
      return;
    }
    await runAction(`span-seat-${index}`, async () => {
      const nextSpans = assignSpanSeat(chapterSpans, index, seat);
      setChapterSpans(nextSpans);
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.setChapterSpans({
          ...envelope,
          chapterId: selectedChapter.id,
          spans: nextSpans,
        });
        onChange(result);
      }
      setNotice(`Span ${index + 1} is assigned to ${seat}.`);
    });
  }

  function playPickup(pickup: Pickup) {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.currentTime = Math.max(0, pickup.t_start - 0.5);
    void audioRef.current.play();
  }

  async function runAction(name: string, action: () => Promise<void>): Promise<boolean> {
    setBusyAction(name);
    setNotice(null);
    try {
      await action();
      return true;
    } catch (reason) {
      setNotice(messageFor(reason, "That action could not be completed."));
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="app-shell project-shell">
      <AppHeader eyebrow="Book home" title={project.name}>
        <button className="text-button" type="button" onClick={onClose}>
          Close project
        </button>
      </AppHeader>

      <section className="book-home" aria-labelledby="book-home-title">
        <div className="book-home-heading">
          <div>
            <p className="phase-label">Project folder</p>
            <h2 id="book-home-title">
              {activePanel === "chapters" ? "Chapters" : activePanel === "glossary" ? "Glossary" : "Collaboration"}
            </h2>
            <p className="folder-path">{folder}</p>
          </div>
          <div className="heading-actions">
            <button className="compact-button" type="button" onClick={() => setComposerOpen(true)}>
              Paste chapter
            </button>
            <button
              className="primary-button compact-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void importChapter()}
            >
              Import manuscript
            </button>
            <button
              className="secondary-button compact-button"
              type="button"
              disabled={project.chapters.length === 0 || busyAction !== null}
              onClick={() => void exportAcx()}
            >
              {busyAction === "export" ? "Exporting…" : "Export ACX pack"}
            </button>
            <button
              className="compact-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void shareProject()}
            >
              {busyAction === "share" ? "Preparing ZIP…" : "Share project ZIP"}
            </button>
            <button className="compact-button" type="button" onClick={() => setRoomTestOpen(true)}>
              Room test
            </button>
          </div>
        </div>

        {notice ? <div className="inline-notice" role="status">{notice}</div> : null}

        <nav className="workspace-tabs" aria-label="Project sections">
          {(["chapters", "glossary", "collaboration"] as const).map((panel) => (
            <button
              key={panel}
              className={activePanel === panel ? "active" : ""}
              type="button"
              onClick={() => setActivePanel(panel)}
            >
              {panel === "chapters" ? "Chapters" : panel === "glossary" ? "Glossary" : "Collaboration"}
            </button>
          ))}
        </nav>

        {roomTestOpen ? (
          <section className="phase-panel room-test-panel" aria-labelledby="room-test-title">
            <header className="panel-heading">
              <div>
                <p className="card-kicker">Before recording a book</p>
                <h3 id="room-test-title">Room test</h3>
              </div>
              <button className="table-action" type="button" onClick={() => setRoomTestOpen(false)}>Close</button>
            </header>
            <p className="panel-honesty">Record 10–20 seconds of intended silence. If the predicted floor fails after the RMS boost, treat the room; no plugin can save a bathroom.</p>
            <RecorderPanel
              label="Room tone recorder"
              disabled={!window.boothDesk || busyAction !== null}
              onSave={(wav) => saveRecordedWav(wav, "room")}
            />
            <button className="compact-button room-check-button" type="button" disabled={!project.room_test_path || busyAction !== null} onClick={() => void runRoomCheck()}>
              {busyAction === "room-meter" ? "Measuring…" : "Measure room floor"}
            </button>
            {roomReport ? <RoomTestResult report={roomReport} /> : null}
          </section>
        ) : null}

        {activePanel === "glossary" ? (
          <GlossaryPanel
            glossary={project.glossary ?? []}
            spelling={glossarySpelling}
            respell={glossaryRespell}
            busyAction={busyAction}
            onSpelling={setGlossarySpelling}
            onRespell={setGlossaryRespell}
            onAdd={() => void addGlossary()}
            onRename={(id, spelling, respell) => void editGlossary(id, spelling, respell)}
            onDelete={(id) => void removeGlossary(id)}
            onAttachClip={(id) => void attachGlossaryClip(id)}
            onPlayClip={(entry) => void playGlossaryClip(entry)}
            onRecordClip={setGlossaryRecording}
          />
        ) : activePanel === "collaboration" ? (
          <CollaborationPanel
            project={project}
            identity={identity}
            identityLoaded={identityLoaded}
            identityName={identityName}
            identityRole={identityRole}
            identitySeat={identitySeat}
            lightPack={lightPack}
            chapterNote={chapterNote}
            selectedChapterId={selectedChapterId}
            busyAction={busyAction}
            onIdentityName={setIdentityName}
            onIdentityRole={setIdentityRole}
            onIdentitySeat={setIdentitySeat}
            onLightPack={setLightPack}
            onChapterNote={setChapterNote}
            onSaveIdentity={() => void saveLocalIdentity()}
            onShare={() => void shareProject()}
            onSaveNote={() => void saveNote()}
            onStatus={(status) => void changeAuthorStatus(status)}
            onSelectChapter={setSelectedChapterId}
            onMode={(mode) => void changeProjectMode(mode)}
            onSeatPack={(seat) => void shareSeatPack(seat)}
          />
        ) : project.chapters.length === 0 ? (
          <div className="empty-chapters">
            <div className="empty-icon" aria-hidden="true">+</div>
            <h3>Drop a manuscript or paste chapter 1.</h3>
            <p>
              Start with one plain-text chapter. Voice seats are already in the
              project model, even for solo narration.
            </p>
            <button
              className="example-button"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void loadExample()}
            >
              {busyAction === "example" ? "Loading fixture…" : "Try the proof fixture"}
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            <ChapterTable
              chapters={project.chapters}
              selectedId={selectedChapterId}
              busyAction={busyAction}
              onSelect={setSelectedChapterId}
              onAttach={(chapter) => void attachAudio(chapter)}
            />
            {selectedChapter ? (
              <ChapterDesk
                chapter={selectedChapter}
                chapterText={chapterText}
                transcriptText={transcriptText}
                onTranscriptChange={setTranscriptText}
                busyAction={busyAction}
                audioUrl={audioUrl}
                audioRef={audioRef}
                proof={proof}
                acxReport={acxReport}
                modelAvailable={modelAvailable}
                modelProgress={modelProgress}
                onDownloadModel={() => void downloadWhisperModel()}
                onProof={() => void runProof(selectedChapter)}
                onMeasure={() => void runAcxCheck(selectedChapter)}
                onPlayPickup={playPickup}
                onManage={() => setChapterManagerOpen(true)}
                onExportMarkers={() => void exportMarkers()}
                onOpenTeleprompter={() => setTeleprompterOpen(true)}
                onSaveRecording={(wavBase64) => saveRecordedWav(wavBase64, "chapter")}
                onPunchPickup={setPunchPickup}
                onUpdatePickup={(pickup, changes) => void updateProofPickup(pickup, changes)}
                pickupSeatFilter={pickupSeatFilter}
                onPickupSeatFilter={setPickupSeatFilter}
                spans={chapterSpans}
                onAssignSpanSeat={(index, seat) => void applySpanSeat(index, seat)}
                projectMode={project.mode}
                duetNarrationSeat={duetNarrationSeat}
                onDuetNarrationSeat={setDuetNarrationSeat}
                onAttachDuetTrack={(kind) => void attachDuetTrack(kind)}
                onMixDuet={mixDuetChapter}
              />
            ) : null}
          </div>
        )}
      </section>

      {exportResult ? (
        <p className="export-summary">
          Last export: {exportResult.files.length} MP3 file{exportResult.files.length === 1 ? "" : "s"} · REPORT.txt included
        </p>
      ) : null}

      {composerOpen ? (
        <ChapterComposer
          title={chapterTitle}
          text={pastedText}
          busy={busyAction === "paste"}
          onTitle={setChapterTitle}
          onText={setPastedText}
          onCancel={() => setComposerOpen(false)}
          onSave={() => void addPastedChapter()}
        />
      ) : null}

      {chapterManagerOpen && selectedChapter ? (
        <ChapterManager
          chapter={selectedChapter}
          nextChapter={[...project.chapters]
            .sort((left, right) => left.index - right.index)
            .find((chapter) => chapter.index > selectedChapter.index) ?? null}
          text={chapterText}
          splitOffset={splitOffset}
          splitTitle={splitTitle}
          seat={chapterSeat}
          busyAction={busyAction}
          onSplitOffset={setSplitOffset}
          onSplitTitle={setSplitTitle}
          onSeat={setChapterSeat}
          onRename={(title) => void renameSelectedChapter(title)}
          onSplit={() => void splitSelectedChapter()}
          onMerge={() => void mergeSelectedWithNext()}
          onApplySeat={() => void applyChapterSeat()}
          onClose={() => setChapterManagerOpen(false)}
        />
      ) : null}

      {teleprompterOpen && selectedChapter ? (
        <Teleprompter
          title={selectedChapter.title}
          spans={chapterSpans.length > 0 ? chapterSpans : [{ text: chapterText, seat: "narration", style: [] }]}
          glossary={project.glossary ?? []}
          fontSize={promptFontSize}
          theme={promptTheme}
          onFontSize={setPromptFontSize}
          onTheme={setPromptTheme}
          onPlayGlossary={(entry) => void playGlossaryClip(entry)}
          onClose={() => setTeleprompterOpen(false)}
        />
      ) : null}

      {punchPickup ? (
        <div className="modal-backdrop" role="presentation">
          <section className="chapter-composer punch-recorder" role="dialog" aria-modal="true" aria-labelledby="punch-title">
            <p className="phase-label">One-line punch clip</p>
            <h2 id="punch-title">{punchPickup.expected || "Pickup"}</h2>
            <p className="manager-help">Record the replacement line. Booth Desk saves a separate WAV; the original chapter take remains untouched.</p>
            <RecorderPanel
              label={`Punch at ${formatTime(punchPickup.t_start)}`}
              disabled={!window.boothDesk || busyAction !== null}
              onSave={async (wav) => {
                const applied = await applyPunchRecordingWav(wav, punchPickup);
                if (applied) {
                  setPunchPickup(null);
                }
              }}
            />
            <div className="actions"><button className="secondary-button" type="button" onClick={() => setPunchPickup(null)}>Cancel</button></div>
          </section>
        </div>
      ) : null}

      {glossaryRecording ? (
        <div className="modal-backdrop" role="presentation">
          <section className="chapter-composer punch-recorder" role="dialog" aria-modal="true" aria-labelledby="glossary-record-title">
            <p className="phase-label">Pronunciation clip</p>
            <h2 id="glossary-record-title">{glossaryRecording.spelling}</h2>
            <p className="manager-help">Say the spelling naturally for 3–10 seconds. Booth Desk stores your human clip locally; it never generates a voice.</p>
            <RecorderPanel
              label={`Pronunciation for ${glossaryRecording.spelling}`}
              disabled={!window.boothDesk || busyAction !== null}
              onSave={async (wav) => {
                const saved = await saveRecordedWav(wav, "glossary", undefined, glossaryRecording.id);
                if (saved) {
                  setGlossaryRecording(null);
                }
              }}
            />
            <div className="actions"><button className="secondary-button" type="button" onClick={() => setGlossaryRecording(null)}>Cancel</button></div>
          </section>
        </div>
      ) : null}

      <footer>Project data is stored in this folder · schema {project.schema}</footer>
    </main>
  );
}

function Teleprompter({
  title,
  spans,
  glossary,
  fontSize,
  theme,
  onFontSize,
  onTheme,
  onPlayGlossary,
  onClose,
}: {
  title: string;
  spans: ScriptSpan[];
  glossary: import("../core/project/types").GlossaryEntry[];
  fontSize: number;
  theme: PromptTheme;
  onFontSize: (value: number) => void;
  onTheme: (value: PromptTheme) => void;
  onPlayGlossary: (entry: GlossaryEntry) => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => buildPromptLines(spans), [spans]);
  const [liveFlags] = useState(false);
  const [glossaryHint, setGlossaryHint] = useState<string | null>(null);

  function activateGlossary(entry: GlossaryEntry) {
    setGlossaryHint(
      entry.clip_path
        ? `${entry.spelling}: playing the saved human pronunciation clip.`
        : `${entry.spelling}: ${entry.respell || "no clip or respelling yet"}.`,
    );
    onPlayGlossary(entry);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: Math.max(120, window.innerHeight * 0.72), behavior: "smooth" });
      } else if (event.key === "PageUp") {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: -Math.max(120, window.innerHeight * 0.72), behavior: "smooth" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={`teleprompter-overlay teleprompter-${theme}`}>
      <header className="teleprompter-toolbar">
        <div>
          <p className="card-kicker">Manual scroll · human voice</p>
          <h2>{title}</h2>
        </div>
        <div className="teleprompter-controls">
          <label>Size <input type="range" min="20" max="96" step="1" value={fontSize} onChange={(event) => onFontSize(clampFontSize(Number(event.target.value)))} /></label>
          <label>Theme
            <select value={theme} onChange={(event) => onTheme(event.target.value as PromptTheme)}>
              <option value="dark">Dark</option>
              <option value="sepia">Sepia</option>
              <option value="cream">Cream</option>
            </select>
          </label>
          <label className="teleprompter-checkbox" title="Listen-only ASR flags are not enabled in this build"><input type="checkbox" checked={liveFlags} disabled /> Live flags (experimental)</label>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="teleprompter-honesty">
        {liveFlags
          ? "Live flags are experimental and high-precision only; manual scrolling remains in control."
          : "Flags are off in this build so they do not cry wolf. Space/PageDown scrolls; listen to the take for acting, clicks, and room tone."}
        {glossaryHint ? <strong className="teleprompter-glossary-hint" role="status">{glossaryHint}</strong> : null}
      </div>
      <div ref={scrollRef} className="teleprompter-scroll" tabIndex={0}>
        <article className="teleprompter-page" style={{ fontSize: `${clampFontSize(fontSize)}px` }}>
          {lines.map((line) => (
            <p key={line.index} className="teleprompter-line">
              {line.segments.map((segment, index) => {
                const glossaryEntry = segment.glossary_id
                  ? glossary.find((entry) => entry.id === segment.glossary_id)
                  : undefined;
                return (
                  <span
                    key={`${line.index}-${index}-${segment.text.slice(0, 8)}`}
                    className={glossaryEntry ? "prompt-glossary-word" : undefined}
                    title={glossaryEntry?.respell ?? (glossaryEntry ? "Glossary candidate" : undefined)}
                    role={glossaryEntry ? "button" : undefined}
                    tabIndex={glossaryEntry ? 0 : undefined}
                    onClick={glossaryEntry ? () => activateGlossary(glossaryEntry) : undefined}
                    onKeyDown={glossaryEntry ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        activateGlossary(glossaryEntry);
                      }
                    } : undefined}
                    style={{
                      fontWeight: segment.style.includes("bold") ? 700 : undefined,
                      fontStyle: segment.style.includes("italic") ? "italic" : undefined,
                      textDecoration: segment.style.includes("underline") ? "underline" : undefined,
                      background: segment.style.includes("highlight") ? "rgba(236, 190, 88, 0.28)" : undefined,
                      color: segment.seat === "N1" ? "#d88a64" : segment.seat === "N2" ? "#82a9d7" : undefined,
                    }}
                  >{segment.text}</span>
                );
              })}
            </p>
          ))}
        </article>
      </div>
    </div>
  );
}

function RecorderPanel({
  label,
  disabled,
  onSave,
}: {
  label: string;
  disabled: boolean;
  onSave: (wavBase64: string) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "processing" | "review" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingWav, setPendingWav] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
    }
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void monitorContextRef.current?.close();
  }, []);

  useEffect(() => () => {
    if (pendingUrl) {
      URL.revokeObjectURL(pendingUrl);
    }
  }, [pendingUrl]);

  async function start() {
    if (disabled || status === "recording" || status === "processing" || status === "review") {
      return;
    }
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This desktop build does not expose a microphone input.");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("This desktop build does not expose a local recorder.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void finishRecording(mimeType || "audio/webm");
      };
      recorder.start(250);
      startedAtRef.current = performance.now();
      pausedAtRef.current = 0;
      setSeconds(0);
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
        setSeconds((performance.now() - startedAtRef.current - pausedAtRef.current) / 1000);
      }, 100);
      const monitorContext = new AudioContext();
      monitorContextRef.current = monitorContext;
      const source = monitorContext.createMediaStreamSource(stream);
      const analyser = monitorContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const values = new Uint8Array(analyser.fftSize);
      levelTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(values);
        let peak = 0;
        for (const value of values) {
          peak = Math.max(peak, Math.abs(value - 128) / 128);
        }
        setLevel(Math.min(1, peak));
      }, 80);
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("error");
      setError(messageFor(reason, "Microphone permission or recording failed."));
    }
  }

  function pause() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }
    recorder.pause();
    pausedAtRef.current = performance.now();
    setStatus("paused");
  }

  function resume() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") {
      return;
    }
    pausedAtRef.current = performance.now() - pausedAtRef.current;
    recorder.resume();
    setStatus("recording");
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || (recorder.state !== "recording" && recorder.state !== "paused")) {
      return;
    }
    recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    setStatus("processing");
  }

  async function finishRecording(mimeType: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      const mono = resampleAudioBufferToMono(decoded, 44_100);
      await context.close();
      const wavBase64 = bytesToBase64(encodeWavPcm16(mono, 44_100, 1));
      const nextBytes = base64ToBytes(wavBase64);
      const nextBuffer = nextBytes.buffer.slice(nextBytes.byteOffset, nextBytes.byteOffset + nextBytes.byteLength) as ArrayBuffer;
      setPendingWav(wavBase64);
      setPendingUrl(URL.createObjectURL(new Blob([nextBuffer], { type: "audio/wav" })));
      setStatus("review");
      setLevel(0);
    } catch (reason) {
      setStatus("error");
      setError(messageFor(reason, "Could not convert the take to a WAV."));
    } finally {
      recorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      void monitorContextRef.current?.close();
      monitorContextRef.current = null;
    }
  }

  async function confirmTake() {
    if (!pendingWav) {
      return;
    }
    setStatus("processing");
    setError(null);
    try {
      const saveResult = await onSave(pendingWav);
      if (saveResult === false) {
        setStatus("error");
        return;
      }
      setPendingWav(null);
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
      }
      setPendingUrl(null);
      setStatus("idle");
    } catch (reason) {
      setStatus("error");
      setError(messageFor(reason, "Could not save this take."));
    }
  }

  function discardTake() {
    setPendingWav(null);
    if (pendingUrl) {
      URL.revokeObjectURL(pendingUrl);
    }
    setPendingUrl(null);
    setStatus("idle");
    setError(null);
  }

  return (
    <section className="recorder-panel" aria-label={label}>
      <div className="recorder-heading">
        <div>
          <p className="card-kicker">DIY only · local microphone</p>
          <h4>{label}</h4>
        </div>
        <time>{formatTime(seconds)}</time>
      </div>
      <div className="level-track" aria-label={`recording level ${Math.round(level * 100)} percent`}>
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className="recorder-actions">
        <button type="button" disabled={disabled || status === "recording" || status === "paused" || status === "processing" || status === "review"} onClick={() => void start()}>
          Record
        </button>
        <button type="button" disabled={status !== "recording"} onClick={pause}>Pause</button>
        <button type="button" disabled={status !== "paused"} onClick={resume}>Resume</button>
        <button type="button" disabled={status !== "recording" && status !== "paused"} onClick={stop}>
          {status === "processing" ? "Saving…" : status === "review" ? "Review take" : "Stop & review"}
        </button>
      </div>
      {status === "review" && pendingUrl ? (
        <div className="recorder-review">
          <p className="card-kicker">Listen before writing the project</p>
          <audio controls preload="metadata" src={pendingUrl} />
          <div className="recorder-review-actions">
            <button type="button" className="primary-button" onClick={() => void confirmTake()}>Use this take</button>
            <button type="button" className="secondary-button" onClick={discardTake}>Discard</button>
          </div>
        </div>
      ) : null}
      <p className="recorder-honesty">
        No mic access is requested until Record. Stop opens a local review; Booth Desk writes a 44.1 kHz mono WAV only after you confirm. DAW multitrack work stays in Reaper.
      </p>
      {error ? <p className="recorder-error">{error}</p> : null}
    </section>
  );
}

function resampleAudioBufferToMono(buffer: AudioBuffer, targetRate: number): Float32Array {
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    return new Float32Array(1);
  }
  const outputLength = Math.max(1, Math.round(buffer.duration * targetRate));
  const output = new Float32Array(outputLength);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const scale = buffer.sampleRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * scale;
    const left = Math.min(buffer.length - 1, Math.floor(sourcePosition));
    const right = Math.min(buffer.length - 1, left + 1);
    const fraction = sourcePosition - left;
    let value = 0;
    for (const channel of channels) {
      value += (channel[left] * (1 - fraction) + channel[right] * fraction) / channels.length;
    }
    output[index] = value;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function ChapterManager({
  chapter,
  nextChapter,
  text,
  splitOffset,
  splitTitle,
  seat,
  busyAction,
  onSplitOffset,
  onSplitTitle,
  onSeat,
  onRename,
  onSplit,
  onMerge,
  onApplySeat,
  onClose,
}: {
  chapter: ChapterFile;
  nextChapter: ChapterFile | null;
  text: string;
  splitOffset: number;
  splitTitle: string;
  seat: "narration" | "N1" | "N2";
  busyAction: string | null;
  onSplitOffset: (value: number) => void;
  onSplitTitle: (value: string) => void;
  onSeat: (value: "narration" | "N1" | "N2") => void;
  onRename: (title: string) => void;
  onSplit: () => void;
  onMerge: () => void;
  onApplySeat: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(chapter.title);
  useEffect(() => setTitle(chapter.title), [chapter.id, chapter.title]);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="chapter-composer chapter-manager" role="dialog" aria-modal="true" aria-labelledby="manager-title">
        <p className="phase-label">Manual manuscript controls</p>
        <h2 id="manager-title">{chapter.title}</h2>
        <label htmlFor="manager-title-input">Rename chapter</label>
        <div className="manager-inline">
          <input id="manager-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          <button type="button" disabled={busyAction !== null || title.trim().length === 0} onClick={() => onRename(title)}>Save title</button>
        </div>

        <label htmlFor="manager-manuscript">Select a cursor position, then split</label>
        <textarea
          id="manager-manuscript"
          rows={10}
          value={text}
          readOnly
          onSelect={(event) => onSplitOffset(event.currentTarget.selectionStart ?? 0)}
        />
        <p className="manager-help">Split offset: {splitOffset} / {text.length}. The operation preserves span styles and seat assignments.</p>
        <label htmlFor="manager-second-title">New chapter title</label>
        <input id="manager-second-title" value={splitTitle} onChange={(event) => onSplitTitle(event.target.value)} />
        <button type="button" disabled={busyAction !== null || splitOffset <= 0 || splitOffset >= text.length} onClick={onSplit}>
          {busyAction === "chapter-split" ? "Splitting…" : "Split at cursor"}
        </button>

        <div className="manager-divider" />
        <label htmlFor="manager-seat">Assign this chapter’s spans to a seat</label>
        <div className="manager-inline">
          <select id="manager-seat" value={seat} onChange={(event) => onSeat(event.target.value as "narration" | "N1" | "N2")}>
            <option value="narration">Narration</option>
            <option value="N1">N1</option>
            <option value="N2">N2</option>
          </select>
          <button type="button" disabled={busyAction !== null} onClick={onApplySeat}>Apply seat</button>
        </div>
        <p className="manager-help">This v1 control applies one seat to every span in the chapter; finer span painting is next.</p>

        <button type="button" disabled={!nextChapter || busyAction !== null} onClick={onMerge}>
          {busyAction === "chapter-merge" ? "Merging…" : nextChapter ? `Merge with “${nextChapter.title}”` : "No following chapter to merge"}
        </button>
        <div className="actions">
          <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function GlossaryPanel({
  glossary,
  spelling,
  respell,
  busyAction,
  onSpelling,
  onRespell,
  onAdd,
  onRename,
  onDelete,
  onAttachClip,
  onPlayClip,
  onRecordClip,
}: {
  glossary: GlossaryEntry[];
  spelling: string;
  respell: string;
  busyAction: string | null;
  onSpelling: (value: string) => void;
  onRespell: (value: string) => void;
  onAdd: () => void;
  onRename: (id: string, spelling: string, respell: string) => void;
  onDelete: (id: string) => void;
  onAttachClip: (id: string) => void;
  onPlayClip: (entry: GlossaryEntry) => void;
  onRecordClip: (entry: GlossaryEntry) => void;
}) {
  return (
    <section className="phase-panel glossary-panel" aria-labelledby="glossary-panel-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Offline, deterministic draft</p>
          <h3 id="glossary-panel-title">Pronunciation bible</h3>
        </div>
        <span className="result-count">{glossary.length} entries</span>
      </header>
      <p className="panel-honesty">
        We guessed names from capitals and uncommon spellings. Fix this list and record a clip for
        anything a stranger would misread. An empty glossary is valid.
      </p>

      <div className="glossary-add-row">
        <label>
          Spelling
          <input value={spelling} onChange={(event) => onSpelling(event.target.value)} placeholder="Leominster" />
        </label>
        <label>
          Respell (optional)
          <input value={respell} onChange={(event) => onRespell(event.target.value)} placeholder="LEM-ster" />
        </label>
        <button type="button" disabled={busyAction !== null} onClick={onAdd}>Add</button>
      </div>

      {glossary.length === 0 ? (
        <div className="panel-empty">Import a manuscript to draft candidates, or add one by hand.</div>
      ) : (
        <div className="glossary-table-wrap">
          <table className="glossary-table">
            <thead>
              <tr><th>Spelling</th><th>Respell</th><th>Count</th><th>Source</th><th /></tr>
            </thead>
            <tbody>
              {glossary.map((entry) => (
                <GlossaryRow
                  key={entry.id}
                  entry={entry}
                  busy={busyAction !== null}
                  onRename={onRename}
                  onDelete={onDelete}
                  onAttachClip={onAttachClip}
                  onPlayClip={onPlayClip}
                  onRecordClip={onRecordClip}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GlossaryRow({
  entry,
  busy,
  onRename,
  onDelete,
  onAttachClip,
  onPlayClip,
  onRecordClip,
}: {
  entry: GlossaryEntry;
  busy: boolean;
  onRename: (id: string, spelling: string, respell: string) => void;
  onDelete: (id: string) => void;
  onAttachClip: (id: string) => void;
  onPlayClip: (entry: GlossaryEntry) => void;
  onRecordClip: (entry: GlossaryEntry) => void;
}) {
  const [spelling, setSpelling] = useState(entry.spelling);
  const [respell, setRespell] = useState(entry.respell ?? "");

  useEffect(() => {
    setSpelling(entry.spelling);
    setRespell(entry.respell ?? "");
  }, [entry.spelling, entry.respell]);

  return (
    <tr>
      <td><input value={spelling} onChange={(event) => setSpelling(event.target.value)} /></td>
      <td><input value={respell} onChange={(event) => setRespell(event.target.value)} placeholder="Human pronunciation" /></td>
      <td>{entry.frequency}</td>
      <td>{entry.source}</td>
      <td className="glossary-actions">
        <button
          type="button"
          disabled={busy || spelling.trim().length === 0}
          onClick={() => onRename(entry.id, spelling, respell)}
        >
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => onAttachClip(entry.id)}>
          {entry.clip_path ? "Replace clip" : "Add clip"}
        </button>
        <button type="button" disabled={busy || !entry.clip_path} onClick={() => onPlayClip(entry)}>Play</button>
        <button type="button" disabled={busy} onClick={() => onRecordClip(entry)}>Record clip</button>
        <button type="button" disabled={busy} onClick={() => onDelete(entry.id)}>Delete</button>
      </td>
    </tr>
  );
}

function CollaborationPanel({
  project,
  identity,
  identityLoaded,
  identityName,
  identityRole,
  identitySeat,
  lightPack,
  chapterNote,
  selectedChapterId,
  busyAction,
  onIdentityName,
  onIdentityRole,
  onIdentitySeat,
  onLightPack,
  onChapterNote,
  onSaveIdentity,
  onShare,
  onSaveNote,
  onStatus,
  onSelectChapter,
  onMode,
  onSeatPack,
}: {
  project: ProjectFile;
  identity: LocalIdentity | null;
  identityLoaded: boolean;
  identityName: string;
  identityRole: "author" | "narrator";
  identitySeat: "N1" | "N2";
  lightPack: boolean;
  chapterNote: string;
  selectedChapterId: string | null;
  busyAction: string | null;
  onIdentityName: (value: string) => void;
  onIdentityRole: (value: "author" | "narrator") => void;
  onIdentitySeat: (value: "N1" | "N2") => void;
  onLightPack: (value: boolean) => void;
  onChapterNote: (value: string) => void;
  onSaveIdentity: () => void;
  onShare: () => void;
  onSaveNote: () => void;
  onStatus: (status: AuthorStatus) => void;
  onSelectChapter: (id: string) => void;
  onMode: (mode: "solo" | "duet") => void;
  onSeatPack: (seat: "N1" | "N2") => void;
}) {
  const selected = project.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const authorCanApprove = Boolean(identity && canApproveChapters(project, identity.personName));
  const notes = (project.chapter_notes ?? []).filter((note) => note.chapter_id === selectedChapterId);

  return (
    <section className="phase-panel collaboration-panel" aria-labelledby="collaboration-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Folder handoff, no account</p>
          <h3 id="collaboration-title">Author ↔ narrator</h3>
        </div>
        <span className="status-pill attached">{identity ? `${identity.personName} · ${identity.role}` : "Identity not set"}</span>
      </header>
      <p className="panel-honesty">
        This folder is the collaboration. Roles and work travel in project.json; “who I am” stays
        only in this app’s local data.
      </p>

      <div className="collaboration-grid">
        <div className="collaboration-card">
          <h4>Who am I on this computer?</h4>
          {!identityLoaded ? <p>Loading local identity…</p> : null}
          <label>Name<input value={identityName} onChange={(event) => onIdentityName(event.target.value)} placeholder="Alex Author" /></label>
          <label>
            Role
            <select value={identityRole} onChange={(event) => onIdentityRole(event.target.value as "author" | "narrator")}>
              <option value="author">I am the author</option>
              <option value="narrator">I am a narrator</option>
            </select>
          </label>
          {identityRole === "narrator" ? (
            <label>
              Seat
              <select value={identitySeat} onChange={(event) => onIdentitySeat(event.target.value as "N1" | "N2")}>
                <option value="N1">N1</option>
                <option value="N2">N2</option>
              </select>
            </label>
          ) : null}
          <button type="button" disabled={busyAction !== null} onClick={onSaveIdentity}>
            {busyAction === "identity" ? "Saving…" : "Save local identity"}
          </button>
          {project.people.length > 0 ? (
            <ul className="people-list">
              {project.people.map((person) => (
                <li key={`${person.name}-${person.role}`}>{person.name} · {person.role}{person.seat ? ` · ${person.seat}` : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="collaboration-card">
          <h4>Share the project</h4>
          <label>
            Voice mode
            <select value={project.mode} onChange={(event) => onMode(event.target.value as "solo" | "duet")}>
              <option value="solo">Solo narration</option>
              <option value="duet">Duet · characters keep their narrator</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={lightPack} onChange={(event) => onLightPack(event.target.checked)} />
            Light pack: omit generated exports and unreferenced raw takes
          </label>
          <p>Scripts, proof alignment, notes, project roles, and glossary clips stay included.</p>
          <button type="button" disabled={busyAction !== null} onClick={onShare}>
            {busyAction === "share" ? "Preparing ZIP…" : "Zip project for collaborator"}
          </button>
          {project.mode === "duet" ? (
            <div className="status-actions">
              <button type="button" disabled={busyAction !== null} onClick={() => onSeatPack("N1")}>Export N1 seat pack</button>
              <button type="button" disabled={busyAction !== null} onClick={() => onSeatPack("N2")}>Export N2 seat pack</button>
            </div>
          ) : null}
        </div>

        <div className="collaboration-card chapter-review-card">
          <h4>Chapter review</h4>
          {project.chapters.length === 0 ? <p>Add a chapter before leaving review notes.</p> : (
            <>
              <label>
                Chapter
                <select value={selectedChapterId ?? ""} onChange={(event) => onSelectChapter(event.target.value)}>
                  {project.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                </select>
              </label>
              <p>Current author status: <strong>{selected?.author_status.replaceAll("_", " ")}</strong></p>
              <div className="status-actions">
                {(["needs_pickup", "approved", "ignore_this_flag"] as const).map((status) => (
                  <button key={status} type="button" disabled={!authorCanApprove || busyAction !== null} onClick={() => onStatus(status)}>
                    {status.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
              {!authorCanApprove ? <p className="permission-note">Narrators can read author status and notes, but cannot approve the book.</p> : null}
              <label>
                Author note
                <textarea rows={3} value={chapterNote} onChange={(event) => onChapterNote(event.target.value)} placeholder="That’s Leominster, LEM-ster." />
              </label>
              <button type="button" disabled={!authorCanApprove || chapterNote.trim().length === 0 || busyAction !== null} onClick={onSaveNote}>Add note</button>
              {notes.length > 0 ? (
                <ul className="note-list">
                  {notes.map((note) => <li key={note.id}><strong>{note.author}</strong> {note.body}</li>)}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ChapterTable({
  chapters,
  selectedId,
  busyAction,
  onSelect,
  onAttach,
}: {
  chapters: ChapterFile[];
  selectedId: string | null;
  busyAction: string | null;
  onSelect: (id: string) => void;
  onAttach: (chapter: ChapterFile) => void;
}) {
  return (
    <div className="chapter-table-wrap">
      <table className="chapter-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Est.</th>
            <th>Proof</th>
            <th>ACX</th>
            <th>Audio</th>
            <th>Author</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter) => (
            <tr
              key={chapter.id}
              className={chapter.id === selectedId ? "selected-row" : ""}
              onClick={() => onSelect(chapter.id)}
            >
              <td>{String(chapter.index).padStart(2, "0")}</td>
              <td>
                {chapter.title}
                {chapter.duration_warning ? <span className="duration-warning" title={chapter.duration_warning}> · long</span> : null}
              </td>
              <td>{chapter.estimated_duration_minutes ? `${chapter.estimated_duration_minutes.toFixed(1)}m` : "—"}</td>
              <td>{chapter.open_pickups === undefined ? "—" : `${chapter.open_pickups} open`}</td>
              <td>{chapter.acx_traffic_light ? <span className={`traffic-light compact ${chapter.acx_traffic_light}`}>{chapter.acx_traffic_light}</span> : "—"}</td>
              <td>
                <button
                  className="table-action"
                  type="button"
                  disabled={busyAction === `attach-${chapter.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAttach(chapter);
                  }}
                >
                  {chapter.audio_path ? "Replace" : "Attach"}
                </button>
              </td>
              <td>{chapter.author_status.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChapterDesk({
  chapter,
  chapterText,
  transcriptText,
  onTranscriptChange,
  busyAction,
  audioUrl,
  audioRef,
  proof,
  acxReport,
  modelAvailable,
  modelProgress,
  onDownloadModel,
  onProof,
  onMeasure,
  onPlayPickup,
  onManage,
  onExportMarkers,
  onOpenTeleprompter,
  onSaveRecording,
  onPunchPickup,
  onUpdatePickup,
  pickupSeatFilter,
  onPickupSeatFilter,
  spans,
  onAssignSpanSeat,
  projectMode,
  duetNarrationSeat,
  onDuetNarrationSeat,
  onAttachDuetTrack,
  onMixDuet,
}: {
  chapter: ChapterFile;
  chapterText: string;
  transcriptText: string;
  onTranscriptChange: (value: string) => void;
  busyAction: string | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  proof: ProofResult | null;
  acxReport: AcxReport | null;
  modelAvailable: boolean | null;
  modelProgress: number;
  onDownloadModel: () => void;
  onProof: () => void;
  onMeasure: () => void;
  onPlayPickup: (pickup: Pickup) => void;
  onManage: () => void;
  onExportMarkers: () => void;
  onOpenTeleprompter: () => void;
  onSaveRecording: (wavBase64: string) => Promise<unknown>;
  onPunchPickup: (pickup: Pickup) => void;
  onUpdatePickup: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void;
  pickupSeatFilter: "all" | "narration" | "N1" | "N2";
  onPickupSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void;
  spans: ScriptSpan[];
  onAssignSpanSeat: (index: number, seat: "narration" | "N1" | "N2") => void;
  projectMode: "solo" | "duet";
  duetNarrationSeat: "N1" | "N2";
  onDuetNarrationSeat: (value: "N1" | "N2") => void;
  onAttachDuetTrack: (kind: "bed" | "overdub") => void;
  onMixDuet: () => Promise<void>;
}) {
  return (
    <article className="chapter-desk">
      <header className="chapter-desk-heading">
        <div>
          <p className="card-kicker">Selected chapter</p>
          <h3>{chapter.title}</h3>
        </div>
        <div className="chapter-heading-tools">
          <span className={chapter.audio_path ? "status-pill attached" : "status-pill"}>
            {chapter.audio_path ? "Audio attached" : "No audio"}
          </span>
          <button className="table-action" type="button" onClick={onManage}>Manage script</button>
        </div>
      </header>

      {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}

      <details className="manuscript-preview">
        <summary>Manuscript preview</summary>
        <p>{chapterText || "Loading manuscript…"}</p>
      </details>

      <SpanSeatEditor spans={spans} disabled={busyAction !== null} onAssign={onAssignSpanSeat} />

      <div className="proof-input">
        <label htmlFor="local-transcript">Local word transcript</label>
        <textarea
          id="local-transcript"
          rows={4}
          value={transcriptText}
          onChange={(event) => onTranscriptChange(event.target.value)}
          placeholder="Leave blank to transcribe locally, or paste the words heard in the take…"
        />
        <p>
          Proof uses local Whisper when its model is installed. A pasted
          transcript is an offline fixture/development fallback. Nothing is uploaded.
        </p>
        {modelAvailable === false ? (
          <div className="model-note">
            <span>Local Whisper model is not installed.</span>
            <button type="button" onClick={onDownloadModel} disabled={busyAction !== null}>
              {busyAction === "model"
                ? `Downloading ${Math.round(modelProgress * 100)}%…`
                : "Download locally"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="desk-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={chapterText.trim().length === 0}
          onClick={onOpenTeleprompter}
        >
          Open teleprompter
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!chapter.audio_path || busyAction !== null}
          onClick={onProof}
        >
          {busyAction === `proof-${chapter.id}` ? "Proofing…" : "Proof chapter"}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!chapter.audio_path || busyAction !== null}
          onClick={onMeasure}
        >
          {busyAction === `meter-${chapter.id}` ? "Measuring…" : "Check ACX"}
        </button>
      </div>

      <RecorderPanel
        label="DIY chapter recorder"
        disabled={!window.boothDesk || busyAction !== null}
        onSave={onSaveRecording}
      />

      {projectMode === "duet" ? (
        <DuetTracksPanel
          chapter={chapter}
          busyAction={busyAction}
          narrationSeat={duetNarrationSeat}
          onNarrationSeat={onDuetNarrationSeat}
          onAttach={onAttachDuetTrack}
          onMix={onMixDuet}
        />
      ) : null}

      {proof ? <PickupList pickups={proof.pickups} onPlay={onPlayPickup} onExportMarkers={onExportMarkers} onPunch={onPunchPickup} onUpdate={onUpdatePickup} seatFilter={pickupSeatFilter} onSeatFilter={onPickupSeatFilter} /> : null}
      {acxReport ? <AcxMeter report={acxReport} /> : null}
    </article>
  );
}

function SpanSeatEditor({
  spans,
  disabled,
  onAssign,
}: {
  spans: ScriptSpan[];
  disabled: boolean;
  onAssign: (index: number, seat: "narration" | "N1" | "N2") => void;
}) {
  if (spans.length === 0) {
    return null;
  }
  return (
    <details className="span-seat-editor">
      <summary>Assign dialogue / narration seats ({spans.length} spans)</summary>
      <p>Paint a span by choosing N1 or N2. Solo projects can leave everything as narration.</p>
      <ol>
        {spans.map((span, index) => (
          <li key={`${index}-${span.text.slice(0, 12)}`}>
            <span className="span-seat-text">{span.text || "(line break)"}</span>
            <select
              aria-label={`Seat for span ${index + 1}`}
              value={span.seat}
              disabled={disabled}
              onChange={(event) => onAssign(index, event.target.value as "narration" | "N1" | "N2")}
            >
              <option value="narration">Narration</option>
              <option value="N1">N1</option>
              <option value="N2">N2</option>
            </select>
          </li>
        ))}
      </ol>
    </details>
  );
}

function DuetTracksPanel({
  chapter,
  busyAction,
  narrationSeat,
  onNarrationSeat,
  onAttach,
  onMix,
}: {
  chapter: ChapterFile;
  busyAction: string | null;
  narrationSeat: "N1" | "N2";
  onNarrationSeat: (value: "N1" | "N2") => void;
  onAttach: (kind: "bed" | "overdub") => void;
  onMix: () => Promise<void>;
}) {
  const ready = Boolean(chapter.bed_audio_path && chapter.overdub_audio_path);
  return (
    <section className="duet-tracks-panel" aria-labelledby="duet-tracks-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Phase 5 · async seats</p>
          <h4 id="duet-tracks-title">Bed + overdub</h4>
        </div>
        <span className="result-count">{ready ? "Ready to mix" : "Two tracks needed"}</span>
      </div>
      <p className="panel-honesty">
        N1 is the bed and N2 is the overdub. Booth Desk maps the manuscript seats onto the shared timeline; it does not perform either part.
      </p>
      <div className="duet-track-grid">
        <div className="duet-track-card">
          <strong>N1 bed</strong>
          <span>{chapter.bed_audio_path ?? "Not attached"}</span>
          <button type="button" disabled={busyAction !== null} onClick={() => onAttach("bed")}>{chapter.bed_audio_path ? "Replace bed" : "Attach bed"}</button>
        </div>
        <div className="duet-track-card">
          <strong>N2 overdub</strong>
          <span>{chapter.overdub_audio_path ?? "Not attached"}</span>
          <button type="button" disabled={busyAction !== null} onClick={() => onAttach("overdub")}>{chapter.overdub_audio_path ? "Replace overdub" : "Attach overdub"}</button>
        </div>
      </div>
      <div className="duet-mix-actions">
        <label>Narration seat
          <select value={narrationSeat} onChange={(event) => onNarrationSeat(event.target.value as "N1" | "N2")}>
            <option value="N1">N1</option>
            <option value="N2">N2</option>
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!ready || busyAction !== null} onClick={() => void onMix()}>
          {busyAction === "duet-mix" ? "Mixing…" : "Mix chapter + stems"}
        </button>
      </div>
      {chapter.duet_mix_path ? <p className="duet-output">Last mix: {chapter.duet_mix_path}<br />N1 stem: {chapter.n1_stem_path}<br />N2 stem: {chapter.n2_stem_path}</p> : null}
    </section>
  );
}

function PickupList({ pickups, onPlay, onExportMarkers, onPunch, onUpdate, seatFilter, onSeatFilter }: { pickups: Pickup[]; onPlay: (pickup: Pickup) => void; onExportMarkers: () => void; onPunch: (pickup: Pickup) => void; onUpdate: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void; seatFilter: "all" | "narration" | "N1" | "N2"; onSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void }) {
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const seatPickups = seatFilter === "all" ? pickups : pickups.filter((pickup) => pickup.seat === seatFilter);
  const visiblePickups = statusFilter === "open" ? seatPickups.filter((pickup) => pickup.status === "open") : seatPickups;
  const openCount = seatPickups.filter((pickup) => pickup.status === "open").length;
  return (
    <section className="result-panel" aria-labelledby="pickup-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Word mismatches + long pauses</p>
          <h4 id="pickup-title">Pickups</h4>
        </div>
        <div className="result-heading-actions">
          <label className="pickup-seat-filter">Seat
            <select value={seatFilter} onChange={(event) => onSeatFilter(event.target.value as "all" | "narration" | "N1" | "N2")}>
              <option value="all">All</option>
              <option value="narration">Narration</option>
              <option value="N1">N1</option>
              <option value="N2">N2</option>
            </select>
          </label>
          <label className="pickup-seat-filter">Show
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "open" | "all")}>
              <option value="open">Open</option>
              <option value="all">All</option>
            </select>
          </label>
          <span className="result-count">{openCount} open</span>
          <button className="table-action" type="button" onClick={onExportMarkers}>Export markers</button>
        </div>
      </div>
      {visiblePickups.length === 0 ? (
        <p className="result-empty">
          {statusFilter === "open" && seatPickups.some((pickup) => pickup.status !== "open")
            ? "No open pickups in this filter. Switch Show to All to review completed or ignored lines."
            : "No text mismatches found. Listen once for acting and noise."}
        </p>
      ) : (
        <ul className="pickup-list">
          {visiblePickups.map((pickup) => (
            <li key={pickup.id} className={`pickup-row ${pickup.status}`}>
              <span className="pickup-actions">
                <button type="button" onClick={() => onPlay(pickup)}>Play</button>
                {pickup.status === "open" ? <button type="button" onClick={() => onPunch(pickup)}>Punch</button> : null}
                {pickup.status === "open" ? (
                  <>
                    <button type="button" onClick={() => onUpdate(pickup, { status: "done" })}>Done</button>
                    <button type="button" onClick={() => onUpdate(pickup, { status: "ignored" })}>Ignore</button>
                  </>
                ) : (
                  <button type="button" onClick={() => onUpdate(pickup, { status: "open" })}>Reopen</button>
                )}
              </span>
              <time>{formatTime(pickup.t_start)}</time>
              <div>
                <span className="expected">{pickup.expected || "—"}</span>
                <span className="arrow" aria-hidden="true">→</span>
                <span className="heard">{pickup.heard || "—"}</span>
              </div>
              <span className="kind-badge">{pickup.kind}</span>
              <details className="pickup-note">
                <summary>{pickup.note ? "Edit note" : "Note"}</summary>
                <PickupNoteEditor pickup={pickup} onSave={(note) => onUpdate(pickup, { note })} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PickupNoteEditor({ pickup, onSave }: { pickup: Pickup; onSave: (note: string) => void }) {
  const [note, setNote] = useState(pickup.note ?? "");
  useEffect(() => setNote(pickup.note ?? ""), [pickup.id, pickup.note]);
  return (
    <div className="pickup-note-editor">
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Human note for the collaborator" />
      <button type="button" disabled={note.trim().length === 0} onClick={() => onSave(note)}>Save note</button>
    </div>
  );
}

function AcxMeter({ report }: { report: AcxReport }) {
  const rows = [
    ["RMS", "−23 to −18 dBFS", formatDb(report.rms_dbfs), report.checks.rms],
    ["True peak", "≤ −3.0 dBFS", formatDb(report.true_peak_dbfs), report.checks.true_peak],
    ["Noise floor", "≤ −60 dBFS", formatDb(report.noise_floor_dbfs), report.checks.noise_floor],
    ["Sample rate", "44.1 kHz", `${(report.sample_rate / 1000).toFixed(1)} kHz`, report.checks.sample_rate],
    ["Channels", "Mono or stereo", String(report.channels), report.checks.channels],
    ["Head room tone", "0.5–5.0 s", `${report.head_room_tone_s.toFixed(2)} s`, report.checks.head_room_tone],
    ["Tail room tone", "0.5–5.0 s", `${report.tail_room_tone_s.toFixed(2)} s`, report.checks.tail_room_tone],
  ] as const;

  return (
    <section className="result-panel" aria-labelledby="acx-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Measured locally</p>
          <h4 id="acx-title">ACX check</h4>
        </div>
        <span className={`traffic-light ${report.traffic_light}`}>
          {report.traffic_light}
        </span>
      </div>
      <table className="meter-table">
        <thead>
          <tr><th>Spec</th><th>Required</th><th>Measured</th><th /></tr>
        </thead>
        <tbody>
          {rows.map(([label, required, measured, status]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{required}</td>
              <td>{measured}</td>
              <td><span className={`check-dot ${status}`}>{status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meter-honesty">
        Measurable specs only. ACX can still reject clicks, echo, or a wrong read.
      </p>
    </section>
  );
}

function RoomTestResult({ report }: { report: RoomTestReport }) {
  return (
    <section className="result-panel room-result" aria-labelledby="room-result-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Gain budget</p>
          <h4 id="room-result-title">Room estimate</h4>
        </div>
        <span className={`traffic-light ${report.status}`}>{report.status}</span>
      </div>
      <dl className="room-stats">
        <div><dt>Silence recorded</dt><dd>{report.durationSeconds.toFixed(1)} s</dd></div>
        <div><dt>Noise floor RMS</dt><dd>{formatDb(report.noiseFloorDbfs)}</dd></div>
        <div><dt>Speech RMS used</dt><dd>{formatDb(report.speechRmsDbfs)}</dd></div>
        <div><dt>Needed boost</dt><dd>{report.neededBoostDb.toFixed(1)} dB</dd></div>
        <div><dt>Predicted floor after boost</dt><dd>{formatDb(report.predictedFloorDbfs)}</dd></div>
      </dl>
      <p className={`room-warning ${report.status}`}>{report.warning}</p>
      <p className="meter-honesty">This is a room estimate, not a promise that a finished chapter will pass. Listen for HVAC, clicks, and echo.</p>
    </section>
  );
}

function ChapterComposer({
  title,
  text,
  busy,
  onTitle,
  onText,
  onCancel,
  onSave,
}: {
  title: string;
  text: string;
  busy: boolean;
  onTitle: (value: string) => void;
  onText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="chapter-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <p className="phase-label">Plain text chapter</p>
        <h2 id="composer-title">Paste chapter 1</h2>
        <label htmlFor="chapter-title">Title</label>
        <input id="chapter-title" value={title} onChange={(event) => onTitle(event.target.value)} />
        <label htmlFor="chapter-text">Manuscript</label>
        <textarea
          id="chapter-text"
          rows={13}
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder="Paste the chapter exactly as written…"
          autoFocus
        />
        <div className="actions">
          <button className="primary-button" type="button" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Add chapter"}
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function AppHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">BD</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <span className="local-badge">Local only</span>
      {children}
    </header>
  );
}

function PrivacyNote() {
  return (
    <div className="privacy-note">
      <span className="privacy-icon" aria-hidden="true">✓</span>
      <p>
        <strong>This app does not upload your book or your voice.</strong>
        <br />
        It does not read the book for you.
      </p>
    </div>
  );
}

function AppFooter() {
  return <footer>Free · MIT licensed · No account · No telemetry</footer>;
}

function timedTranscript(text: string, durationSeconds: number): TranscriptWord[] {
  const tokens = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const step = durationSeconds / Math.max(1, tokens.length);
  return tokens.map((token, index) => ({
    text: token,
    start: index * step,
    end: Math.min(durationSeconds, (index + 0.8) * step),
    confidence: 1,
  }));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function float32FromBase64(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, seconds - minutes * 60);
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function formatDb(value: number): string {
  return value === -Infinity ? "−∞ dBFS" : `${value.toFixed(1).replace("-", "−")} dBFS`;
}

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
