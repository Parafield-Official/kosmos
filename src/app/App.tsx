import { useEffect, useMemo, useRef, useState } from "react";
import type { AcxReport } from "../core/acx/measure";
import { getExportReadiness, type ExportReadiness } from "../core/acx/export";
import { BUILTIN_PRESETS, presetTargets, resolvePreset } from "../core/acx/presets";
import { analyzeRoomTest, type RoomTestReport } from "../core/acx/room";
import { encodeWavPcm16 } from "../core/audio/wav";
import { resamplePcmToMono } from "../core/audio/resample";
import {
  alignTranscript,
  isSuppressedPickup,
  normalizeSuppressedWords,
  preservePickupWorkflow,
  type TranscriptWord,
} from "../core/proof/align";
import { buildPickupComparisons, type PickupComparison } from "../core/proof/comparison";
import { scanBookOccurrences, type BookScanReport } from "../core/proof/book-scan";
import { findWordOccurrences, type WordOccurrence } from "../core/proof/occurrences";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  linkGlossarySpans,
  renameGlossaryEntry,
} from "../core/glossary/candidates";
import { fromPlainText } from "../core/manuscript/import";
import { hideMarkdownHeadingMarkers, parsePastedChapter } from "../core/manuscript/split";
import { addChapter, createEmptyProject } from "../core/project/project";
import { normalizeProjectSettings, proofMergeWindowSeconds } from "../core/project/settings";
import {
  addChapterNote,
  canClaimIdentity,
  canApproveChapters,
  setChapterAuthorStatus,
  updatePickup,
} from "../core/project/collaboration";
import { assignPickupSeats, assignSpanSeat } from "../core/duet/seats";
import { buildDuetTimeline } from "../core/duet/timeline";
import { recordingElapsedSeconds } from "../core/recorder/timing";
import {
  bookDashboardStats,
  buildPromptLines,
  clampFontSize,
  createLiveFlagsState,
  dismissLiveFlag,
  filterPromptChapters,
  liveHighlightWordIndex,
  promptTextTokens,
  promptWordCount,
  recordLiveFlag,
  promptChapterStatus,
  readingProgress,
  relevantPromptGlossary,
  remainingReadTimeLabel,
  teleprompterLayout,
  liveCursorForVisibleLine,
  type PromptTheme,
} from "../core/teleprompter/model";
import { appendLiveQcSamples, createLiveQcBuffer, drainLiveQcBuffer, matchLiveWindow, liveBackFlag, liveRequestStatus, liveVoiceStatusCopy, liveWordMark, liveFlagChipCopy, mergeLivePickup, pickupFromLiveFlag, pcmHasSpeech, dropUnstableLiveTail, LIVE_CONTEXT_SECONDS, LIVE_HOP_SECONDS, LIVE_MIN_SPEECH_SECONDS, LIVE_OVERLAP_SECONDS, LIVE_STREAM_HOP_SECONDS, LIVE_QC_STALL_SECONDS, type LiveExpectedWord, type LiveMismatch, type LiveMatchState, type LiveQcBuffer } from "../core/teleprompter/live";
import type {
  AuthorStatus,
  ChapterFile,
  ChapterNote,
  GlossaryEntry,
  Pickup,
  ProjectFile,
  ProjectPerson,
  ProjectSettings,
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

type StudioTab = "book" | "record" | "review" | "finish" | "words" | "people" | "settings";

const STUDIO_TABS: Array<{ id: Exclude<StudioTab, "settings">; label: string; hint: string }> = [
  { id: "book", label: "Book", hint: "Chapters" },
  { id: "record", label: "Record", hint: "Booth" },
  { id: "review", label: "Review", hint: "Pickups" },
  { id: "finish", label: "Finish", hint: "ACX" },
  { id: "words", label: "Words", hint: "Pronounce" },
  { id: "people", label: "People", hint: "Roles" },
];

export function App() {
  const [project, setProject] = useState<ProjectEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectRequestRef = useRef(0);

  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge) {
      return;
    }

    const request = projectRequestRef.current;
    void bridge.reopenRecentProject().then((recent) => {
      if (recent && projectRequestRef.current === request) {
        setProject(recent);
      }
    }).catch((reason: unknown) => {
      if (projectRequestRef.current === request) {
        setError(messageFor(reason, "Could not reopen the last project."));
      }
    });
  }, []);

  async function chooseProject(action: "new" | "open") {
    projectRequestRef.current += 1;
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
        onClose={() => {
          projectRequestRef.current += 1;
          setProject(null);
        }}
        onChange={(next) => setProject((current) => {
          // Ignore a late IPC response from a project that was closed while
          // an operation was still finishing; it must not overwrite a newly
          // opened project in the root screen.
          if (
            !current
            || current.folder !== project.folder
            || current.project.id !== project.project.id
          ) {
            return current;
          }
          return next;
        })}
      />
    );
  }

  return (
    <main className="welcome-shell">
      <header className="welcome-brand">
        <div className="brand-mark" aria-hidden="true">K</div>
        <div>
          <p className="eyebrow">Local audiobook booth</p>
          <h1>Kosmos</h1>
        </div>
      </header>

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="phase-label">Start here</p>
          <h2 id="welcome-title">Make your next chapter sound right.</h2>
          <p className="lede">
            A quiet desk for one book: manuscript, human recordings, pickups,
            and the ACX check — all on this computer.
          </p>

          <div className="actions" aria-label="Project actions">
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void chooseProject("new")}
            >
              {busy ? "Opening…" : "Create a book"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void chooseProject("open")}
            >
              Open a book
            </button>
          </div>
          {error ? <p className="error-note">{error}</p> : null}
        </div>

        <aside className="desk-card" aria-label="Booth workflow">
          <p className="card-kicker">The path</p>
          <h3>One chapter at a time</h3>
          <ol>
            <li>
              <span>01</span>
              Add the page. Record the take.
            </li>
            <li>
              <span>02</span>
              Catch missed words and long pauses.
            </li>
            <li>
              <span>03</span>
              Check levels, then export the pack.
            </li>
          </ol>
          <p className="honesty-copy">
            This app does not read the book for you.
          </p>
        </aside>
      </section>
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
  const projectSettings = useMemo(
    () => normalizeProjectSettings(project.settings),
    [project.settings],
  );
  const exportReadiness = useMemo(
    () => getExportReadiness(project),
    [project.chapters],
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    project.chapters[0]?.id ?? null,
  );
  const [chapterReloadVersion, setChapterReloadVersion] = useState(0);
  const [chapterText, setChapterText] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("Chapter 1");
  const [pastedText, setPastedText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [proof, setProof] = useState<ProofResult | null>(null);
  const proofRef = useRef<ProofResult | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [exportResult, setExportResult] = useState<AcxExportResult | null>(null);
  const [activePanel, setActivePanel] = useState<StudioTab>("book");
  const [scanWord, setScanWord] = useState("");
  const [scanReport, setScanReport] = useState<BookScanReport | null>(null);
  const [studioNavOpen, setStudioNavOpen] = useState(true);
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
  const [promptFontSize, setPromptFontSize] = useState(projectSettings.teleprompter_font_size);
  const [promptTheme, setPromptTheme] = useState<PromptTheme>(projectSettings.teleprompter_theme);
  const [roomTestOpen, setRoomTestOpen] = useState(false);
  const [roomReport, setRoomReport] = useState<RoomTestReport | null>(null);
  const [punchPickup, setPunchPickup] = useState<Pickup | null>(null);
  const [glossaryRecording, setGlossaryRecording] = useState<GlossaryEntry | null>(null);
  const pendingTranscriptRef = useRef<{ chapterId: string; text: string } | null>(null);
  const [pickupSeatFilter, setPickupSeatFilter] = useState<"all" | "narration" | "N1" | "N2">("all");
  const [duetNarrationSeat, setDuetNarrationSeat] = useState<"N1" | "N2">("N1");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rangeStopRef = useRef<(() => void) | null>(null);
  const pendingSeekRef = useRef<{ chapterId: string; start: number } | null>(null);
  const glossaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const glossaryAudioUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    glossaryAudioUrlRef.current = null;
    glossaryAudioRef.current?.pause();
    glossaryAudioRef.current = null;
  }, []);

  useEffect(() => {
    setPromptFontSize(projectSettings.teleprompter_font_size);
    setPromptTheme(projectSettings.teleprompter_theme);
  }, [project.settings?.teleprompter_font_size, project.settings?.teleprompter_theme]);

  const selectedChapter = useMemo(
    () => project.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [project.chapters, selectedChapterId],
  );
  const pickupComparisons = useMemo(() => selectedChapter
    ? buildPickupComparisons({
        rawAudioPath: selectedChapter.raw_audio_path,
        currentAudioPath: selectedChapter.audio_path,
        punches: (project.punch_recordings ?? []).filter((punch) => punch.chapter_id === selectedChapter.id),
      })
    : [], [project.punch_recordings, selectedChapter]);

  useEffect(() => {
    if (!selectedChapter && project.chapters.length > 0) {
      setSelectedChapterId(project.chapters[0].id);
    }
  }, [project.chapters, selectedChapter]);

  // A replacement take, punch, or duet mix keeps the same chapter id but
  // invalidates the previous proof/meter result. Clear those local views when
  // the attached audio changes; the chapter-loading effect below will restore
  // a persisted alignment only when the new take actually has one.
  useEffect(() => {
    setProof(null);
    setAcxReport(null);
    setRoomReport(null);
    setTranscriptText("");
  }, [selectedChapter?.id, selectedChapter?.audio_path]);

  useEffect(() => {
    setRoomReport(null);
  }, [project.room_test_path]);

  useEffect(() => {
    let disposed = false;
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
        if (disposed) {
          return;
        }
        setChapterText(hideMarkdownHeadingMarkers(result.text));
        setChapterSpans(result.spans);
        if (alignment && alignment.chapter_id === selectedChapter.id) {
          setProof({ pickups: alignment.pickups, transcript: alignment.transcript });
          setTranscriptText(alignment.transcript.map((word) => word.text).join(" "));
        } else if (pendingTranscriptRef.current?.chapterId === selectedChapter.id) {
          setTranscriptText(pendingTranscriptRef.current.text);
          pendingTranscriptRef.current = null;
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setNotice(messageFor(reason, "Could not read the chapter text."));
        }
      });
    return () => {
      disposed = true;
    };
  }, [selectedChapter?.id, folder, chapterReloadVersion]);

  useEffect(() => {
    proofRef.current = proof;
  }, [proof]);

  useEffect(() => {
    setChapterManagerOpen(false);
    setSplitOffset(Math.max(1, Math.floor(chapterText.length / 2)));
    setSplitTitle(selectedChapter ? `${selectedChapter.title} (continued)` : "");
  }, [selectedChapter?.id]);

  useEffect(() => {
    let disposed = false;

    setAudioUrl(null);
    if (!selectedChapter?.audio_path || !window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void window.boothDesk.audioUrl({ folder, relativePath: selectedChapter.audio_path })
      .then((url) => {
        if (disposed) {
          return;
        }
        setAudioUrl(url);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setNotice(messageFor(reason, "Could not load the attached audio."));
        }
      });

    return () => {
      disposed = true;
      // booth-audio:// URLs are owned by the main process; there is no Blob
      // object URL to revoke here.
    };
  }, [selectedChapter?.audio_path, folder]);

  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (!pending || !audioUrl || pending.chapterId !== selectedChapterId || activePanel !== "review") {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    pendingSeekRef.current = null;
    const seek = () => {
      audio.currentTime = Math.max(0, pending.start - 0.5);
      void audio.play();
    };
    if (audio.readyState >= 1) {
      seek();
      return;
    }
    audio.addEventListener("loadedmetadata", seek, { once: true });
    return () => {
      audio.removeEventListener("loadedmetadata", seek);
    };
  }, [audioUrl, selectedChapterId, activePanel]);

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
          setNotice(messageFor(reason, "Could not load your role."));
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
          + `${result.project.glossary?.length ?? 0} pronunciation entries are ready to review.`,
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
      const autoTitle = /^Chapter\s+\d+$/iu.test(chapterTitle.trim());
      const parsed = parsePastedChapter(pastedText, chapterTitle);
      const title = autoTitle ? parsed.title : chapterTitle.trim();
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.pasteText({
          ...envelope,
          title,
          text: parsed.text,
        });
        onChange(result);
        const chapter = result.project.chapters[result.project.chapters.length - 1];
        setSelectedChapterId(chapter.id);
      } else {
        const index = project.chapters.length + 1;
        const chapter: ChapterFile = {
          id: `ch${String(index).padStart(2, "0")}`,
          index,
          title: title || `Chapter ${index}`,
          text_path: `manuscript/chapters/${String(index).padStart(2, "0")}.json`,
          pickups_path: `alignment/${String(index).padStart(2, "0")}.json`,
          author_status: "draft",
        };
        onChange({ folder, project: addChapter(project, chapter) });
        setSelectedChapterId(chapter.id);
        setChapterText(parsed.text);
        setChapterSpans(fromPlainText(parsed.text, "txt").spans);
      }
      setPastedText("");
      setComposerOpen(false);
    });
  }

  async function loadExample() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Example chapters are available in the desktop app.");
      return;
    }
    await runAction("example", async () => {
      const result = await window.boothDesk?.loadExample(envelope);
      if (!result) {
        return;
      }
      pendingTranscriptRef.current = { chapterId: result.chapter.id, text: result.transcriptText };
      onChange({ folder: result.folder, project: result.project });
      setSelectedChapterId(result.chapter.id);
      setNotice("Example chapter added. Click Check chapter to see how word review works.");
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
      setNotice("Switch to two-person mode before adding both recordings.");
      return;
    }
    await runAction(`duet-${kind}`, async () => {
      const result = await window.boothDesk?.attachDuetTrack({ ...envelope, chapterId: selectedChapter.id, kind });
      if (result) {
        onChange(result);
        setNotice(`${kind === "bed" ? "Narrator 1" : "Narrator 2"} recording added.`);
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
        // Mixing keeps the alignment as the seat timeline and pickup source;
        // reload it immediately so the filtered pickup list survives the
        // canonical audio-path change without requiring a project reopen.
        setChapterReloadVersion((version) => version + 1);
        setNotice(`Duet mix written to ${result.mixPath}; stems are ${result.n1StemPath} and ${result.n2StemPath}. Timing used ${result.timingSource} mapping.`);
      }
    });
  }

  async function runAcxCheck(chapter: ChapterFile, presetId?: string) {
    if (!chapter.audio_path || !window.boothDesk) {
      setNotice("Attach an audio file before running the ACX check.");
      return;
    }

    await runAction(`meter-${chapter.id}`, async () => {
      const report = await window.boothDesk?.measureAudio({
        folder,
        relativePath: chapter.audio_path as string,
        presetId: presetId ?? projectSettings.spec_preset_id,
      });
      if (!report) {
        return;
      }
      setAcxReport(report);
      await persistProject({
        ...project,
        chapters: project.chapters.map((candidate) => candidate.id === chapter.id
          ? { ...candidate, acx_traffic_light: report.traffic_light, updated_at: new Date().toISOString() }
          : candidate),
        settings: { ...projectSettings, spec_preset_id: report.preset_id },
        updated_at: new Date().toISOString(),
      });
    });
  }

  async function runRoomCheck() {
    if (!project.room_test_path || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Record a few seconds of silence before checking the room.");
      return;
    }
    const bridge = window.boothDesk;
    await runAction("room-meter", async () => {
      const metadata = await bridge.audioMetadata({ folder, relativePath: project.room_test_path as string });
      if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds > 60) {
        throw new Error("The room recording must be 60 seconds or shorter.");
      }
      const decoded = await bridge.decodeAudio({ folder, relativePath: project.room_test_path as string });
      if (!decoded) {
        return;
      }
      if (!Number.isFinite(decoded.durationSeconds) || decoded.durationSeconds > 60) {
        throw new Error("The room recording must be 60 seconds or shorter.");
      }
      let speechRmsDbfs: number | undefined;
      if (selectedChapter?.audio_path) {
        try {
          speechRmsDbfs = (await bridge.measureAudio({
            folder,
            relativePath: selectedChapter.audio_path,
            requireRoomTone: false,
          })).rms_dbfs;
        } catch {
          speechRmsDbfs = undefined;
        }
      }
      setRoomReport(analyzeRoomTest({
        samples: float32FromBase64(decoded.pcmBase64),
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        speechRmsDbfs,
        targetRmsDbfs: projectSettings.acx_target_rms_dbfs,
      }));
    });
  }

  async function runProof(chapter: ChapterFile) {
    if (!chapter.audio_path) {
      setNotice("Add a chapter recording before checking it.");
      return;
    }
    if (chapterText.trim().length === 0) {
      setNotice("This chapter has no manuscript text to compare.");
      return;
    }
    await runAction(`proof-${chapter.id}`, async () => {
      // The audio element can still expose the previous chapter's duration
      // for one render after selection changes. Ask the main process for the
      // selected path's metadata so alignment timestamps never inherit stale
      // UI state.
      let duration: number | undefined;
      if (window.boothDesk && folder !== "(browser preview)") {
        const metadata = await window.boothDesk.audioMetadata({
          folder,
          relativePath: chapter.audio_path as string,
        });
        duration = metadata.durationSeconds;
      } else {
        duration = audioRef.current?.duration;
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
        throw new Error("Audio checking is available in the desktop app. Paste a transcript here to continue.");
      }
      const result = alignTranscript({
        chapterId: chapter.id,
        manuscript: chapterText,
        transcript,
        durationSeconds: duration || 1,
        mergeWindowSeconds: proofMergeWindowSeconds(projectSettings),
        pauseThresholdSeconds: projectSettings.pause_threshold_seconds,
        minConfidence: projectSettings.proof_confidence_floor,
        suppressedWords: projectSettings.suppressed_words,
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
          ? "No word changes or long pauses found. Listen once for delivery and background noise."
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
      setNotice("The speech model is ready.");
    });
  }

  async function exportAcx() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("ACX export is available in the desktop app after the master core is built.");
      return;
    }
    if (!exportReadiness.ready) {
      const titles = exportReadiness.missingAudio.map((chapter) => chapter.title);
      const preview = titles.slice(0, 3).join(", ");
      const suffix = titles.length > 3 ? ` and ${titles.length - 3} more` : "";
      setNotice(`Attach audio for ${titles.length} chapter${titles.length === 1 ? "" : "s"} before exporting (${preview}${suffix}).`);
      return;
    }
    await runAction("export", async () => {
      const result = await window.boothDesk?.exportAcx(envelope);
      if (result) {
        setExportResult(result);
        setNotice(
          result.status === "ready_with_warnings"
            ? `ACX pack is ready with ${result.warningCount} item${result.warningCount === 1 ? "" : "s"} to review. Listen once before delivery.`
            : "ACX pack is ready. Review the report and listen once before delivery.",
        );
      }
    });
  }

  async function exportMarkers() {
    if (!selectedChapter || !proof) {
      setNotice("Check the chapter first so there are review points to export.");
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
        setNotice("Markers written for Audacity, Reaper, and Audition, plus a spreadsheet table and subtitles. Read the README in that folder for which file your editor wants.");
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

  async function persistAlignment(chapterId: string, next: ProofResult) {
    proofRef.current = next;
    setProof(next);
    if (!window.boothDesk || folder === "(browser preview)") {
      return;
    }
    const saved = await window.boothDesk.saveAlignment({
      ...envelope,
      chapterId,
      pickups: next.pickups,
      transcript: next.transcript,
    });
    onChange(saved);
  }

  async function fileLivePickup(pickup: Pickup) {
    if (!selectedChapter || pickup.chapter_id !== selectedChapter.id) {
      return;
    }
    const current = proofRef.current;
    const pickups = mergeLivePickup(current?.pickups ?? [], pickup);
    if (pickups === current?.pickups) {
      return;
    }
    await persistAlignment(selectedChapter.id, {
      pickups,
      transcript: current?.transcript ?? [],
    });
  }

  async function ignoreLivePickup(pickupId: string) {
    if (!selectedChapter) {
      return;
    }
    const current = proofRef.current;
    if (!current?.pickups.some((pickup) => pickup.id === pickupId)) {
      return;
    }
    await persistAlignment(selectedChapter.id, {
      ...current,
      pickups: current.pickups.map((pickup) => pickup.id === pickupId
        ? updatePickup(pickup, { status: "ignored" })
        : pickup),
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
              ? "Room recording saved."
              : "Chapter recording saved and attached.",
        );
      }
    });
  }

  async function applyPunchRecordingWav(wavBase64: string, pickup: Pickup): Promise<boolean> {
    if (!window.boothDesk || folder === "(browser preview)" || !selectedChapter) {
      throw new Error("Add a chapter recording before creating a pickup.");
    }
    return runAction("punch", async () => {
      const result = await window.boothDesk?.applyPunchRecording({
        ...envelope,
        chapterId: selectedChapter.id,
        pickupId: pickup.id,
        expected: pickup.expected,
        heard: pickup.heard,
        tStart: pickup.t_start,
        tEnd: pickup.t_end,
        trimSilence: true,
        wavBase64,
      });
      if (result) {
        onChange(result);
        setNotice("Pickup applied to a new edited take. The original recording is unchanged.");
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
      if (!canClaimIdentity(project, cleanName, identityRole)) {
        throw new Error(
          identityRole === "author"
            ? "This project already has an author. Use the name listed for that author, or choose the narrator role."
            : "That name is already recorded with a different project role.",
        );
      }
      const nextIdentity: LocalIdentity = {
        projectId: project.id,
        personName: cleanName,
        role: identityRole,
        ...(identityRole === "narrator" ? { seat: identitySeat } : {}),
      };
      const normalizedName = cleanName.toLocaleLowerCase("en-US");
      const existing = project.people.filter(
        (person) => person.name.trim().toLocaleLowerCase("en-US") !== normalizedName,
      );
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
      setNotice("Your role is saved.");
    });
  }

  async function shareProject() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Book sharing is available in the desktop app.");
      return;
    }
    await runAction("share", async () => {
      const result = await window.boothDesk?.shareZip({ ...envelope, lightPack });
      if (result) {
        setNotice(
          `${lightPack ? "Smaller" : "Full"} shareable copy ready (${result.fileCount} files).`,
        );
      }
    });
  }

  async function changeProjectMode(mode: "solo" | "duet") {
    await runAction("mode", async () => {
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.setProjectMode({ ...envelope, mode });
        onChange(result);
        setChapterReloadVersion((version) => version + 1);
        if (mode === "solo") {
          setChapterSpans((current) => current.map((span) => ({ ...span, seat: "narration" })));
          setProof(null);
        }
      } else {
        await persistProject({
          ...project,
          mode,
          updated_at: new Date().toISOString(),
        });
        if (mode === "solo") {
          setChapterSpans((current) => current.map((span) => ({ ...span, seat: "narration" })));
          setProof(null);
        }
      }
      setNotice(mode === "duet" ? "Two-person mode is on." : "Solo mode is on.");
    });
  }

  async function persistSettings(patch: Partial<ProjectSettings>) {
    await runAction("settings", async () => {
      const settings = normalizeProjectSettings({ ...projectSettings, ...patch });
      await persistProject({ ...project, settings, updated_at: new Date().toISOString() });
      if (patch.teleprompter_font_size !== undefined) {
        setPromptFontSize(settings.teleprompter_font_size);
      }
      if (patch.teleprompter_theme !== undefined) {
        setPromptTheme(settings.teleprompter_theme);
      }
      setNotice("Preferences saved.");
    });
  }

  async function scanBookForWord() {
    const word = scanWord.trim();
    if (word === "") {
      setNotice("Type a word or a short phrase to scan for.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Scanning the whole book is available in the desktop app.");
      return;
    }
    await runAction("scan-occurrences", async () => {
      const book = await window.boothDesk?.readBookProof(envelope);
      if (!book) {
        return;
      }
      setScanReport(scanBookOccurrences(word, book.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        manuscript: chapter.manuscript,
        transcript: chapter.transcript,
      }))));
    });
  }

  function openOccurrence(chapterId: string, start?: number) {
    // The player for another chapter is not mounted yet, so remember where to
    // land and let the effect below seek once that audio has loaded.
    pendingSeekRef.current = start !== undefined && Number.isFinite(start)
      ? { chapterId, start }
      : null;
    setSelectedChapterId(chapterId);
    setActivePanel("review");
  }

  async function suppressPickupWord(pickup: Pickup) {
    const word = (pickup.expected || pickup.heard).trim();
    if (word === "") {
      setNotice("There is no word here to filter.");
      return;
    }
    if (projectSettings.suppressed_words.includes(word)) {
      setNotice(`“${word}” is already filtered for the whole book.`);
      return;
    }
    const suppressed = [...projectSettings.suppressed_words, word];
    await runAction("settings", async () => {
      const settings = normalizeProjectSettings({ ...projectSettings, suppressed_words: suppressed });
      await persistProject({ ...project, settings, updated_at: new Date().toISOString() });
      // Drop it from the list on screen too, so the effect is visible without
      // re-checking the chapter.
      setProof((current) => current
        ? {
          ...current,
          pickups: current.pickups.filter((candidate) =>
            !isSuppressedPickup(candidate, normalizeSuppressedWords(settings.suppressed_words))),
        }
        : current);
      setNotice(`“${word}” is filtered for the whole book. Re-check other chapters to clear it there.`);
    });
  }

  async function shareSeatPack(seat: "N1" | "N2") {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Voice-specific sharing is available in the desktop app.");
      return;
    }
    await runAction(`seat-pack-${seat}`, async () => {
      const result = await window.boothDesk?.shareSeatPack({ ...envelope, seat });
      if (result) {
        setNotice(`${seat === "N1" ? "Narrator 1" : "Narrator 2"} shareable copy ready (${result.fileCount} files).`);
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
    if (window.boothDesk && folder !== "(browser preview)") {
      setChapterReloadVersion((version) => version + 1);
    }
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

  async function refreshGlossarySuggestions() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Refresh suggestions is available in the desktop app.");
      return;
    }
    await runAction("glossary-refresh", async () => {
      const result = await window.boothDesk?.refreshGlossary(envelope);
      if (result) {
        onChange(result);
        setNotice(`${result.project.glossary?.length ?? 0} pronunciation suggestions remain after the lexicon check.`);
      }
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
      const url = await window.boothDesk?.audioUrl({ folder, relativePath: entry.clip_path as string });
      if (!url) {
        return;
      }
      glossaryAudioRef.current?.pause();
      glossaryAudioUrlRef.current = url;
      const player = new Audio(url);
      glossaryAudioRef.current = player;
      player.addEventListener("ended", () => {
        if (glossaryAudioUrlRef.current === url) {
          glossaryAudioUrlRef.current = null;
          glossaryAudioRef.current = null;
        }
      }, { once: true });
      await player.play();
    });
  }

  async function saveNote() {
    if (!selectedChapter || !identity) {
      setNotice("Choose your role before adding a chapter note.");
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
      setNotice("Choose an author role before changing chapter status.");
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
      setNotice("Chapter editing is available in the desktop app.");
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
        setNotice("Chapter split.");
      }
    });
  }

  async function mergeSelectedWithNext() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Chapter editing is available in the desktop app.");
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
        setChapterReloadVersion((version) => version + 1);
        setProof(null);
        setAcxReport(null);
        setChapterManagerOpen(false);
        setNotice("Chapters merged.");
      }
    });
  }

  async function applyChapterSeat() {
    if (!selectedChapter || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Voice assignment is available in the desktop app.");
      return;
    }
    if (project.mode === "solo" && chapterSeat !== "narration") {
      setNotice("Switch to two-person mode to assign more than one voice.");
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
        setChapterReloadVersion((version) => version + 1);
        setProof(null);
        setAcxReport(null);
        setNotice(`All sections in ${selectedChapter.title} are assigned to ${chapterSeat}.`);
      }
    });
  }

  async function applySpanSeat(index: number, seat: "narration" | "N1" | "N2") {
    if (!selectedChapter) {
      return;
    }
    await runAction(`span-seat-${index}`, async () => {
      const nextSpans = assignSpanSeat(chapterSpans, index, project.mode === "solo" ? "narration" : seat);
      setChapterSpans(nextSpans);
      if (window.boothDesk && folder !== "(browser preview)") {
        const result = await window.boothDesk.setChapterSpans({
          ...envelope,
          chapterId: selectedChapter.id,
          spans: nextSpans,
        });
        onChange(result);
        setProof(null);
        setAcxReport(null);
      }
      setNotice(`Section ${index + 1} is assigned to ${seat}.`);
    });
  }

  function playPickup(pickup: Pickup) {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.currentTime = Math.max(0, pickup.t_start - 0.5);
    void audioRef.current.play();
  }

  function playRange(start: number, end?: number) {
    if (!audioRef.current) {
      return;
    }
    rangeStopRef.current?.();
    audioRef.current.currentTime = Math.max(0, start - 0.5);
    void audioRef.current.play();
    if (end !== undefined && Number.isFinite(end) && end > start) {
      const audio = audioRef.current;
      const stop = () => {
        if (audio.currentTime >= end + 0.5) {
          audio.pause();
          rangeStopRef.current?.();
        }
      };
      audio.addEventListener("timeupdate", stop);
      rangeStopRef.current = () => {
        audio.removeEventListener("timeupdate", stop);
        rangeStopRef.current = null;
      };
    }
  }

  async function exportProofReport() {
    if (!selectedChapter || !proof) {
      setNotice("Check the chapter first so there is a proof report to export.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Proof reports are available in the desktop app.");
      return;
    }
    await runAction("proof-report", async () => {
      const result = await window.boothDesk?.exportProofReport({
        ...envelope,
        chapterId: selectedChapter.id,
        transcript: proof.transcript,
        pickups: proof.pickups,
      });
      if (result) {
        setNotice(`Proof report and pickup packet saved to ${result.folder}.`);
      }
    });
  }

  async function runAction(name: string, action: () => Promise<void>): Promise<boolean> {
    if (actionLockRef.current) {
      return false;
    }
    actionLockRef.current = true;
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
      actionLockRef.current = false;
    }
  }

  function setTeleprompterMode(open: boolean) {
    const layout = teleprompterLayout(open);
    setTeleprompterOpen(layout.teleprompterOpen);
    setStudioNavOpen(layout.studioNavOpen);
  }

  const page = studioPageCopy(activePanel);
  const nextStep = nextBoothStep(project, selectedChapter, proof);
  const reviewCount = project.chapters.reduce((sum, chapter) => {
    if (proof && selectedChapter && chapter.id === selectedChapter.id) {
      return sum + proof.pickups.filter((pickup) => pickup.status === "open").length;
    }
    return sum + (chapter.open_pickups ?? 0);
  }, 0);

  const teleprompterView = teleprompterOpen && selectedChapter ? (
    <Teleprompter
      projectName={project.name}
      chapter={selectedChapter}
      chapterId={selectedChapter.id}
      title={selectedChapter.title}
      chapters={project.chapters}
      people={project.people}
      estimatedMinutes={selectedChapter.estimated_duration_minutes}
      notes={(project.chapter_notes ?? []).filter((note) => note.chapter_id === selectedChapter.id)}
      spans={chapterSpans.length > 0 ? chapterSpans : [{ text: chapterText, seat: "narration", style: [] }]}
      glossary={project.glossary ?? []}
      proof={proof}
      acxReport={acxReport}
      audioUrl={audioUrl}
      modelAvailable={modelAvailable}
      busyAction={busyAction}
      fontSize={promptFontSize}
      theme={promptTheme}
      onFontSize={setPromptFontSize}
      onTheme={setPromptTheme}
      onPlayGlossary={(entry) => void playGlossaryClip(entry)}
      onSelectChapter={(id) => setSelectedChapterId(id)}
      onAttach={(id) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (chapter) void attachAudio(chapter);
      }}
      onProof={(id) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (chapter) void runProof(chapter);
      }}
      onCheckAudio={(id) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (chapter) void runAcxCheck(chapter);
      }}
      onReview={() => {
        setTeleprompterMode(false);
        setActivePanel("review");
        if (
          promptFontSize !== projectSettings.teleprompter_font_size
          || promptTheme !== projectSettings.teleprompter_theme
        ) {
          void persistSettings({
            teleprompter_font_size: promptFontSize,
            teleprompter_theme: promptTheme,
          });
        }
      }}
      onClose={() => {
        setTeleprompterMode(false);
        if (
          promptFontSize !== projectSettings.teleprompter_font_size
          || promptTheme !== projectSettings.teleprompter_theme
        ) {
          void persistSettings({
            teleprompter_font_size: promptFontSize,
            teleprompter_theme: promptTheme,
          });
        }
      }}
      onFileLivePickup={(pickup) => void fileLivePickup(pickup)}
      onIgnoreLivePickup={(pickupId) => void ignoreLivePickup(pickupId)}
    />
  ) : null;

  return (
    <div className={studioNavOpen ? "studio-shell" : "studio-shell nav-closed"}>
      {studioNavOpen ? <aside className="studio-nav" aria-label="Booth">
        <div className="studio-brand">
          <div className="brand-mark" aria-hidden="true">K</div>
          <div>
            <p className="studio-brand-kicker">Kosmos</p>
            <strong>{project.name}</strong>
          </div>
          <button
            className="studio-nav-collapse"
            type="button"
            aria-label="Hide navigation"
            title="Hide navigation"
            aria-expanded={studioNavOpen}
            onClick={() => setStudioNavOpen(false)}
          >
            ‹
          </button>
        </div>

        <nav className="studio-nav-list">
          {STUDIO_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activePanel === tab.id ? "studio-nav-item active" : "studio-nav-item"}
              disabled={busyAction !== null}
              onClick={() => {
                setTeleprompterMode(false);
                setActivePanel(tab.id);
              }}
            >
              <NavIcon name={tab.id} />
              <span>
                <strong>{tab.label}</strong>
                <em>{tab.hint}</em>
              </span>
              {tab.id === "review" && reviewCount > 0 ? (
                <span className="studio-nav-count">{reviewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="studio-nav-foot">
          <p className="studio-storage">
            {project.chapters.length} chapter{project.chapters.length === 1 ? "" : "s"}
            {project.mode === "duet" ? " · Two voices" : " · Solo"}
          </p>
          <button
            type="button"
            className={activePanel === "settings" ? "studio-nav-item active" : "studio-nav-item"}
            disabled={busyAction !== null}
            onClick={() => {
              setTeleprompterMode(false);
              setActivePanel("settings");
            }}
          >
            <NavIcon name="settings" />
            <span><strong>Settings</strong><em>Booth</em></span>
          </button>
          <button className="studio-nav-item quiet" type="button" disabled={busyAction !== null} onClick={onClose}>
            <span><strong>Close book</strong></span>
          </button>
        </div>
      </aside> : null}

      <div className={teleprompterOpen ? "studio-main reader-active" : "studio-main"}>
        {!studioNavOpen ? (
          <button
            className="studio-nav-reveal"
            type="button"
            aria-label="Show navigation"
            title="Show navigation"
            onClick={() => setStudioNavOpen(true)}
          >
            › <span>Menu</span>
          </button>
        ) : null}
        {!teleprompterOpen ? <header className="studio-topbar">
          <div>
            <p className="phase-label">{page.kicker}</p>
            <h2 id="book-home-title">{page.title}</h2>
            <p className="studio-lede">{page.lede}</p>
          </div>
          <div className="studio-top-tools">
            {project.chapters.length > 0 && (activePanel === "record" || activePanel === "review" || activePanel === "finish") ? (
              <label className="chapter-switcher">
                Chapter
                <select
                  value={selectedChapterId ?? ""}
                  disabled={busyAction !== null}
                  onChange={(event) => setSelectedChapterId(event.target.value)}
                >
                  {project.chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="status-pill attached">
              {identity ? `${identity.personName} · ${identity.role}` : "Role not set"}
            </span>
          </div>
        </header> : null}

        {!teleprompterOpen && notice ? <div className="inline-notice" role="status">{notice}</div> : null}

        <section className={teleprompterOpen ? "studio-page reader-page" : "studio-page"} aria-labelledby="book-home-title">
          {teleprompterView}
          {!teleprompterOpen && activePanel === "book" ? (
            <BookPage
              project={project}
              selectedChapter={selectedChapter}
              selectedChapterId={selectedChapterId}
              chapterText={chapterText}
              spans={chapterSpans}
              nextStep={nextStep}
              busyAction={busyAction}
              onSelect={setSelectedChapterId}
              onAttach={(chapter) => void attachAudio(chapter)}
              onPaste={() => setComposerOpen(true)}
              onImport={() => void importChapter()}
              onExample={() => void loadExample()}
              onManage={() => setChapterManagerOpen(true)}
              onAssignSpanSeat={(index, seat) => void applySpanSeat(index, seat)}
              onOpenReview={(id) => {
                setSelectedChapterId(id);
                setActivePanel("review");
              }}
              onOpenTeleprompter={(id) => {
                setSelectedChapterId(id);
                setTeleprompterMode(true);
              }}
              onFollowStep={() => {
                if (project.chapters.length === 0) {
                  setComposerOpen(true);
                  return;
                }
                if (nextStep.chapterId) {
                  setSelectedChapterId(nextStep.chapterId);
                }
                setActivePanel(nextStep.tab);
              }}
            />
          ) : null}

          {!teleprompterOpen && activePanel === "record" ? (
            selectedChapter ? (
              <RecordPage
                chapter={selectedChapter}
                chapterText={chapterText}
                busyAction={busyAction}
                audioUrl={audioUrl}
                audioRef={audioRef}
                project={project}
                roomReport={roomReport}
                roomOpen={roomTestOpen}
                onToggleRoom={() => setRoomTestOpen((open) => !open)}
                onMeasureRoom={() => void runRoomCheck()}
                onSaveRoom={(wav) => saveRecordedWav(wav, "room")}
                onOpenTeleprompter={() => setTeleprompterMode(true)}
                onSaveRecording={(wavBase64) => saveRecordedWav(wavBase64, "chapter")}
                onAttach={(chapter) => void attachAudio(chapter)}
                projectMode={project.mode}
                duetNarrationSeat={duetNarrationSeat}
                onDuetNarrationSeat={setDuetNarrationSeat}
                onAttachDuetTrack={(kind) => void attachDuetTrack(kind)}
                onMixDuet={mixDuetChapter}
              />
            ) : (
              <MissingChapter onAdd={() => { setActivePanel("book"); setComposerOpen(true); }} />
            )
          ) : null}

          {!teleprompterOpen && activePanel === "review" ? (
            selectedChapter ? (
              <ReviewPage
                chapter={selectedChapter}
                chapterText={chapterText}
                transcriptText={transcriptText}
                onTranscriptChange={setTranscriptText}
                busyAction={busyAction}
                audioUrl={audioUrl}
                audioRef={audioRef}
                proof={proof}
                modelAvailable={modelAvailable}
                modelProgress={modelProgress}
                onDownloadModel={() => void downloadWhisperModel()}
                onProof={() => void runProof(selectedChapter)}
                onPlayPickup={playPickup}
                onPlayRange={playRange}
                onExportMarkers={() => void exportMarkers()}
                onExportReport={() => void exportProofReport()}
                onPunchPickup={setPunchPickup}
                onUpdatePickup={(pickup, changes) => void updateProofPickup(pickup, changes)}
                onSuppressPickup={(pickup) => void suppressPickupWord(pickup)}
                pickupSeatFilter={pickupSeatFilter}
                onPickupSeatFilter={setPickupSeatFilter}
                comparisonFolder={folder}
                comparisons={pickupComparisons}
              />
            ) : (
              <MissingChapter onAdd={() => { setActivePanel("book"); setComposerOpen(true); }} />
            )
          ) : null}

          {!teleprompterOpen && activePanel === "finish" ? (
            selectedChapter ? (
              <FinishPage
                chapter={selectedChapter}
                exportReadiness={exportReadiness}
                busyAction={busyAction}
                acxReport={acxReport}
                exportResult={exportResult}
                audioUrl={audioUrl}
                audioRef={audioRef}
                onMeasure={(presetId) => void runAcxCheck(selectedChapter, presetId)}
                specPresetId={projectSettings.spec_preset_id}
                onExport={() => void exportAcx()}
                onShare={() => void shareProject()}
                onPlayRange={playRange}
              />
            ) : (
              <MissingChapter onAdd={() => { setActivePanel("book"); setComposerOpen(true); }} />
            )
          ) : null}

          {!teleprompterOpen && activePanel === "words" ? (
            <GlossaryPanel
              glossary={project.glossary ?? []}
              spelling={glossarySpelling}
              respell={glossaryRespell}
              busyAction={busyAction}
              onSpelling={setGlossarySpelling}
              onRespell={setGlossaryRespell}
              onAdd={() => void addGlossary()}
              onRefresh={() => void refreshGlossarySuggestions()}
              onRename={(id, spelling, respell) => void editGlossary(id, spelling, respell)}
              onDelete={(id) => void removeGlossary(id)}
              onAttachClip={(id) => void attachGlossaryClip(id)}
              onPlayClip={(entry) => void playGlossaryClip(entry)}
              onRecordClip={setGlossaryRecording}
            />
          ) : null}

          {!teleprompterOpen && activePanel === "words" ? (
            <BookWordScanner
              word={scanWord}
              report={scanReport}
              busyAction={busyAction}
              onWord={setScanWord}
              onScan={() => void scanBookForWord()}
              onOpenOccurrence={(chapterId, start) => openOccurrence(chapterId, start)}
            />
          ) : null}

          {!teleprompterOpen && activePanel === "people" ? (
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
          ) : null}

          {!teleprompterOpen && activePanel === "settings" ? (
            <SettingsPanel
              settings={projectSettings}
              busyAction={busyAction}
              onChange={(patch) => void persistSettings(patch)}
            />
          ) : null}
        </section>
      </div>

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
          projectMode={project.mode}
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

      {punchPickup ? (
        <div className="modal-backdrop" role="presentation">
          <section className="chapter-composer punch-recorder" role="dialog" aria-modal="true" aria-labelledby="punch-title">
            <p className="phase-label">Pickup recording</p>
            <h2 id="punch-title">{punchPickup.expected || "Pickup"}</h2>
            <p className="manager-help">Record the replacement line. Kosmos saves a separate WAV; the original chapter take remains untouched.</p>
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
            <p className="phase-label">Pronunciation recording</p>
            <h2 id="glossary-record-title">{glossaryRecording.spelling}</h2>
            <p className="manager-help">Say the word naturally for 3–10 seconds so everyone can hear the intended pronunciation.</p>
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

    </div>
  );
}

function Teleprompter({
  projectName,
  chapter,
  chapterId,
  title,
  chapters,
  people,
  estimatedMinutes,
  notes,
  spans,
  glossary,
  proof,
  acxReport,
  audioUrl,
  modelAvailable,
  busyAction,
  fontSize,
  theme,
  onFontSize,
  onTheme,
  onPlayGlossary,
  onSelectChapter,
  onAttach,
  onProof,
  onCheckAudio,
  onReview,
  onClose,
  onFileLivePickup,
  onIgnoreLivePickup,
}: {
  projectName: string;
  chapter: ChapterFile;
  chapterId: string;
  title: string;
  chapters: ChapterFile[];
  people: ProjectPerson[];
  estimatedMinutes?: number;
  notes: ChapterNote[];
  spans: ScriptSpan[];
  glossary: GlossaryEntry[];
  proof: ProofResult | null;
  acxReport: AcxReport | null;
  audioUrl: string | null;
  modelAvailable: boolean | null;
  busyAction: string | null;
  fontSize: number;
  theme: PromptTheme;
  onFontSize: (value: number) => void;
  onTheme: (value: PromptTheme) => void;
  onPlayGlossary: (entry: GlossaryEntry) => void;
  onSelectChapter: (id: string) => void;
  onAttach: (chapterId: string) => void;
  onProof: (chapterId: string) => void;
  onCheckAudio: (chapterId: string) => void;
  onReview: () => void;
  onClose: () => void;
  onFileLivePickup: (pickup: Pickup) => void;
  onIgnoreLivePickup: (pickupId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => buildPromptLines(spans), [spans]);
  const expectedWords = useMemo<LiveExpectedWord[]>(() => {
    let index = 0;
    return lines.flatMap((line) => {
      const words = promptTextTokens(line.text).filter((token) => token.isWord).map((token) => token.text);
      return words.map((text) => ({ index: index++, lineIndex: line.index, text }));
    });
  }, [lines]);
  const lineWordStarts = useMemo(() => {
    let cursor = 0;
    return new Map(lines.map((line) => {
      const start = cursor;
      cursor += promptWordCount(line.text);
      return [line.index, start] as const;
    }));
  }, [lines]);
  const [liveState, setLiveState] = useState(createLiveFlagsState);
  const [liveStatus, setLiveStatus] = useState<"off" | "starting" | "listening" | "processing" | "error">("off");
  const [liveFlag, setLiveFlag] = useState<LiveMismatch | null>(null);
  const [liveDetectedFlags, setLiveDetectedFlags] = useState<LiveMismatch[]>([]);
  const [liveCursor, setLiveCursor] = useState(0);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveHeardText, setLiveHeardText] = useState("");
  const [liveCheckCount, setLiveCheckCount] = useState(0);
  const [liveLatencyMs, setLiveLatencyMs] = useState<number | null>(null);
  const [liveWhisperAttempted, setLiveWhisperAttempted] = useState(0);
  const [liveWhisperSucceeded, setLiveWhisperSucceeded] = useState(0);
  const [liveWhisperFailed, setLiveWhisperFailed] = useState(0);
  const [liveWhisperLastError, setLiveWhisperLastError] = useState<string | null>(null);
  const [liveWhisperLastWords, setLiveWhisperLastWords] = useState("");
  const [liveStartCursor, setLiveStartCursor] = useState<number | null>(null);
  const [liveSignalLevel, setLiveSignalLevel] = useState(0);
  const [glossaryHint, setGlossaryHint] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [materialsTab, setMaterialsTab] = useState<"chapter" | "manuscript" | "voices" | "words" | "notes">("chapter");
  const [chapterFilter, setChapterFilter] = useState("");
  const [chaptersOpen, setChaptersOpen] = useState(true);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  const [mode, setMode] = useState<"narrate" | "proof">("narrate");
  const [readingFont, setReadingFont] = useState<"serif" | "sans" | "hyperlegible">("serif");
  const [lineSpacing, setLineSpacing] = useState(1.8);
  const [progress, setProgress] = useState(0);
  const wordCount = useMemo(
    () => (spans.map((span) => span.text).join(" ").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length,
    [spans],
  );
  const totalMinutes = estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : wordCount / 155;
  const remainingLabel = useMemo(
    () => remainingReadTimeLabel(totalMinutes, progress),
    [progress, totalMinutes],
  );
  const filteredChapters = useMemo(
    () => filterPromptChapters(chapters, chapterFilter),
    [chapters, chapterFilter],
  );
  const orderedChapters = useMemo(() => filterPromptChapters(chapters, ""), [chapters]);
  const currentChapterPosition = orderedChapters.findIndex((item) => item.id === chapterId);
  const previousChapter = currentChapterPosition > 0 ? orderedChapters[currentChapterPosition - 1] : null;
  const nextChapter = currentChapterPosition >= 0 && currentChapterPosition < orderedChapters.length - 1
    ? orderedChapters[currentChapterPosition + 1]
    : null;
  const chapterGlossary = useMemo(() => relevantPromptGlossary(spans, glossary), [glossary, spans]);
  const chapterExcerpt = useMemo(() => {
    const clean = spans.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
    return clean.length > 260 ? `${clean.slice(0, 257).trimEnd()}…` : clean;
  }, [spans]);
  const voiceCounts = useMemo(() => spans.reduce<Record<string, number>>((counts, span) => {
    const key = span.seat === "narration" ? "Narration" : span.seat === "N1" ? "Narrator 1" : "Narrator 2";
    counts[key] = (counts[key] ?? 0) + (span.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length;
    return counts;
  }, {}), [spans]);
  const currentChapterStatus = promptChapterStatus(chapter);
  const savedPositionKey = `booth-desk:teleprompter-position:${chapterId}`;
  const lineRefs = useRef(new Map<number, HTMLParagraphElement>());
  const wordRefs = useRef(new Map<number, HTMLSpanElement>());
  const positionRestoreRef = useRef(false);
  const liveStateRef = useRef(liveState);
  const liveEnabledRef = useRef(false);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveContextRef = useRef<AudioContext | null>(null);
  const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveGainRef = useRef<GainNode | null>(null);
  const liveSamplesRef = useRef<Float32Array[]>([]);
  const liveSampleCountRef = useRef(0);
  const liveSampleRateRef = useRef(48_000);
  const liveCapturedSecondsRef = useRef(0);
  const liveBufferStartSecondsRef = useRef(0);
  const liveRequestRef = useRef(false);
  const liveMatchStateRef = useRef<LiveMatchState>({ cursor: 0, lastHeardEnd: 0 });
  const liveDismissedRef = useRef<string[]>([]);
  const liveStartingRef = useRef(false);
  const liveMeterUpdateRef = useRef(0);
  const liveSessionRef = useRef(0);
  const liveSentRef = useRef(false);
  const liveFollowStreamRef = useRef(false);
  const liveWhisperBusyRef = useRef(false);
  const liveQcBufferRef = useRef<LiveQcBuffer>(createLiveQcBuffer());
  const liveQcFlushTimerRef = useRef<number | null>(null);
  const liveWhisperPromiseRef = useRef<Promise<void> | null>(null);
  const liveFollowPromiseRef = useRef<Promise<void> | null>(null);
  const liveStoppingRef = useRef(false);
  const liveCursorAnimationRef = useRef<number | null>(null);
  const liveVisualCursorRef = useRef(0);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    let saved = 0;
    try {
      const candidate = Number(window.localStorage.getItem(savedPositionKey));
      saved = Number.isFinite(candidate) ? Math.min(1, Math.max(0, candidate)) : 0;
    } catch {
      saved = 0;
    }
    setProgress(saved);
    positionRestoreRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) {
        const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = maximum * saved;
      }
      positionRestoreRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lines.length, savedPositionKey]);

  function trackReadingProgress() {
    const container = scrollRef.current;
    if (!container || positionRestoreRef.current) {
      return;
    }
    const next = readingProgress(container.scrollTop, container.scrollHeight, container.clientHeight);
    setProgress(next);
    try {
      window.localStorage.setItem(savedPositionKey, String(next));
    } catch {
      // Reading position is a convenience; the teleprompter remains usable
      // when local storage is unavailable.
    }
  }

  function visibleLiveCursor() {
    const container = scrollRef.current;
    const fallback = Math.min(expectedWords.length, Math.max(0, Math.floor(progress * expectedWords.length)));
    if (!container) {
      return fallback;
    }
    const box = container.getBoundingClientRect();
    const measured = lines.map((line) => {
      const node = lineRefs.current.get(line.index);
      const rect = node?.getBoundingClientRect();
      return {
        top: rect ? rect.top - box.top + container.scrollTop : Number.POSITIVE_INFINITY,
        height: rect?.height ?? 0,
        wordStart: lineWordStarts.get(line.index) ?? 0,
      };
    });
    return Math.min(expectedWords.length, liveCursorForVisibleLine(container.scrollTop, measured));
  }

  useEffect(() => {
    if (!liveState.enabled) {
      return;
    }
    const highlightIndex = liveHighlightWordIndex(liveCursor, liveState.enabled);
    if (highlightIndex < 0) {
      return;
    }
    const node = wordRefs.current.get(highlightIndex);
    const container = scrollRef.current;
    if (!node || !container) {
      return;
    }
    const nodeRect = node.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    if (nodeRect.top >= box.top + 48 && nodeRect.bottom <= box.bottom - 48) {
      return;
    }
    container.scrollTop += nodeRect.top - box.top - box.height / 2 + nodeRect.height / 2;
  }, [expectedWords, liveCursor, liveState.enabled]);

  function commitLiveCursor(nextCursor: number) {
    const safeNext = Math.min(expectedWords.length, Math.max(0, Math.floor(nextCursor)));
    liveVisualCursorRef.current = safeNext;
    setLiveCursor(safeNext);
    // Whisper QC is deliberately delayed behind the follow cursor. Do not
    // erase a flag just because Parakeet advanced while that QC request was
    // in flight; the flag is tied to the frozen audio/gold checkpoint passed
    // to liveBackFlag and remains actionable until the narrator decides it.
  }

  function disconnectLiveInput() {
    liveProcessorRef.current?.disconnect();
    liveSourceRef.current?.disconnect();
    liveGainRef.current?.disconnect();
    liveProcessorRef.current = null;
    liveSourceRef.current = null;
    liveGainRef.current = null;
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    void liveContextRef.current?.close();
    liveContextRef.current = null;
  }

  function resetLiveCaptureState() {
    liveSamplesRef.current = [];
    liveSampleCountRef.current = 0;
    liveCapturedSecondsRef.current = 0;
    liveBufferStartSecondsRef.current = 0;
    liveSentRef.current = false;
    liveFollowStreamRef.current = false;
    liveWhisperBusyRef.current = false;
    if (liveQcFlushTimerRef.current !== null) {
      window.clearInterval(liveQcFlushTimerRef.current);
      liveQcFlushTimerRef.current = null;
    }
    liveQcBufferRef.current = createLiveQcBuffer();
    liveWhisperPromiseRef.current = null;
    liveFollowPromiseRef.current = null;
    liveMatchStateRef.current = { ...liveMatchStateRef.current, lastHeardEnd: 0 };
    if (liveCursorAnimationRef.current !== null) {
      window.clearInterval(liveCursorAnimationRef.current);
      liveCursorAnimationRef.current = null;
    }
    liveVisualCursorRef.current = liveCursor;
    setLiveSignalLevel(0);
    setLiveStatus("off");
  }

  function stopLiveCaptureImmediately() {
    liveStoppingRef.current = true;
    liveSessionRef.current += 1;
    liveEnabledRef.current = false;
    disconnectLiveInput();
    void window.boothDesk?.stopLiveTranscription?.();
    resetLiveCaptureState();
    liveStoppingRef.current = false;
  }

  async function stopLiveCapture({ flushQc = false } = {}) {
    if (liveStoppingRef.current) {
      return;
    }
    if (!flushQc || !liveEnabledRef.current || !liveFollowStreamRef.current) {
      stopLiveCaptureImmediately();
      return;
    }

    liveStoppingRef.current = true;
    const sessionId = liveSessionRef.current;
    disconnectLiveInput();
    setLiveStatus("processing");
    try {
      await liveFollowPromiseRef.current;
      if (liveSampleCountRef.current > 0) {
        const pending = new Float32Array(liveSampleCountRef.current);
        let offset = 0;
        for (const chunk of liveSamplesRef.current) {
          pending.set(chunk, offset);
          offset += chunk.length;
        }
        liveQcBufferRef.current = appendLiveQcSamples(
          liveQcBufferRef.current,
          pending,
          liveMatchStateRef.current.cursor,
          Math.max(0, liveCapturedSecondsRef.current - pending.length / liveSampleRateRef.current),
        );
        liveSamplesRef.current = [];
        liveSampleCountRef.current = 0;
      }
      await liveWhisperPromiseRef.current;
      flushLiveQcWindow(liveSampleRateRef.current, sessionId, true);
      await liveWhisperPromiseRef.current;
    } catch {
      // Stopping should never strand the narrator behind a QC failure.
    }
    liveSessionRef.current += 1;
    liveEnabledRef.current = false;
    await window.boothDesk?.stopLiveTranscription?.();
    resetLiveCaptureState();
    liveStoppingRef.current = false;
  }

  useEffect(() => () => {
    if (liveCursorAnimationRef.current !== null) {
      window.clearInterval(liveCursorAnimationRef.current);
    }
    stopLiveCaptureImmediately();
  }, []);

  useEffect(() => {
    stopLiveCaptureImmediately();
    liveMatchStateRef.current = { cursor: 0, lastHeardEnd: 0 };
    liveVisualCursorRef.current = 0;
    setLiveFlag(null);
    setLiveCursor(0);
    setLiveError(null);
    setGlossaryHint(null);
    setLiveHeardText("");
    setLiveCheckCount(0);
    setLiveLatencyMs(null);
  }, [chapterId]);

  async function transcribeLiveWindow(samples: Float32Array, sampleRate: number, startSeconds: number, sessionId: number) {
    const bridge = window.boothDesk;
    if (!bridge?.transcribeBuffer || !liveEnabledRef.current || sessionId !== liveSessionRef.current) {
      return;
    }
    if (!liveFollowStreamRef.current && samples.length < Math.floor(sampleRate * LIVE_MIN_SPEECH_SECONDS)) {
      return;
    }
    liveRequestRef.current = true;
    setLiveStatus(liveRequestStatus(liveFollowStreamRef.current));
    const startedAt = performance.now();
    try {
      const mono = resamplePcmToMono(samples, sampleRate, 16_000);
      const transcription = await promiseWithTimeout(
        liveFollowStreamRef.current
          ? bridge.transcribeBuffer({
              pcmBase64: bytesToBase64(new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength)),
            })
          : bridge.transcribeBuffer({
              audioBase64: bytesToBase64(encodeWavPcm16(mono, 16_000, 1)),
              mimeType: "audio/wav",
              language: "en",
              engine: "whisper",
            }),
        20_000,
        "Speech check took too long. Try a quieter room or stop and start again.",
      );
      if (!liveEnabledRef.current || sessionId !== liveSessionRef.current) {
        return;
      }
      const transcriptWords = liveFollowStreamRef.current
        ? transcription.words
        : dropUnstableLiveTail(
            transcription.words.map((word) => ({
              ...word,
              start: word.start + startSeconds,
              end: word.end + startSeconds,
            })),
            startSeconds + samples.length / sampleRate,
          );
      const cursorBeforeAudio = liveMatchStateRef.current.cursor;
      const result = matchLiveWindow({
        chapterId,
        expected: expectedWords,
        transcript: transcriptWords,
        state: liveMatchStateRef.current,
        flagsEnabled: liveFollowStreamRef.current ? false : liveStateRef.current.enabled,
        confidenceThreshold: 0.9,
        dismissedIds: liveDismissedRef.current,
      });
      liveMatchStateRef.current = result.state;
      commitLiveCursor(result.state.cursor);
      if (result.flag) {
        setLiveFlag(result.flag);
        setLiveDetectedFlags((flags) => flags.some((candidate) => candidate.id === result.flag!.id) ? flags : [...flags, result.flag!]);
        onFileLivePickup(pickupFromLiveFlag(result.flag, chapterId));
      }
      setLiveCheckCount((count) => count + 1);
      setLiveLatencyMs(Math.round(performance.now() - startedAt));
      setLiveHeardText(
        transcriptWords.length > 0
          ? transcriptWords.slice(-5).map((word) => word.text).join(" ")
          : "",
      );
      setLiveStatus("listening");
      setLiveError(null);
      if (liveFollowStreamRef.current) {
        queueWhisperQc(samples, sampleRate, sessionId, cursorBeforeAudio, result.state.cursor, startSeconds);
      }
    } catch (reason) {
      const message = messageFor(reason, "Live flags could not transcribe this microphone window.");
      if (/not running/i.test(message) && liveFollowStreamRef.current) {
        liveFollowStreamRef.current = false;
        setLiveStatus("listening");
        setLiveError(null);
      } else if (liveEnabledRef.current && sessionId === liveSessionRef.current) {
        setLiveStatus("listening");
      }
    } finally {
      liveRequestRef.current = false;
      if (!liveStoppingRef.current && liveEnabledRef.current && sessionId === liveSessionRef.current && shouldFlushLiveBuffer()) {
        flushLiveWindow();
      }
    }
  }

  function queueWhisperQc(
    samples: Float32Array,
    sampleRate: number,
    sessionId: number,
    cursorBeforeAudio: number,
    coveredCursor: number,
    startSeconds: number,
  ) {
    if (liveStateRef.current.dimmed) {
      liveQcBufferRef.current = createLiveQcBuffer();
      return;
    }
    liveQcBufferRef.current = appendLiveQcSamples(
      liveQcBufferRef.current,
      samples,
      cursorBeforeAudio,
      startSeconds,
      coveredCursor,
    );
    flushLiveQcWindow(sampleRate, sessionId);
  }

  function flushLiveQcWindow(sampleRate: number, sessionId: number, force = false) {
    if (liveWhisperBusyRef.current || liveStateRef.current.dimmed) {
      return;
    }
    const drained = drainLiveQcBuffer(
      liveQcBufferRef.current,
      sampleRate,
      force,
      liveMatchStateRef.current.cursor,
    );
    liveQcBufferRef.current = drained.buffer;
    if (!drained.window) {
      return;
    }
    if (!pcmHasSpeech(drained.window.samples)) {
      return;
    }
    setLiveWhisperAttempted((count) => count + 1);
    liveWhisperBusyRef.current = true;
    const promise = transcribeWhisperQc(
      drained.window.samples,
      sampleRate,
      sessionId,
      drained.window.cursor,
      drained.window.startSeconds,
      drained.window.goldCursor,
    );
    liveWhisperPromiseRef.current = promise;
    void promise.finally(() => {
      if (liveWhisperPromiseRef.current === promise) {
        liveWhisperPromiseRef.current = null;
      }
    });
  }

  async function transcribeWhisperQc(
    samples: Float32Array,
    sampleRate: number,
    sessionId: number,
    cursor: number,
    startSeconds: number,
    goldCursor: number,
  ) {
    const bridge = window.boothDesk;
    try {
      if (!bridge?.transcribeBuffer || !liveEnabledRef.current || sessionId !== liveSessionRef.current) {
        return;
      }
      const mono = resamplePcmToMono(samples, sampleRate, 16_000);
      const transcription = await promiseWithTimeout(
        bridge.transcribeBuffer({
          audioBase64: bytesToBase64(encodeWavPcm16(mono, 16_000, 1)),
          mimeType: "audio/wav",
          language: "en",
          engine: "whisper",
        }),
        20_000,
        "Speech check took too long. Try a quieter room or stop and start again.",
      );
      if (!liveEnabledRef.current || sessionId !== liveSessionRef.current || liveStateRef.current.dimmed) {
        return;
      }
      setLiveWhisperLastWords(transcription.words.slice(-12).map((word) => word.text).join(" "));
      const transcript = transcription.words.map((word) => ({
        ...word,
        start: word.start + startSeconds,
        end: word.end + startSeconds,
      }));
      // The low-latency follow model is intentionally allowed to lag behind
      // on machines where its Metal backend is unavailable. Whisper has just
      // judged this same frozen audio window, so use its ordered words as a
      // conservative cursor fallback instead of repeatedly grading later
      // audio against the first stalled phrase. This is independent of the
      // manuscript/test vocabulary: matchLiveWindow only advances on a
      // nearby exact/similar/number match and never moves the cursor back.
      const followBeforeWhisper = liveMatchStateRef.current;
      const whisperFollow = matchLiveWindow({
        chapterId,
        expected: expectedWords,
        transcript,
        state: followBeforeWhisper,
        flagsEnabled: false,
        confidenceThreshold: 0.55,
      });
      if (whisperFollow.state.cursor > followBeforeWhisper.cursor) {
        liveMatchStateRef.current = whisperFollow.state;
        commitLiveCursor(whisperFollow.state.cursor);
      }
      // A single QC clip can contain two adjacent slips (for example a
      // dropped plural followed by a content-word substitution). Walk the
      // same frozen window again after each result so the first mismatch does
      // not hide the next one. The temporary IDs only affect this request;
      // user dismissals remain the persistent filter.
      const requestDismissed = [...liveDismissedRef.current];
      const flags: LiveMismatch[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const flag = liveBackFlag({
          chapterId,
          expected: expectedWords,
          transcript,
          state: { cursor, lastHeardEnd: 0 },
          flagsEnabled: true,
          // Whisper runs behind the low-latency follow model. Grade this audio
          // against the gold checkpoint captured when the phrase was drained;
          // reading the mutable cursor here re-anchors slow results to later
          // manuscript text and silently drops real pickups.
          goldCursor,
          confidenceThreshold: 0.9,
          dismissedIds: requestDismissed,
        });
        if (!flag) {
          break;
        }
        flags.push(flag);
        requestDismissed.push(flag.id);
      }
      for (const flag of flags) {
        setLiveFlag(flag);
        setLiveDetectedFlags((detected) => detected.some((candidate) => candidate.id === flag.id) ? detected : [...detected, flag]);
        onFileLivePickup(pickupFromLiveFlag(flag, chapterId));
      }
      setLiveWhisperSucceeded((count) => count + 1);
      setLiveWhisperLastError(null);
    } catch (reason) {
      // Back-check is optional, but never make a failed Whisper run look like
      // a successful one in the desktop diagnostics.
      console.warn("Whisper back-check failed", reason);
      setLiveWhisperFailed((count) => count + 1);
      setLiveWhisperLastError(messageFor(reason, "Whisper back-check failed."));
    } finally {
      liveWhisperBusyRef.current = false;
      if (!liveStoppingRef.current && liveEnabledRef.current && sessionId === liveSessionRef.current && !liveStateRef.current.dimmed) {
        flushLiveQcWindow(sampleRate, sessionId);
      }
    }
  }

  function shouldFlushLiveBuffer() {
    const sampleRate = liveSampleRateRef.current;
    const count = liveSampleCountRef.current;
    if (liveFollowStreamRef.current) {
      return count >= sampleRate * LIVE_STREAM_HOP_SECONDS;
    }
    if (count < sampleRate * LIVE_MIN_SPEECH_SECONDS) {
      return false;
    }
    return !liveSentRef.current || count >= sampleRate * LIVE_CONTEXT_SECONDS;
  }

  function flushLiveWindow() {
    const sampleRate = liveSampleRateRef.current;
    const minSamples = liveFollowStreamRef.current
      ? sampleRate * LIVE_STREAM_HOP_SECONDS
      : sampleRate * LIVE_MIN_SPEECH_SECONDS;
    if (liveRequestRef.current || liveSampleCountRef.current < minSamples) {
      return;
    }
    const samples = new Float32Array(liveSampleCountRef.current);
    let offset = 0;
    for (const chunk of liveSamplesRef.current) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    if (liveFollowStreamRef.current) {
      liveSamplesRef.current = [];
      liveSampleCountRef.current = 0;
      liveSentRef.current = true;
      const startSeconds = Math.max(0, liveCapturedSecondsRef.current - samples.length / sampleRate);
      const promise = transcribeLiveWindow(samples, sampleRate, startSeconds, liveSessionRef.current);
      liveFollowPromiseRef.current = promise;
      void promise.finally(() => {
        if (liveFollowPromiseRef.current === promise) {
          liveFollowPromiseRef.current = null;
        }
      });
      return;
    }
    const overlapSamples = Math.min(samples.length, Math.round(sampleRate * LIVE_OVERLAP_SECONDS));
    const overlap = samples.slice(samples.length - overlapSamples);
    const keepOverlap = () => {
      liveSamplesRef.current = overlap.length > 0 ? [overlap] : [];
      liveSampleCountRef.current = overlap.length;
      liveBufferStartSecondsRef.current = Math.max(0, liveCapturedSecondsRef.current - overlap.length / sampleRate);
    };
    if (!pcmHasSpeech(samples)) {
      if (samples.length >= Math.round(sampleRate * LIVE_CONTEXT_SECONDS)) {
        keepOverlap();
      }
      return;
    }
    const contextSamples = Math.min(samples.length, Math.round(sampleRate * LIVE_CONTEXT_SECONDS));
    const windowSamples = samples.subarray(samples.length - contextSamples);
    const startSeconds = Math.max(0, liveCapturedSecondsRef.current - windowSamples.length / sampleRate);
    keepOverlap();
    liveSentRef.current = true;
    void transcribeLiveWindow(windowSamples, sampleRate, startSeconds, liveSessionRef.current);
  }

  async function startLiveCapture() {
    if (liveStartingRef.current || liveStoppingRef.current || liveEnabledRef.current || liveStateRef.current.dimmed) {
      return;
    }
    if (!window.boothDesk?.transcribeBuffer) {
      setLiveError("Word checks are available in the desktop app.");
      setLiveStatus("error");
      return;
    }
    if (modelAvailable === false) {
      setLiveError("The speech model is not ready. Open Review and download it before starting voice follow.");
      setLiveStatus("error");
      return;
    }
    liveStartingRef.current = true;
    setLiveError(null);
    setLiveStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not available in this app window.");
      }
      // Load the persistent local recognizer while the button visibly says
      // "Starting". Subsequent microphone windows reuse that loaded model;
      // the main process releases it when this session stops.
      const warmed = await window.boothDesk.startLiveTranscription();
      liveFollowStreamRef.current = Boolean(warmed?.streaming);
      // A Parakeet follow server can still warm successfully when Whisper
      // failed. Keep voice-follow usable, but make the missing proofreader
      // explicit instead of presenting a healthy-looking cursor-only run.
      const whisperReady = warmed?.backcheck === "whisper";
      if (!whisperReady) {
        setLiveWhisperLastError("Whisper back-check is unavailable; cursor follow is still running.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      liveEnabledRef.current = true;
      liveStreamRef.current = stream;
      liveContextRef.current = context;
      liveSourceRef.current = source;
      liveProcessorRef.current = processor;
      liveGainRef.current = gain;
      liveSampleRateRef.current = context.sampleRate;
      liveSamplesRef.current = [];
      liveSampleCountRef.current = 0;
      liveCapturedSecondsRef.current = 0;
      liveBufferStartSecondsRef.current = 0;
      liveSentRef.current = false;
      liveQcBufferRef.current = createLiveQcBuffer();
      liveWhisperPromiseRef.current = null;
      liveFollowPromiseRef.current = null;
      liveSessionRef.current += 1;
      // Scroll percentage is a visual position, not a word index: headings,
      // spacing, and wrapped lines make multiplying it by the chapter word
      // count wrong. Use the measured first visible manuscript line.
      const startingCursor = visibleLiveCursor();
      setLiveStartCursor(startingCursor);
      liveMatchStateRef.current = { cursor: startingCursor, lastHeardEnd: 0 };
      liveVisualCursorRef.current = startingCursor;
      setLiveCursor(startingCursor);
      liveDismissedRef.current = [];
      setLiveHeardText("");
      setLiveCheckCount(0);
      setLiveLatencyMs(null);
      setLiveWhisperAttempted(0);
      setLiveWhisperSucceeded(0);
      setLiveWhisperFailed(0);
      setLiveWhisperLastError(null);
      setLiveWhisperLastWords("");
      setLiveDetectedFlags([]);
      processor.onaudioprocess = (event) => {
        if (!liveEnabledRef.current) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input);
        let sumSquares = 0;
        for (const sample of input) {
          sumSquares += sample * sample;
        }
        const rms = input.length > 0 ? Math.sqrt(sumSquares / input.length) : 0;
        const now = performance.now();
        if (now - liveMeterUpdateRef.current >= 250) {
          liveMeterUpdateRef.current = now;
          setLiveSignalLevel(Math.min(1, rms * 8));
        }
        liveSamplesRef.current.push(copy);
        liveSampleCountRef.current += copy.length;
        liveCapturedSecondsRef.current += copy.length / liveSampleRateRef.current;
        if (shouldFlushLiveBuffer()) {
          flushLiveWindow();
        }
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);
      await context.resume();
      const nextState = { ...createLiveFlagsState(), enabled: true };
      liveStateRef.current = nextState;
      setLiveState(nextState);
      setLiveStatus("listening");
      if (liveQcFlushTimerRef.current !== null) {
        window.clearInterval(liveQcFlushTimerRef.current);
      }
      liveQcFlushTimerRef.current = window.setInterval(() => {
        if (!liveEnabledRef.current || liveStateRef.current.dimmed) {
          return;
        }
        flushLiveQcWindow(liveSampleRateRef.current, liveSessionRef.current);
      }, Math.round(LIVE_QC_STALL_SECONDS * 1000));
    } catch (reason) {
      stopLiveCaptureImmediately();
      setLiveError(messageFor(reason, "Microphone access or word checks failed."));
      setLiveStatus("error");
    } finally {
      liveStartingRef.current = false;
    }
  }

  function setLiveEnabled(enabled: boolean) {
    if (enabled) {
      void startLiveCapture();
      return;
    }
    void stopLiveCapture({ flushQc: true });
    const nextState = { ...liveStateRef.current, enabled: false };
    liveStateRef.current = nextState;
    setLiveState(nextState);
    setLiveFlag(null);
  }

  function decideLiveFlag(isTrueMismatch: boolean) {
    const current = liveFlag;
    if (!current) {
      return;
    }
    const nextState = isTrueMismatch
      ? recordLiveFlag(liveStateRef.current, { id: current.id, isTrueMismatch: true })
      : dismissLiveFlag(liveStateRef.current, current.id);
    liveDismissedRef.current = nextState.dismissedIds;
    liveStateRef.current = nextState;
    setLiveState(nextState);
    setLiveFlag(null);
    if (!isTrueMismatch) {
      onIgnoreLivePickup(current.id);
    }
    if (nextState.dimmed) {
      liveStateRef.current = nextState;
      setLiveState(nextState);
      setLiveError("Word checks paused after false alarms; voice follow is still running.");
    }
  }

  function undoLiveDim() {
    const nextState = { ...createLiveFlagsState(), enabled: true };
    liveStateRef.current = nextState;
    setLiveState(nextState);
    setLiveError(null);
    void startLiveCapture();
  }

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

  const liveWordIndex = liveHighlightWordIndex(liveCursor, liveState.enabled);
  const liveLineIndex = liveWordIndex >= 0 ? expectedWords[liveWordIndex]?.lineIndex : undefined;

  return (
    <div className={`booth-stage booth-stage-v2 teleprompter-${theme}${chaptersOpen ? "" : " chapters-closed"}${materialsOpen ? "" : " materials-closed"}`}>
      {chaptersOpen ? (
        <aside className="booth-chapters" aria-label="Book chapters">
          <header className="booth-rail-heading">
            <div>
              <p>Kosmos</p>
              <strong>{projectName}</strong>
            </div>
            <button type="button" aria-label="Hide chapters" onClick={() => setChaptersOpen(false)}>←</button>
          </header>
          <label className="booth-chapter-search">
            <span>Find a chapter</span>
            <input value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} placeholder="Search chapters" />
          </label>
          <p className="booth-chapters-kicker">{filteredChapters.length} of {chapters.length} chapters</p>
          <ul>
            {filteredChapters.map((item) => {
              const status = promptChapterStatus(item);
              return (
                <li key={item.id} className={item.id === chapterId ? "active" : ""}>
                  <button
                    type="button"
                    className="booth-chapter-select"
                    aria-current={item.id === chapterId ? "page" : undefined}
                    onClick={() => onSelectChapter(item.id)}
                  >
                    <em>{String(item.index).padStart(2, "0")}</em>
                    <strong>{item.title}</strong>
                    <span className={`booth-chapter-state ${status.tone}`}>{status.label}</span>
                  </button>
                  <button
                    type="button"
                    className="booth-proof-shortcut"
                    aria-label={`Open proofing for ${item.title}`}
                    title="Open proofing"
                    onClick={() => {
                      setMode("proof");
                      onSelectChapter(item.id);
                    }}
                  >
                    Check
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      <div className="booth-stage-main">
        <header className="booth-stage-top">
          <div className="booth-breadcrumbs">
            {!chaptersOpen ? <button type="button" className="booth-icon-button" onClick={() => setChaptersOpen(true)}>Chapters</button> : null}
            <button type="button" disabled={!previousChapter} aria-label="Previous chapter" onClick={() => previousChapter && onSelectChapter(previousChapter.id)}>‹</button>
            <div>
              <span>{projectName}</span>
              <h2>{title}</h2>
            </div>
            <button type="button" disabled={!nextChapter} aria-label="Next chapter" onClick={() => nextChapter && onSelectChapter(nextChapter.id)}>›</button>
          </div>
          <div className="booth-top-actions">
            <div className="booth-mode-switch" role="tablist" aria-label="Teleprompter mode">
              <button type="button" className={mode === "narrate" ? "active" : ""} role="tab" aria-selected={mode === "narrate"} onClick={() => setMode("narrate")}>Narrate</button>
              <button type="button" className={mode === "proof" ? "active" : ""} role="tab" aria-selected={mode === "proof"} onClick={() => setMode("proof")}>Proofing</button>
            </div>
            <button type="button" className={materialsOpen ? "booth-icon-button active" : "booth-icon-button"} aria-expanded={materialsOpen} onClick={() => setMaterialsOpen((open) => !open)}>Materials</button>
            <button type="button" className="booth-icon-button" onClick={onClose}>Leave</button>
          </div>
        </header>

        {mode === "narrate" ? (
          <>
            <p className="booth-honesty">
              Voice follow listens to your microphone to move the page and check possible word changes; it does not save a recording. Space and PageDown always remain available.
              {liveState.dimmed ? <button type="button" className="table-action" onClick={undoLiveDim}>Try word checks again</button> : null}
              {glossaryHint ? <strong role="status">{glossaryHint}</strong> : null}
            </p>

            <LiveVoiceStatus
              modelAvailable={modelAvailable}
              status={liveStatus}
              enabled={liveState.enabled}
              dimmed={liveState.dimmed}
              error={liveError}
              heardText={liveHeardText}
              checkCount={liveCheckCount}
              latencyMs={liveLatencyMs}
              whisperAttempted={liveWhisperAttempted}
              whisperSucceeded={liveWhisperSucceeded}
              whisperFailed={liveWhisperFailed}
              whisperLastError={liveWhisperLastError}
              whisperLastWords={liveWhisperLastWords}
              startCursor={liveStartCursor}
              detectedFlags={liveDetectedFlags}
              signalLevel={liveSignalLevel}
              cursor={liveCursor}
              totalWords={expectedWords.length}
            />

            <div
              ref={scrollRef}
              className="teleprompter-scroll"
              tabIndex={0}
              onScroll={trackReadingProgress}
            >
              <article
                className={`teleprompter-page reading-font-${readingFont}`}
                style={{ fontSize: `${clampFontSize(fontSize)}px`, lineHeight: lineSpacing }}
              >
                {lines.map((line) => {
                  let wordIndex = lineWordStarts.get(line.index) ?? 0;
                  return (
                    <p
                      key={line.index}
                      ref={(node) => { if (node) lineRefs.current.set(line.index, node); else lineRefs.current.delete(line.index); }}
                      className={`teleprompter-line${liveLineIndex === line.index ? " teleprompter-line-live" : ""}`}
                      aria-current={liveLineIndex === line.index ? "location" : undefined}
                    >
                      {line.segments.map((segment, index) => {
                        const glossaryEntry = segment.glossary_id
                          ? glossary.find((entry) => entry.id === segment.glossary_id)
                          : undefined;
                        const segmentTokens = promptTextTokens(segment.text);
                        return (
                          <span
                            key={`${line.index}-${index}-${segment.text.slice(0, 8)}`}
                            className={glossaryEntry ? "prompt-glossary-word" : undefined}
                            title={glossaryEntry?.respell ?? (glossaryEntry ? "Pronunciation" : undefined)}
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
                              color: segment.seat === "N1"
                                ? "#d88a64"
                                : segment.seat === "N2"
                                  ? "#82a9d7"
                                  : segment.dialogue
                                    ? "#b0834f"
                                    : undefined,
                            }}
                          >{segmentTokens.map((token, tokenIndex) => {
                            if (!token.isWord) {
                              return <span key={`${line.index}-${index}-${tokenIndex}`}>{token.text}</span>;
                            }
                            const currentWordIndex = wordIndex;
                            wordIndex += 1;
                            const mark = liveWordMark(currentWordIndex, liveWordIndex, liveFlag?.expectedIndex);
                            const wordClass = [
                              mark.follow ? "teleprompter-word-live" : "",
                              mark.flag ? "teleprompter-word-flag" : "",
                            ].filter(Boolean).join(" ") || undefined;
                            return (
                              <span
                                key={`${line.index}-${index}-${tokenIndex}`}
                                ref={(node) => { if (node) wordRefs.current.set(currentWordIndex, node); else wordRefs.current.delete(currentWordIndex); }}
                                className={wordClass}
                                aria-current={mark.follow ? "true" : undefined}
                              >
                                {token.text}
                                {mark.flag && liveFlag ? (
                                  <span className="teleprompter-word-flag-chip" role="alert" onClick={(event) => event.stopPropagation()}>
                                    <span>{liveFlagChipCopy(liveFlag)}</span>
                                    <button type="button" onClick={(event) => { event.stopPropagation(); decideLiveFlag(false); }}>Dismiss</button>
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}</span>
                        );
                      })}
                    </p>
                  );
                })}
                <section className="booth-end-card">
                  <strong>Finished this chapter?</strong>
                  <span>Attach the take and check it against the manuscript while the read is still fresh.</span>
                  <button type="button" className="primary-button" onClick={() => setMode("proof")}>Open proofing</button>
                </section>
              </article>
            </div>
          </>
        ) : (
          <section className="booth-proof-panel" aria-label={`Proofing ${title}`}>
            <header>
              <div>
                <p className="card-kicker">Proofing</p>
                <h3>{title}</h3>
                <p>Check the saved take against this chapter, then open the full pickup desk when you need exact edits.</p>
              </div>
              <span className={`booth-chapter-state large ${currentChapterStatus.tone}`}>{currentChapterStatus.label}</span>
            </header>
            {chapter.audio_path ? (
              <>
                {audioUrl ? <audio controls src={audioUrl} preload="metadata" /> : <p className="booth-empty">Loading the attached recording…</p>}
                <div className="booth-proof-stats">
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.status === "open").length ?? chapter.open_pickups ?? 0}</strong><span>Open pickups</span></article>
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.kind !== "pause" && pickup.status === "open").length ?? "—"}</strong><span>Word changes</span></article>
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.kind === "pause" && pickup.status === "open").length ?? "—"}</strong><span>Long pauses</span></article>
                  <article><strong>{acxReport ? checkStatusLabel(acxReport.traffic_light) : chapter.acx_traffic_light ? checkStatusLabel(chapter.acx_traffic_light) : "Not checked"}</strong><span>Audio check</span></article>
                </div>
                <div className="booth-proof-actions">
                  <button type="button" className="primary-button" disabled={busyAction !== null} onClick={() => onProof(chapterId)}>{busyAction?.startsWith("proof-") ? "Checking…" : "Check this chapter"}</button>
                  <button type="button" className="secondary-button" disabled={busyAction !== null} onClick={() => onCheckAudio(chapterId)}>{busyAction?.startsWith("meter-") ? "Measuring…" : "Check audio levels"}</button>
                  <button type="button" className="secondary-button" onClick={onReview}>Open full review</button>
                </div>
              </>
            ) : (
              <div className="booth-proof-empty">
                <span aria-hidden="true">♪</span>
                <h4>No recording attached yet</h4>
                <p>Add the chapter take, then Kosmos can find word changes, pauses, and audio issues.</p>
                <button type="button" className="primary-button" disabled={busyAction !== null} onClick={() => onAttach(chapterId)}>Attach recording</button>
              </div>
            )}
          </section>
        )}

        <footer className="booth-dock">
          {mode === "narrate" ? (
            <button
              className={`primary-button booth-start-button ${liveState.enabled ? "booth-stop-button" : "booth-narrate-button"}`}
              type="button"
              disabled={liveStatus === "starting"}
              onClick={() => setLiveEnabled(!liveState.enabled)}
            >
              <span className="booth-start-icon" aria-hidden="true">{liveState.enabled ? "Ⅱ" : "▶"}</span>
              <span>{liveState.enabled ? "Stop" : "Start narrating"}</span>
            </button>
          ) : (
            <button className="primary-button booth-start-button" type="button" onClick={() => setMode("narrate")}>Back to narration</button>
          )}
          <div className="booth-progress-wrap">
            <span>{mode === "narrate" ? remainingLabel : currentChapterStatus.label}</span>
            <div className="booth-progress" role="progressbar" aria-label="Chapter reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
          <div className="booth-font" aria-label="Font size">
            <button type="button" aria-label="Smaller type" onClick={() => onFontSize(clampFontSize(fontSize - 4))}>−</button>
            <span>{clampFontSize(fontSize)} pt</span>
            <button type="button" aria-label="Larger type" onClick={() => onFontSize(clampFontSize(fontSize + 4))}>+</button>
          </div>
          <div className="booth-settings-wrap">
            <button type="button" className={settingsOpen ? "booth-icon-button active" : "booth-icon-button"} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>Reading settings</button>
            {settingsOpen ? (
              <div className="booth-settings" role="dialog" aria-label="Reading settings">
                <p className="card-kicker">Reading font</p>
                <div className="booth-choice-grid" role="radiogroup" aria-label="Reading font">
                  {(["serif", "sans", "hyperlegible"] as const).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={readingFont === value} className={readingFont === value ? "active" : ""} onClick={() => setReadingFont(value)}>
                      {value === "serif" ? "Book serif" : value === "sans" ? "Clean sans" : "Hyperlegible"}
                    </button>
                  ))}
                </div>
                <p className="card-kicker">Theme</p>
                <div className="booth-theme-grid" role="radiogroup" aria-label="Reading theme">
                  {(["cream", "sepia", "dark"] as const).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? `theme-${value} active` : `theme-${value}`} onClick={() => onTheme(value)}>
                      {value === "cream" ? "Cream" : value === "sepia" ? "Sepia" : "Dark"}
                    </button>
                  ))}
                </div>
                <p className="card-kicker">Line spacing</p>
                <div className="booth-choice-grid" role="radiogroup" aria-label="Line spacing">
                  {[1.35, 1.55, 1.8].map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={lineSpacing === value} className={lineSpacing === value ? "active" : ""} onClick={() => setLineSpacing(value)}>{value === 1.35 ? "Tight" : value === 1.55 ? "Comfortable" : "Open"}</button>
                  ))}
                </div>
                <label className="booth-toggle">
                  <span><strong>Flag possible word changes</strong><em>Listen-only. The microphone audio is not saved as a take.</em></span>
                  <input type="checkbox" checked={liveState.enabled} disabled={liveStatus === "starting" || liveStatus === "processing"} onChange={(event) => setLiveEnabled(event.target.checked)} />
                </label>
              </div>
            ) : null}
          </div>
        </footer>
      </div>

      {materialsOpen ? (
        <aside className="booth-materials" aria-label="Materials">
          <header className="booth-materials-heading">
            <div><p>Materials</p><strong>{title}</strong></div>
            <button type="button" aria-label="Close materials" onClick={() => setMaterialsOpen(false)}>×</button>
          </header>
          <div className="booth-materials-tabs" role="tablist" aria-label="Chapter materials">
            {(["chapter", "manuscript", "voices", "words", "notes"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={materialsTab === tab} className={materialsTab === tab ? "active" : ""} onClick={() => setMaterialsTab(tab)}>
                {tab === "chapter" ? "Chapter" : tab === "manuscript" ? "Manuscript" : tab === "voices" ? "Voices" : tab === "words" ? "Words" : "Notes"}
              </button>
            ))}
          </div>
          {materialsTab === "chapter" ? (
            <div className="booth-material-card">
              <p className="card-kicker">At a glance</p>
              <div className="booth-material-stats">
                <span><strong>{wordCount.toLocaleString()}</strong> words</span>
                <span><strong>{Math.max(1, Math.round(totalMinutes))}</strong> min</span>
                <span><strong>{notes.length}</strong> notes</span>
              </div>
              <p>{chapterExcerpt || "This chapter has no manuscript text yet."}</p>
            </div>
          ) : materialsTab === "manuscript" ? (
            <div className="booth-material-manuscript">
              {spans.length === 0 ? <p className="booth-empty">No manuscript text is available for this chapter yet.</p> : spans.map((span, index) => <p key={`${span.text}-${index}`}>{span.text}</p>)}
            </div>
          ) : materialsTab === "voices" ? (
            <ul className="booth-voice-list">
              {people.length > 0 ? people.map((person) => (
                <li key={`${person.name}-${person.role}-${person.seat ?? ""}`}>
                  <span aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{person.name}</strong><p>{person.role === "author" ? "Author" : person.seat === "N1" ? "Narrator 1" : person.seat === "N2" ? "Narrator 2" : "Narrator"}</p></div>
                </li>
              )) : Object.entries(voiceCounts).map(([voice, count]) => (
                <li key={voice}><span aria-hidden="true">{voice.slice(-1)}</span><div><strong>{voice}</strong><p>{count.toLocaleString()} words in this chapter</p></div></li>
              ))}
            </ul>
          ) : materialsTab === "words" ? (
            chapterGlossary.length === 0 ? (
              <p className="booth-empty">No pronunciation entries are linked to this chapter yet.</p>
            ) : (
              <ul className="booth-word-list">
                {chapterGlossary.map((entry) => (
                  <li key={entry.id}>
                    <div><strong>{entry.spelling}</strong>{entry.respell ? <span>{entry.respell}</span> : null}</div>
                    <button type="button" disabled={!entry.clip_path && !entry.respell} onClick={() => activateGlossary(entry)}>{entry.clip_path ? "Play" : "Show"}</button>
                  </li>
                ))}
              </ul>
            )
          ) : notes.length === 0 ? (
            <p className="booth-empty">No author notes on this chapter.</p>
          ) : (
            <ul className="booth-note-list">
              {notes.map((note) => <li key={note.id}><div><strong>{note.author}</strong><p>{note.body}</p></div></li>)}
            </ul>
          )}
        </aside>
      ) : null}
    </div>
  );
}

function LiveVoiceStatus({
  status,
  enabled,
  dimmed,
  error,
  heardText,
  whisperAttempted,
  whisperSucceeded,
  whisperFailed,
  whisperLastError,
  whisperLastWords,
  startCursor,
  detectedFlags,
  signalLevel,
  cursor,
  totalWords,
}: {
  modelAvailable: boolean | null;
  status: "off" | "starting" | "listening" | "processing" | "error";
  enabled: boolean;
  dimmed: boolean;
  error: string | null;
  heardText: string;
  checkCount: number;
  latencyMs: number | null;
  whisperAttempted: number;
  whisperSucceeded: number;
  whisperFailed: number;
  whisperLastError: string | null;
  whisperLastWords: string;
  startCursor: number | null;
  detectedFlags: LiveMismatch[];
  signalLevel: number;
  cursor: number;
  totalWords: number;
}) {
  const copy = liveVoiceStatusCopy({ status, enabled, dimmed, error, heardText });

  return (
    <div className={`live-voice-status live-voice-status-${status}`} role="status" aria-live="polite">
      <div className="live-voice-status-main">
        <span className="live-voice-status-dot" aria-hidden="true" />
        <strong>{copy.title}</strong>
        {copy.detail ? <span>{copy.detail}</span> : null}
        {enabled && whisperAttempted > 0 ? (
          <span aria-label={`Whisper back-check ${whisperSucceeded} succeeded, ${whisperFailed} failed`}>
            Whisper {whisperSucceeded}/{whisperAttempted}
          </span>
        ) : null}
        {enabled && whisperLastError ? <span role="alert">{whisperLastError}</span> : null}
        {enabled && whisperLastWords ? <span aria-label={`Whisper heard ${whisperLastWords}`}>Heard: {whisperLastWords}</span> : null}
        {enabled && startCursor != null ? <span aria-label={`Live start cursor ${startCursor}`}>Start {startCursor}</span> : null}
        {enabled ? <span aria-label={`Live cursor ${cursor} of ${totalWords}`}>Cursor {cursor}</span> : null}
        {enabled && detectedFlags.length > 0 ? (
          <span aria-label={`Whisper flags ${detectedFlags.length}: ${detectedFlags.map((flag) => `${flag.expected} to ${flag.heard}`).join(", ")}`}>
            Flags {detectedFlags.length}
          </span>
        ) : null}
      </div>
      {enabled ? (
        <span className="live-mic-meter" aria-label={`Microphone level ${Math.round(signalLevel * 100)} percent`}>
          <i><b style={{ width: `${Math.round(signalLevel * 100)}%` }} /></i>
        </span>
      ) : null}
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
  const MAX_RECORDING_SECONDS = 2 * 60 * 60;
  // MediaRecorder can flush one or more timeslice chunks after stop is
  // requested. Stop slightly early so the validated WAV cannot cross the
  // project's hard two-hour boundary while those final chunks arrive.
  const RECORDING_STOP_MARGIN_SECONDS = 1;
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
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const confirmingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current = false;
      confirmingRef.current = false;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      if (levelTimerRef.current !== null) {
        window.clearInterval(levelTimerRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void monitorContextRef.current?.close();
    };
  }, []);

  useEffect(() => () => {
    if (pendingUrl) {
      URL.revokeObjectURL(pendingUrl);
    }
  }, [pendingUrl]);

  async function start() {
    if (
      disabled
      || startingRef.current
      || status === "recording"
      || status === "paused"
      || status === "processing"
      || status === "review"
    ) {
      return;
    }
    startingRef.current = true;
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not available in this app window.");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("Recording is not available in this app window.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const monitorContext = new AudioContext();
      monitorContextRef.current = monitorContext;
      const source = monitorContext.createMediaStreamSource(stream);
      const analyser = monitorContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
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
      pausedAtRef.current = null;
      pausedDurationRef.current = 0;
      setSeconds(0);
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
        const now = performance.now();
        const elapsed = recordingElapsedSeconds(
          now,
          startedAtRef.current,
          pausedDurationRef.current,
          pausedAtRef.current ?? undefined,
        );
        setSeconds(Math.min(MAX_RECORDING_SECONDS, elapsed));
        if (elapsed >= MAX_RECORDING_SECONDS - RECORDING_STOP_MARGIN_SECONDS && recorderRef.current?.state === "recording") {
          stop();
          setError("The two-hour recording limit was reached. Review the take before saving it.");
        }
      }, 100);
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
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (levelTimerRef.current !== null) {
        window.clearInterval(levelTimerRef.current);
        levelTimerRef.current = null;
      }
      void monitorContextRef.current?.close();
      monitorContextRef.current = null;
      if (mountedRef.current) {
        setStatus("error");
        setError(messageFor(reason, "Microphone permission or recording failed."));
      }
    } finally {
      startingRef.current = false;
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
    const now = performance.now();
    if (pausedAtRef.current !== null) {
      pausedDurationRef.current += Math.max(0, now - pausedAtRef.current);
      pausedAtRef.current = null;
    }
    recorder.resume();
    setStatus("recording");
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || (recorder.state !== "recording" && recorder.state !== "paused")) {
      return;
    }
    if (recorder.state === "paused" && pausedAtRef.current !== null) {
      pausedDurationRef.current += Math.max(0, performance.now() - pausedAtRef.current);
      pausedAtRef.current = null;
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
    let decodeContext: AudioContext | null = null;
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      decodeContext = new AudioContext();
      const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      const mono = resampleAudioBufferToMono(decoded, 44_100);
      if (mono.length === 0) {
        throw new Error("The take did not contain any audio samples.");
      }
      await decodeContext.close();
      decodeContext = null;
      if (!mountedRef.current) {
        return;
      }
      const wavBase64 = bytesToBase64(encodeWavPcm16(mono, 44_100, 1));
      const nextBytes = base64ToBytes(wavBase64);
      const nextBuffer = nextBytes.buffer.slice(nextBytes.byteOffset, nextBytes.byteOffset + nextBytes.byteLength) as ArrayBuffer;
      setPendingWav(wavBase64);
      setPendingUrl(URL.createObjectURL(new Blob([nextBuffer], { type: "audio/wav" })));
      setStatus("review");
      setLevel(0);
    } catch (reason) {
      if (mountedRef.current) {
        setStatus("error");
        setError(messageFor(reason, "Could not convert the take to a WAV."));
      }
    } finally {
      void decodeContext?.close();
      recorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      void monitorContextRef.current?.close();
      monitorContextRef.current = null;
    }
  }

  async function confirmTake() {
    if (!pendingWav || confirmingRef.current) {
      return;
    }
    confirmingRef.current = true;
    setStatus("processing");
    setError(null);
    try {
      const saveResult = await onSave(pendingWav);
      if (!mountedRef.current) {
        return;
      }
      if (saveResult === false) {
        // Keep the reviewed take available when the project write fails. The
        // caller displays the actionable error, and the user can retry or
        // discard instead of losing the only copy behind an error state.
        setStatus("review");
        return;
      }
      setPendingWav(null);
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
      }
      setPendingUrl(null);
      setStatus("idle");
    } catch (reason) {
      if (mountedRef.current) {
        setStatus("review");
        setError(messageFor(reason, "Could not save this take."));
      }
    } finally {
      confirmingRef.current = false;
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
          <p className="card-kicker">Recording</p>
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
          <p className="card-kicker">Review your take</p>
          <audio controls preload="metadata" src={pendingUrl} />
          <div className="recorder-review-actions">
            <button type="button" className="primary-button" onClick={() => void confirmTake()}>Use this take</button>
            <button type="button" className="secondary-button" onClick={discardTake}>Discard</button>
          </div>
        </div>
      ) : null}
      <p className="recorder-honesty">
        Listen before saving. You can keep this take or record another one.
      </p>
      {error ? <p className="recorder-error">{error}</p> : null}
    </section>
  );
}

function resampleAudioBufferToMono(buffer: AudioBuffer, targetRate: number): Float32Array {
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    return new Float32Array(0);
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

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (reason) => {
      window.clearTimeout(timer);
      reject(reason);
    });
  });
}

function ChapterManager({
  chapter,
  nextChapter,
  text,
  splitOffset,
  splitTitle,
  seat,
  projectMode,
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
  projectMode: "solo" | "duet";
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
        <p className="phase-label">Edit chapter</p>
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
        <p className="manager-help">Choose where the next chapter should begin.</p>
        <label htmlFor="manager-second-title">New chapter title</label>
        <input id="manager-second-title" value={splitTitle} onChange={(event) => onSplitTitle(event.target.value)} />
        <button type="button" disabled={busyAction !== null || splitOffset <= 0 || splitOffset >= text.length} onClick={onSplit}>
          {busyAction === "chapter-split" ? "Splitting…" : "Split at cursor"}
        </button>

        <div className="manager-divider" />
        <label htmlFor="manager-seat">Choose who reads this chapter</label>
        <div className="manager-inline">
          <select id="manager-seat" value={seat} onChange={(event) => onSeat(event.target.value as "narration" | "N1" | "N2")}>
            <option value="narration">Narration</option>
            <option value="N1" disabled={projectMode === "solo"}>N1</option>
            <option value="N2" disabled={projectMode === "solo"}>N2</option>
          </select>
          <button type="button" disabled={busyAction !== null} onClick={onApplySeat}>Apply seat</button>
        </div>
        <p className="manager-help">Use the chapter desk when different sections need different voices.</p>

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

function BookWordScanner({
  word,
  report,
  busyAction,
  onWord,
  onScan,
  onOpenOccurrence,
}: {
  word: string;
  report: BookScanReport | null;
  busyAction: string | null;
  onWord: (value: string) => void;
  onScan: () => void;
  onOpenOccurrence: (chapterId: string, start?: number) => void;
}) {
  return (
    <section className="phase-panel" aria-labelledby="scan-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Consistency</p>
          <h3 id="scan-title">Scan the whole book</h3>
        </div>
        {report ? (
          <span className={`status-pill ${report.consistent ? "attached" : ""}`}>
            {report.consistent ? "Read the same way" : "Read more than one way"}
          </span>
        ) : null}
      </header>
      <p className="panel-honesty">
        Find every place a name appears and compare how it was read each time. Only chapters you have
        already checked against audio can be compared.
      </p>
      <div className="scan-controls">
        <input
          type="search"
          value={word}
          placeholder="Leominster"
          aria-label="Word or phrase to scan for"
          onChange={(event) => onWord(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onScan();
            }
          }}
        />
        <button className="primary-button" type="button" disabled={busyAction !== null} onClick={onScan}>
          {busyAction === "scan-occurrences" ? "Scanning…" : "Scan"}
        </button>
      </div>
      {report === null ? null : report.totalOccurrences === 0 ? (
        <p className="result-empty">“{report.word}” does not appear in this book.</p>
      ) : (
        <div className="scan-results">
          <p className="scan-summary">
            {report.totalOccurrences} {report.totalOccurrences === 1 ? "occurrence" : "occurrences"},
            {" "}{report.checkedOccurrences} checked against audio
            {report.chaptersWithoutAudio.length > 0
              ? `. Not yet checked: ${report.chaptersWithoutAudio.join(", ")}.`
              : "."}
          </p>
          {report.readings.map((group) => (
            <div className="scan-group" key={group.heard}>
              <h4>
                Heard as “{group.heard}” · {group.count}
                {group.count === 1 ? " time" : " times"}
              </h4>
              <ul>
                {group.occurrences.map((occurrence) => (
                  <li key={`${occurrence.chapterId}-${occurrence.offset}`}>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => onOpenOccurrence(occurrence.chapterId, occurrence.start)}
                    >
                      {occurrence.chapterTitle}
                      {occurrence.start === undefined ? "" : ` · ${formatTime(occurrence.start)}`}
                    </button>
                    <span>{occurrence.context}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
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
  onRefresh,
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
  onRefresh: () => void;
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
          <p className="card-kicker">Pronunciation</p>
          <h3 id="glossary-panel-title">Pronunciation guide</h3>
        </div>
        <div className="panel-heading-actions">
          <span className="result-count">{glossary.length} entries</span>
          <button type="button" className="table-action" disabled={busyAction !== null} onClick={onRefresh}>Refresh suggestions</button>
        </div>
      </header>
      <p className="panel-honesty">
        Add names and tricky words so everyone says them the same way.
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

function SettingsPanel({
  settings,
  busyAction,
  onChange,
}: {
  settings: ProjectSettings;
  busyAction: string | null;
  onChange: (patch: Partial<ProjectSettings>) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <section className="phase-panel settings-panel" aria-labelledby="settings-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Book preferences</p>
          <h3 id="settings-title">Reading and audio</h3>
        </div>
        <span className="status-pill attached">Saved</span>
      </header>
      <p className="panel-honesty">
        Adjust how chapters are checked and how the teleprompter looks.
      </p>
      <div className="settings-grid">
        <label>
          Proof sensitivity
          <select value={draft.proof_sensitivity} onChange={(event) => setDraft({ ...draft, proof_sensitivity: event.target.value as ProjectSettings["proof_sensitivity"] })}>
            <option value="conservative">Conservative · fewer merged alerts</option>
            <option value="default">Default · balanced</option>
            <option value="aggressive">Aggressive · merge nearby alerts</option>
          </select>
          <small>Controls how closely nearby alerts are grouped.</small>
        </label>
        <label>
          Pause threshold (seconds)
          <input type="number" min="2" max="12" step="0.5" value={draft.pause_threshold_seconds} onChange={(event) => setDraft({ ...draft, pause_threshold_seconds: Number(event.target.value) })} />
          <small>Only a mid-sentence gap longer than this is listed as a pause pickup.</small>
        </label>
        <label>
          Ignore below confidence
          <input type="number" min="0" max="0.9" step="0.05" value={draft.proof_confidence_floor} onChange={(event) => setDraft({ ...draft, proof_confidence_floor: Number(event.target.value) })} />
          <small>Skips word alerts the recogniser was this unsure about, since it probably misheard rather than you misreading. Set 0 to keep every alert. Alerts are always kept when the engine reports no confidence.</small>
        </label>
        <label>
          ACX target RMS (dBFS)
          <input type="number" min="-23" max="-18" step="0.5" value={draft.acx_target_rms_dbfs} onChange={(event) => setDraft({ ...draft, acx_target_rms_dbfs: Number(event.target.value) })} />
          <small>Default −20 dBFS; the measured pass window remains −23 to −18.</small>
        </label>
        <div className="settings-word-filter">
          <span className="settings-word-filter-label">Words filtered for the whole book</span>
          {draft.suppressed_words.length === 0 ? (
            <small>None yet. Use “Ignore everywhere” on a pickup to add one.</small>
          ) : (
            <ul>
              {draft.suppressed_words.map((word) => (
                <li key={word}>
                  <span>{word}</span>
                  <button
                    type="button"
                    aria-label={`Stop filtering ${word}`}
                    onClick={() => setDraft({
                      ...draft,
                      suppressed_words: draft.suppressed_words.filter((candidate) => candidate !== word),
                    })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <small>Filtered words are skipped when a chapter is checked. Re-check a chapter to apply a change there.</small>
        </div>
        <label>
          Teleprompter theme
          <select value={draft.teleprompter_theme} onChange={(event) => setDraft({ ...draft, teleprompter_theme: event.target.value as ProjectSettings["teleprompter_theme"] })}>
            <option value="dark">Dark booth</option>
            <option value="sepia">Sepia</option>
            <option value="cream">Cream</option>
          </select>
        </label>
        <label>
          Teleprompter font size · {draft.teleprompter_font_size}px
          <input type="range" min="20" max="96" step="1" value={draft.teleprompter_font_size} onChange={(event) => setDraft({ ...draft, teleprompter_font_size: Number(event.target.value) })} />
          <small>Manual Space/PageDown scrolling always remains available.</small>
        </label>
        <div className="settings-readonly">
          <span>Audio format</span>
          <strong>Mono (ACX default)</strong>
          <small>Used for chapter exports.</small>
        </div>
        <div className="settings-readonly">
          <span>Word checks</span>
          <strong>Off by default · turn on in Teleprompter</strong>
          <small>Get a gentle alert when the words you read may not match the page.</small>
        </div>
      </div>
      <div className="settings-actions">
        <button className="primary-button" type="button" disabled={!dirty || busyAction !== null} onClick={() => onChange(draft)}>
          {busyAction === "settings" ? "Saving…" : "Save settings"}
        </button>
        <button className="table-action" type="button" disabled={!dirty || busyAction !== null} onClick={() => setDraft(settings)}>Discard changes</button>
      </div>
    </section>
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
          <p className="card-kicker">Work together</p>
          <h3 id="collaboration-title">Author and narrator</h3>
        </div>
        <span className="status-pill attached">{identity ? `${identity.personName} · ${identity.role}` : "Role not set"}</span>
      </header>
      <p className="panel-honesty">
        Add your role so notes, approvals, and recordings stay clear for everyone.
      </p>

      <div className="collaboration-grid">
        <div className="collaboration-card">
          <h4>Your role</h4>
          {!identityLoaded ? <p>Loading…</p> : null}
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
            {busyAction === "identity" ? "Saving…" : "Save role"}
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
          <h4>Share the book</h4>
          <label>
            Voice mode
            <select value={project.mode} onChange={(event) => onMode(event.target.value as "solo" | "duet")}>
              <option value="solo">Solo narration</option>
              <option value="duet">Duet · characters keep their narrator</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={lightPack} onChange={(event) => onLightPack(event.target.checked)} />
            Smaller copy: leave out exports and unused recordings
          </label>
          <p>Scripts, proof alignment, notes, project roles, and glossary clips stay included.</p>
          <button type="button" disabled={busyAction !== null} onClick={onShare}>
            {busyAction === "share" ? "Preparing…" : "Create shareable copy"}
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
                <select value={selectedChapterId ?? ""} disabled={busyAction !== null} onChange={(event) => onSelectChapter(event.target.value)}>
                  {project.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                </select>
              </label>
              <p>Current status: <strong>{selected ? authorStatusLabel(selected.author_status) : "Draft"}</strong></p>
              <div className="status-actions">
                {(["needs_pickup", "approved", "ignore_this_flag"] as const).map((status) => (
                  <button key={status} type="button" disabled={!authorCanApprove || busyAction !== null} onClick={() => onStatus(status)}>
                    {status === "needs_pickup" ? "Needs pickup" : status === "approved" ? "Approve" : "Ignore"}
                  </button>
                ))}
              </div>
              {!authorCanApprove ? <p className="permission-note">Narrators can read notes and status, but only authors can approve the book.</p> : null}
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
            <th>Time</th>
            <th>Review</th>
            <th>Audio check</th>
            <th>Audio</th>
            <th>Author</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter) => (
            <tr
              key={chapter.id}
              className={chapter.id === selectedId ? "selected-row" : ""}
              aria-selected={chapter.id === selectedId}
              aria-disabled={busyAction !== null}
              onClick={() => {
                if (busyAction === null) {
                  onSelect(chapter.id);
                }
              }}
            >
              <td>{String(chapter.index).padStart(2, "0")}</td>
              <td>
                {chapter.title}
                {chapter.duration_warning ? <span className="duration-warning" title={chapter.duration_warning}> · long</span> : null}
              </td>
              <td>{chapter.estimated_duration_minutes ? `${chapter.estimated_duration_minutes.toFixed(1)}m` : "—"}</td>
              <td>{chapter.open_pickups === undefined ? "—" : `${chapter.open_pickups} open`}</td>
              <td>{chapter.acx_traffic_light ? <span className={`traffic-light compact ${chapter.acx_traffic_light}`}>{checkStatusLabel(chapter.acx_traffic_light)}</span> : "—"}</td>
              <td>
                <button
                  className="table-action"
                  type="button"
                  disabled={busyAction !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAttach(chapter);
                  }}
                >
                  {chapter.audio_path ? "Replace" : "Attach"}
                </button>
              </td>
              <td>{authorStatusLabel(chapter.author_status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookPage({
  project,
  selectedChapter,
  selectedChapterId,
  chapterText,
  spans,
  nextStep,
  busyAction,
  onSelect,
  onAttach,
  onPaste,
  onImport,
  onExample,
  onManage,
  onAssignSpanSeat,
  onOpenReview,
  onOpenTeleprompter,
  onFollowStep,
}: {
  project: ProjectFile;
  selectedChapter: ChapterFile | null;
  selectedChapterId: string | null;
  chapterText: string;
  spans: ScriptSpan[];
  nextStep: BoothStep;
  busyAction: string | null;
  onSelect: (id: string) => void;
  onAttach: (chapter: ChapterFile) => void;
  onPaste: () => void;
  onImport: () => void;
  onExample: () => void;
  onManage: () => void;
  onAssignSpanSeat: (index: number, seat: "narration" | "N1" | "N2") => void;
  onOpenReview: (id: string) => void;
  onOpenTeleprompter: (id: string) => void;
  onFollowStep: () => void;
}) {
  const [dashboardTab, setDashboardTab] = useState<"prep" | "proofing">("prep");
  const [chapterQuery, setChapterQuery] = useState("");
  const stats = useMemo(() => bookDashboardStats(project.chapters), [project.chapters]);
  const visibleChapters = useMemo(
    () => filterPromptChapters(project.chapters, chapterQuery),
    [chapterQuery, project.chapters],
  );
  const selectedWords = useMemo(
    () => relevantPromptGlossary(spans, project.glossary ?? []),
    [project.glossary, spans],
  );
  const estimatedHours = stats.estimatedMinutes / 60;
  return (
    <div className="book-page">
      <section className="book-dashboard-hero" aria-label="Book overview">
        <div className="book-dashboard-title">
          <p className="card-kicker">Uploaded book</p>
          <h3>{project.name}</h3>
          <p>{project.author ? `By ${project.author}` : "Ready for author and narrator details"}</p>
        </div>
        <dl className="book-dashboard-stats">
          <div><dt>Chapters</dt><dd>{stats.chapterCount}</dd></div>
          <div><dt>Words</dt><dd>{stats.wordCount.toLocaleString()}</dd></div>
          <div><dt>Read time</dt><dd>{estimatedHours >= 1 ? `${estimatedHours.toFixed(1)} hr` : `${Math.max(1, Math.round(stats.estimatedMinutes))} min`}</dd></div>
          <div><dt>Recorded</dt><dd>{stats.recordedCount}/{stats.chapterCount}</dd></div>
        </dl>
        <div className="book-dashboard-next">
          <div><span>Next step</span><strong>{nextStep.label}</strong><p>{nextStep.detail}</p></div>
          <button className="primary-button" type="button" disabled={busyAction !== null} onClick={onFollowStep}>Continue the book</button>
        </div>
      </section>

      <div className="page-toolbar book-dashboard-toolbar">
        <button className="compact-button" type="button" disabled={busyAction !== null} onClick={onPaste}>Paste chapter</button>
        <button className="primary-button compact-button" type="button" disabled={busyAction !== null} onClick={onImport}>Update manuscript</button>
        {project.chapters.length === 0 ? (
          <button className="compact-button" type="button" disabled={busyAction !== null} onClick={onExample}>{busyAction === "example" ? "Loading example…" : "Try an example chapter"}</button>
        ) : null}
      </div>

      {project.chapters.length === 0 ? (
        <div className="empty-chapters">
          <div className="empty-icon" aria-hidden="true">+</div>
          <h3>Add chapter 1</h3>
          <p>Paste the page or import a manuscript. Recording waits until the words are here.</p>
        </div>
      ) : (
        <>
          <div className="book-dashboard-tabs" role="tablist" aria-label="Book dashboard view">
            <button type="button" role="tab" aria-selected={dashboardTab === "prep"} className={dashboardTab === "prep" ? "active" : ""} onClick={() => setDashboardTab("prep")}>Book prep</button>
            <button type="button" role="tab" aria-selected={dashboardTab === "proofing"} className={dashboardTab === "proofing" ? "active" : ""} onClick={() => setDashboardTab("proofing")}>
              Proofing {stats.openPickups > 0 ? <span>{stats.openPickups}</span> : null}
            </button>
          </div>

          <div className="book-dashboard-layout">
            <aside className="book-dashboard-chapters" aria-label="Book chapters">
              <label>
                <span>Find a chapter</span>
                <input value={chapterQuery} onChange={(event) => setChapterQuery(event.target.value)} placeholder="Search chapters" />
              </label>
              <p>{visibleChapters.length} of {project.chapters.length} chapters</p>
              <ul>
                {visibleChapters.map((item) => {
                  const status = promptChapterStatus(item);
                  return (
                    <li key={item.id} className={item.id === selectedChapterId ? "active" : ""}>
                      <button type="button" className="book-chapter-select" onClick={() => onSelect(item.id)}>
                        <span>{String(item.index).padStart(2, "0")}</span>
                        <strong>{item.title}</strong>
                        <em className={status.tone}>{status.label}</em>
                      </button>
                      <div>
                        <button type="button" disabled={busyAction !== null} onClick={() => onOpenTeleprompter(item.id)}>Read</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => onOpenReview(item.id)}>Check</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {dashboardTab === "prep" ? (
              <main className="book-dashboard-content">
                <section className="book-dashboard-overview">
                  <p className="card-kicker">Overview</p>
                  <h3>Prepare once, then stay in the story.</h3>
                  <p>
                    This book has {stats.chapterCount} chapter{stats.chapterCount === 1 ? "" : "s"} and {stats.wordCount.toLocaleString()} words.
                    {stats.recordedCount > 0 ? ` ${stats.recordedCount} chapter${stats.recordedCount === 1 ? " has" : "s have"} a recording attached.` : " Start with the first chapter, check names before the take, and keep proofing beside the page."}
                  </p>
                </section>

                {selectedChapter ? (
                  <section className="book-dashboard-selected">
                    <header>
                      <div><p className="card-kicker">Selected chapter</p><h3>{selectedChapter.title}</h3></div>
                      <div>
                        <button type="button" className="table-action" onClick={() => onOpenTeleprompter(selectedChapter.id)}>Open teleprompter</button>
                        <button type="button" className="table-action" disabled={busyAction !== null} onClick={onManage}>Edit chapter</button>
                      </div>
                    </header>
                    <p className="book-dashboard-excerpt">{chapterText || "Loading manuscript…"}</p>
                    <SpanSeatEditor spans={spans} projectMode={project.mode} disabled={busyAction !== null} onAssign={onAssignSpanSeat} />
                  </section>
                ) : null}

                <div className="book-dashboard-reference-grid">
                  <section>
                    <header><div><p className="card-kicker">Words & phrases</p><h3>Pronunciation</h3></div><span>{(project.glossary ?? []).length}</span></header>
                    {(project.glossary ?? []).length === 0 ? <p>No pronunciation entries yet.</p> : (
                      <ul>
                        {(selectedWords.length > 0 ? selectedWords : project.glossary ?? []).slice(0, 6).map((entry) => (
                          <li key={entry.id}><strong>{entry.spelling}</strong><span>{entry.respell || `${entry.frequency} mention${entry.frequency === 1 ? "" : "s"}`}</span></li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section>
                    <header><div><p className="card-kicker">People</p><h3>Author & voices</h3></div><span>{project.people.length}</span></header>
                    {project.people.length === 0 ? <p>Add the author and narrator in People.</p> : (
                      <ul>
                        {project.people.slice(0, 6).map((person) => (
                          <li key={`${person.name}-${person.role}-${person.seat ?? ""}`}><strong>{person.name}</strong><span>{person.role === "author" ? "Author" : person.seat === "N1" ? "Narrator 1" : person.seat === "N2" ? "Narrator 2" : "Narrator"}</span></li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </main>
            ) : (
              <main className="book-dashboard-content proofing-dashboard">
                <section className="proofing-dashboard-summary">
                  <article><strong>{stats.openPickups}</strong><span>Pickups left</span></article>
                  <article><strong>{stats.proofedCount}/{stats.chapterCount}</strong><span>Chapters proofed</span></article>
                  <article><strong>{stats.recordedCount}/{stats.chapterCount}</strong><span>Recordings attached</span></article>
                </section>
                <p className="proofing-dashboard-help">Attach each chapter’s take, check it against the manuscript, and keep every pickup tied to the chapter where it belongs.</p>
                <ul className="proofing-dashboard-list">
                  {visibleChapters.map((item) => {
                    const status = promptChapterStatus(item);
                    return (
                      <li key={item.id}>
                        <div><span>{String(item.index).padStart(2, "0")}</span><strong>{item.title}</strong></div>
                        <em className={status.tone}>{status.label}</em>
                        <button type="button" disabled={busyAction !== null} onClick={() => item.audio_path ? onOpenReview(item.id) : onAttach(item)}>{item.audio_path ? "Open proofing" : "Attach recording"}</button>
                      </li>
                    );
                  })}
                </ul>
              </main>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RecordPage({
  chapter,
  chapterText,
  busyAction,
  audioUrl,
  audioRef,
  project,
  roomReport,
  roomOpen,
  onToggleRoom,
  onMeasureRoom,
  onSaveRoom,
  onOpenTeleprompter,
  onSaveRecording,
  onAttach,
  projectMode,
  duetNarrationSeat,
  onDuetNarrationSeat,
  onAttachDuetTrack,
  onMixDuet,
}: {
  chapter: ChapterFile;
  chapterText: string;
  busyAction: string | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  project: ProjectFile;
  roomReport: RoomTestReport | null;
  roomOpen: boolean;
  onToggleRoom: () => void;
  onMeasureRoom: () => void;
  onSaveRoom: (wav: string) => Promise<unknown>;
  onOpenTeleprompter: () => void;
  onSaveRecording: (wavBase64: string) => Promise<unknown>;
  onAttach: (chapter: ChapterFile) => void;
  projectMode: "solo" | "duet";
  duetNarrationSeat: "N1" | "N2";
  onDuetNarrationSeat: (value: "N1" | "N2") => void;
  onAttachDuetTrack: (kind: "bed" | "overdub") => void;
  onMixDuet: () => Promise<void>;
}) {
  return (
    <div className="record-page">
      <article className="surface-card">
        <header className="chapter-desk-heading">
          <div>
            <p className="card-kicker">Now reading</p>
            <h3>{chapter.title}</h3>
          </div>
          <div className="chapter-heading-tools">
            <span className={chapter.audio_path ? "status-pill attached" : "status-pill"}>
              {chapter.audio_path ? "Take attached" : "No take yet"}
            </span>
            <button className="table-action" type="button" disabled={busyAction !== null} onClick={() => onAttach(chapter)}>
              {chapter.audio_path ? "Replace take" : "Attach take"}
            </button>
          </div>
        </header>
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
        <p className="manuscript-body tall">{chapterText || "Loading manuscript…"}</p>
        <div className="desk-actions">
          <button
            className="primary-button"
            type="button"
            disabled={chapterText.trim().length === 0 || busyAction !== null}
            onClick={onOpenTeleprompter}
          >
            Open the page
          </button>
        </div>
        <RecorderPanel
          label="Record this chapter"
          disabled={!window.boothDesk || busyAction !== null}
          onSave={onSaveRecording}
        />
      </article>

      <aside className="record-side">
        <article className="surface-card">
          <header className="panel-heading">
            <div>
              <p className="card-kicker">Before you record</p>
              <h3>Room check</h3>
            </div>
            <button className="table-action" type="button" onClick={onToggleRoom}>
              {roomOpen ? "Hide" : project.room_test_path ? "Open" : "Start"}
            </button>
          </header>
          <p className="panel-honesty">Record 10–20 seconds of silence. If the floor is loud, treat the room first.</p>
          {roomOpen ? (
            <>
              <RecorderPanel
                label="Room tone recorder"
                disabled={!window.boothDesk || busyAction !== null}
                onSave={onSaveRoom}
              />
              <button className="compact-button room-check-button" type="button" disabled={!project.room_test_path || busyAction !== null} onClick={onMeasureRoom}>
                {busyAction === "room-meter" ? "Measuring…" : "Measure room floor"}
              </button>
            </>
          ) : null}
          {roomReport ? <RoomTestResult report={roomReport} /> : null}
        </article>

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
      </aside>
    </div>
  );
}

function ReviewPage({
  chapter,
  chapterText,
  transcriptText,
  onTranscriptChange,
  busyAction,
  audioUrl,
  audioRef,
  proof,
  modelAvailable,
  modelProgress,
  onDownloadModel,
  onProof,
  onPlayPickup,
  onPlayRange,
  onExportMarkers,
  onExportReport,
  onPunchPickup,
  onUpdatePickup,
  onSuppressPickup,
  pickupSeatFilter,
  onPickupSeatFilter,
  comparisonFolder,
  comparisons,
}: {
  chapter: ChapterFile;
  chapterText: string;
  transcriptText: string;
  onTranscriptChange: (value: string) => void;
  busyAction: string | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  proof: ProofResult | null;
  modelAvailable: boolean | null;
  modelProgress: number;
  onDownloadModel: () => void;
  onProof: () => void;
  onPlayPickup: (pickup: Pickup) => void;
  onPlayRange: (start: number, end?: number) => void;
  onExportMarkers: () => void;
  onExportReport: () => void;
  onPunchPickup: (pickup: Pickup) => void;
  onUpdatePickup: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void;
  onSuppressPickup: (pickup: Pickup) => void;
  pickupSeatFilter: "all" | "narration" | "N1" | "N2";
  onPickupSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void;
  comparisonFolder: string;
  comparisons: PickupComparison[];
}) {
  return (
    <div className="review-page">
      <article className="surface-card">
        <header className="chapter-desk-heading">
          <div>
            <p className="card-kicker">Listen against the page</p>
            <h3>{chapter.title}</h3>
          </div>
          <span className={chapter.audio_path ? "status-pill attached" : "status-pill"}>
            {chapter.audio_path ? "Take ready" : "Need a take"}
          </span>
        </header>
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
        <details className="manuscript-preview">
          <summary>Manuscript</summary>
          <p>{chapterText || "Loading manuscript…"}</p>
        </details>
        <div className="proof-input">
          <label htmlFor="local-transcript">Transcript</label>
          <textarea
            id="local-transcript"
            rows={4}
            value={transcriptText}
            disabled={busyAction !== null}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="Paste the words that were read, or leave blank to transcribe…"
          />
          <p>We compare this with the manuscript to find word changes and pauses.</p>
          {modelAvailable === false ? (
            <div className="model-note">
              <span>Speech model is not ready yet.</span>
              <button type="button" onClick={onDownloadModel} disabled={busyAction !== null}>
                {busyAction === "model"
                  ? `Downloading ${Math.round(modelProgress * 100)}%…`
                  : "Download speech model"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="desk-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!chapter.audio_path || busyAction !== null}
            onClick={onProof}
          >
            {busyAction === `proof-${chapter.id}` ? "Checking…" : "Check chapter"}
          </button>
        </div>
      </article>

      {proof ? (
        <>
          <OccurrenceScanner transcript={proof.transcript} busy={busyAction !== null} onPlay={onPlayRange} />
          <PickupList
            pickups={proof.pickups}
            busyAction={busyAction}
            onPlay={onPlayPickup}
            onExportMarkers={onExportMarkers}
            onExportReport={onExportReport}
            onPunch={onPunchPickup}
            onUpdate={onUpdatePickup}
            onSuppress={onSuppressPickup}
            seatFilter={pickupSeatFilter}
            onSeatFilter={onPickupSeatFilter}
          />
        </>
      ) : (
        <div className="empty-chapters compact">
          <h3>No review yet</h3>
          <p>Check the chapter after you have a take. Pickups will land here.</p>
        </div>
      )}
      {comparisons.length > 0 ? <PickupComparisonPanel folder={comparisonFolder} comparisons={comparisons} /> : null}
    </div>
  );
}

function FinishPage({
  chapter,
  exportReadiness,
  busyAction,
  acxReport,
  exportResult,
  audioUrl,
  audioRef,
  onMeasure,
  specPresetId,
  onExport,
  onShare,
  onPlayRange,
}: {
  chapter: ChapterFile;
  exportReadiness: ExportReadiness;
  busyAction: string | null;
  acxReport: AcxReport | null;
  exportResult: AcxExportResult | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onMeasure: (presetId?: string) => void;
  specPresetId: string;
  onExport: () => void;
  onShare: () => void;
  onPlayRange: (start: number, end?: number) => void;
}) {
  return (
    <div className="finish-page">
      <article className="surface-card">
        <header className="chapter-desk-heading">
          <div>
            <p className="card-kicker">This chapter</p>
            <h3>{chapter.title}</h3>
          </div>
          <span className={chapter.acx_traffic_light ? `traffic-light ${chapter.acx_traffic_light}` : "status-pill"}>
            {chapter.acx_traffic_light ? checkStatusLabel(chapter.acx_traffic_light) : "Not checked"}
          </span>
        </header>
        <p className="panel-honesty">Measurable ACX specs only. Listen once for clicks, echo, and a wrong read.</p>
        <div className="desk-actions">
          <button className="primary-button" type="button" disabled={!chapter.audio_path || busyAction !== null} onClick={() => onMeasure()}>
            {busyAction === `meter-${chapter.id}` ? "Measuring…" : "Check audio"}
          </button>
        </div>
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
        {acxReport ? (
          <AcxMeter
            report={acxReport}
            onPlayNoiseFloor={audioUrl ? () => onPlayRange(
              acxReport.noise_floor_start_seconds,
              acxReport.noise_floor_start_seconds + acxReport.noise_floor_duration_seconds,
            ) : undefined}
            presetId={specPresetId}
            onPresetChange={(presetId) => onMeasure(presetId)}
          />
        ) : null}
      </article>

      <article className="surface-card">
        <p className="card-kicker">The pack</p>
        <h3>Export and share</h3>
        <p className="panel-honesty">Write the ACX folder, or make a copy for the other seat.</p>
        <div className={`export-readiness ${exportReadiness.ready ? "ready" : "blocked"}`} role="status">
          <strong>{exportReadiness.ready ? "Ready to prepare" : "Audio still needed"}</strong>
          <span>{exportReadiness.attachedChapters} of {exportReadiness.totalChapters} chapters have audio</span>
          {!exportReadiness.ready ? (
            <p>
              Record or import: {exportReadiness.missingAudio.slice(0, 3).map((missing) => missing.title).join(", ")}
              {exportReadiness.missingAudio.length > 3 ? ` and ${exportReadiness.missingAudio.length - 3} more` : ""}.
            </p>
          ) : (
            <p>Every chapter will be mastered, re-measured after MP3 encoding, and listed in the report.</p>
          )}
        </div>
        <div className="desk-actions">
          <button className="primary-button" type="button" disabled={!exportReadiness.ready || busyAction !== null} onClick={onExport}>
            {busyAction === "export" ? "Exporting…" : "Export ACX pack"}
          </button>
          <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onShare}>
            {busyAction === "share" ? "Preparing…" : "Create shareable copy"}
          </button>
        </div>
        {exportResult ? (
          <p className={`export-summary inline ${exportResult.status === "ready_with_warnings" ? "warning" : "success"}`}>
            {exportResult.status === "ready_with_warnings" ? "Ready with items to review" : "Ready for delivery"}: {exportResult.files.length} MP3 file{exportResult.files.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </article>
    </div>
  );
}

function MissingChapter({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-chapters">
      <div className="empty-icon" aria-hidden="true">+</div>
      <h3>Add a chapter first</h3>
      <p>The booth, review, and export all start from a manuscript page.</p>
      <button className="primary-button" type="button" onClick={onAdd}>Add chapter</button>
    </div>
  );
}

function SpanSeatEditor({
  spans,
  projectMode,
  disabled,
  onAssign,
}: {
  spans: ScriptSpan[];
  projectMode: "solo" | "duet";
  disabled: boolean;
  onAssign: (index: number, seat: "narration" | "N1" | "N2") => void;
}) {
  if (spans.length === 0) {
    return null;
  }
  return (
    <details className="span-seat-editor">
      <summary>Choose who reads each section ({spans.length} sections)</summary>
      <p>Choose a voice for each section of the chapter.</p>
      <ol>
        {spans.map((span, index) => (
          <li key={`${index}-${span.text.slice(0, 12)}`}>
            <span className="span-seat-text">
              {span.dialogue ? <em className="dialogue-badge">dialogue</em> : null}
              {span.text || "(line break)"}
            </span>
            <select
              aria-label={`Voice for section ${index + 1}`}
              value={span.seat}
              disabled={disabled}
              onChange={(event) => onAssign(index, event.target.value as "narration" | "N1" | "N2")}
            >
              <option value="narration">Narration</option>
              <option value="N1" disabled={projectMode === "solo"}>N1</option>
              <option value="N2" disabled={projectMode === "solo"}>N2</option>
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
          <p className="card-kicker">Two-person recording</p>
          <h4 id="duet-tracks-title">Two recordings</h4>
        </div>
        <span className="result-count">{ready ? "Ready" : "Two recordings needed"}</span>
      </div>
      <p className="panel-honesty">
        Add both voices to bring a two-person chapter together.
      </p>
      <div className="duet-track-grid">
        <div className="duet-track-card">
          <strong>Narrator 1</strong>
          <span>{chapter.bed_audio_path ?? "Not added"}</span>
          <button type="button" disabled={busyAction !== null} onClick={() => onAttach("bed")}>{chapter.bed_audio_path ? "Replace recording" : "Add recording"}</button>
        </div>
        <div className="duet-track-card">
          <strong>Narrator 2</strong>
          <span>{chapter.overdub_audio_path ?? "Not added"}</span>
          <button type="button" disabled={busyAction !== null} onClick={() => onAttach("overdub")}>{chapter.overdub_audio_path ? "Replace recording" : "Add recording"}</button>
        </div>
      </div>
      <div className="duet-mix-actions">
        <label>
          Main voice
          <select value={narrationSeat} disabled={busyAction !== null} onChange={(event) => onNarrationSeat(event.target.value as "N1" | "N2")}>
            <option value="N1">N1</option>
            <option value="N2">N2</option>
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!ready || busyAction !== null} onClick={() => void onMix()}>
          {busyAction === "duet-mix" ? "Mixing…" : "Combine recordings"}
        </button>
      </div>
      {chapter.duet_mix_path ? <p className="duet-output">Combined recording ready.</p> : null}
    </section>
  );
}

function OccurrenceScanner({ transcript, busy, onPlay }: { transcript: TranscriptWord[]; busy: boolean; onPlay: (start: number, end?: number) => void }) {
  const [query, setQuery] = useState("");
  const occurrences = useMemo(() => findWordOccurrences(transcript, query), [transcript, query]);
  return (
    <section className="result-panel occurrence-panel" aria-labelledby="occurrence-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Across this recording</p>
          <h4 id="occurrence-title">Find every occurrence</h4>
        </div>
        <span className="result-count">{query.trim() ? `${occurrences.length} found` : "Word or phrase"}</span>
      </div>
      <label className="occurrence-search">
        <span>Word or phrase</span>
        <input value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder="Try a name, place, or repeated phrase" />
      </label>
      {query.trim() && occurrences.length === 0 ? <p className="result-empty">No matching spoken words were found in this chapter.</p> : null}
      {occurrences.length > 0 ? (
        <ol className="occurrence-list">
          {occurrences.map((occurrence: WordOccurrence, index) => (
            <li key={`${occurrence.transcriptStart}-${occurrence.transcriptEnd}`}>
              <button type="button" disabled={busy} onClick={() => onPlay(occurrence.start, occurrence.end)}>Play {index + 1}</button>
              <time>{formatTime(occurrence.start)}</time>
              <span>{occurrence.context}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function PickupComparisonPanel({ folder, comparisons }: { folder: string; comparisons: PickupComparison[] }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<{ comparison: PickupComparison; side: "original" | "replacement" } | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setSourceUrl(null);
    setLoadError(null);
    if (!active || !window.boothDesk || folder === "(browser preview)") {
      return;
    }
    const relativePath = active.side === "original" ? active.comparison.originalPath : active.comparison.replacementPath;
    void window.boothDesk.audioUrl({ folder, relativePath }).then((url) => {
      if (!disposed) {
        setSourceUrl(url);
      }
    }).catch((reason: unknown) => {
      if (!disposed) {
        setLoadError(messageFor(reason, "Could not load this comparison."));
      }
    });
    return () => { disposed = true; };
  }, [active, folder]);

  function beginPlayback() {
    if (!active || !audio.current) {
      return;
    }
    const element = audio.current;
    element.currentTime = active.side === "original" ? Math.max(0, active.comparison.start - 0.5) : 0;
    void element.play();
  }

  function stopOriginalInContext() {
    if (active?.side === "original" && audio.current && audio.current.currentTime >= active.comparison.end + 0.5) {
      audio.current.pause();
    }
  }

  return (
    <section className="result-panel comparison-panel" aria-labelledby="comparison-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Pickup history</p>
          <h4 id="comparison-title">Compare original and replacement</h4>
        </div>
        <span className="result-count">{comparisons.length} replacement{comparisons.length === 1 ? "" : "s"}</span>
      </div>
      <p className="panel-honesty">A plays the untouched take in context. B plays only the replacement you recorded.</p>
      <ol className="comparison-list">
        {comparisons.map((comparison, index) => (
          <li key={comparison.id}>
            <div><strong>{comparison.expected ? `“${comparison.expected}”` : `Pickup ${index + 1}`}</strong><time>{formatTime(comparison.start)}–{formatTime(comparison.end)}{comparison.heard ? ` · heard “${comparison.heard}”` : ""}</time></div>
            <button type="button" className={active?.comparison.id === comparison.id && active.side === "original" ? "active" : ""} onClick={() => setActive({ comparison, side: "original" })}>A · Original</button>
            <button type="button" className={active?.comparison.id === comparison.id && active.side === "replacement" ? "active" : ""} onClick={() => setActive({ comparison, side: "replacement" })}>B · Replacement</button>
          </li>
        ))}
      </ol>
      {sourceUrl ? (
        <div className="comparison-player">
          <strong>{active?.side === "original" ? "A · Original in context" : "B · Replacement pickup"}</strong>
          <audio ref={audio} controls src={sourceUrl} preload="metadata" onLoadedMetadata={beginPlayback} onTimeUpdate={stopOriginalInContext} />
        </div>
      ) : null}
      {loadError ? <p className="error-note">{loadError}</p> : null}
    </section>
  );
}

function PickupList({ pickups, busyAction, onPlay, onExportMarkers, onExportReport, onPunch, onUpdate, onSuppress, seatFilter, onSeatFilter }: { pickups: Pickup[]; busyAction: string | null; onPlay: (pickup: Pickup) => void; onExportMarkers: () => void; onExportReport: () => void; onPunch: (pickup: Pickup) => void; onUpdate: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void; onSuppress: (pickup: Pickup) => void; seatFilter: "all" | "narration" | "N1" | "N2"; onSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void }) {
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const seatPickups = seatFilter === "all" ? pickups : pickups.filter((pickup) => pickup.seat === seatFilter);
  const visiblePickups = statusFilter === "open" ? seatPickups.filter((pickup) => pickup.status === "open") : seatPickups;
  const openCount = seatPickups.filter((pickup) => pickup.status === "open").length;
  return (
    <section className="result-panel" aria-labelledby="pickup-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Review points</p>
          <h4 id="pickup-title">Pickups</h4>
        </div>
        <div className="result-heading-actions">
          <label className="pickup-seat-filter">Voice
            <select value={seatFilter} disabled={busyAction !== null} onChange={(event) => onSeatFilter(event.target.value as "all" | "narration" | "N1" | "N2")}>
              <option value="all">All voices</option>
              <option value="narration">Narration</option>
              <option value="N1">Narrator 1</option>
              <option value="N2">Narrator 2</option>
            </select>
          </label>
          <label className="pickup-seat-filter">Status
            <select value={statusFilter} disabled={busyAction !== null} onChange={(event) => setStatusFilter(event.target.value as "open" | "all")}>
              <option value="open">Open</option>
              <option value="all">All</option>
            </select>
          </label>
          <span className="result-count">{openCount} open</span>
          <button className="table-action" type="button" disabled={busyAction !== null} onClick={onExportReport}>{busyAction === "proof-report" ? "Exporting…" : "Export report"}</button>
          <button className="table-action" type="button" disabled={busyAction !== null} onClick={onExportMarkers}>Export markers</button>
        </div>
      </div>
      {visiblePickups.length === 0 ? (
        <p className="result-empty">
          {statusFilter === "open" && seatPickups.some((pickup) => pickup.status !== "open")
            ? "No open review points for this voice. Change Status to All to see completed items."
            : "No review points found. Listen once for delivery and background noise."}
        </p>
      ) : (
        <ul className="pickup-list">
          {visiblePickups.map((pickup) => (
            <li key={pickup.id} className={`pickup-row ${pickup.status}`}>
              <span className="pickup-actions">
                <button type="button" disabled={busyAction !== null} onClick={() => onPlay(pickup)}>Play</button>
                {pickup.status === "open" ? <button type="button" disabled={busyAction !== null} onClick={() => onPunch(pickup)}>Record pickup</button> : null}
                {pickup.status === "open" ? (
                  <>
                    <button type="button" disabled={busyAction !== null} onClick={() => onUpdate(pickup, { status: "done" })}>Resolved</button>
                    <button type="button" disabled={busyAction !== null} onClick={() => onUpdate(pickup, { status: "ignored" })}>Ignore</button>
                    {pickup.kind === "pause" ? null : (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        title="Stop flagging this word anywhere in the book"
                        onClick={() => onSuppress(pickup)}
                      >
                        Ignore everywhere
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" disabled={busyAction !== null} onClick={() => onUpdate(pickup, { status: "open" })}>Open again</button>
                )}
              </span>
              <time>{formatTime(pickup.t_start)}</time>
              <div>
                <span className="expected">{pickup.expected || "—"}</span>
                <span className="arrow" aria-hidden="true">→</span>
                <span className="heard">{pickup.heard || "—"}</span>
              </div>
              <span className="kind-badge">{pickup.kind === "pause" ? "Pause" : "Word"}</span>
              <details className="pickup-note">
                <summary>{pickup.note ? "Edit note" : "Note"}</summary>
                <PickupNoteEditor pickup={pickup} busy={busyAction !== null} onSave={(note) => onUpdate(pickup, { note })} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PickupNoteEditor({ pickup, busy, onSave }: { pickup: Pickup; busy: boolean; onSave: (note: string) => void }) {
  const [note, setNote] = useState(pickup.note ?? "");
  useEffect(() => setNote(pickup.note ?? ""), [pickup.id, pickup.note]);
  return (
    <div className="pickup-note-editor">
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Human note for the collaborator" />
      <button type="button" disabled={busy || note.trim().length === 0} onClick={() => onSave(note)}>Save note</button>
    </div>
  );
}

function AcxMeter({
  report,
  onPlayNoiseFloor,
  presetId,
  onPresetChange,
}: {
  report: AcxReport;
  onPlayNoiseFloor?: () => void;
  presetId?: string;
  onPresetChange?: (presetId: string) => void;
}) {
  const targets = presetTargets(resolvePreset(report.preset_id));
  const rows = [
    ["RMS", targets.rms, formatDb(report.rms_dbfs), report.checks.rms],
    ["Loudness", targets.loudness, `${formatDb(report.lufs_integrated)} LUFS`, report.checks.loudness],
    ["True peak", targets.true_peak, formatDb(report.true_peak_dbfs), report.checks.true_peak],
    ["Noise floor", targets.noise_floor, formatDb(report.noise_floor_dbfs), report.checks.noise_floor],
    ["Sample rate", targets.sample_rate, `${(report.sample_rate / 1000).toFixed(1)} kHz`, report.checks.sample_rate],
    ["Channels", targets.channels, String(report.channels), report.checks.channels],
    ["Format", "Supported audio file", report.format.toUpperCase(), report.checks.format],
    [
      "Bitrate",
      targets.format,
      report.format === "mp3"
        ? `${report.bitrate_kbps?.toFixed(0) ?? "?"} kbps ${report.vbr === true ? "VBR" : report.vbr === false ? "CBR" : "mode unknown"}`
        : "Not applicable to source",
      report.checks.format,
    ],
    ["Duration", targets.duration, `${(report.duration_seconds / 60).toFixed(2)} min`, report.checks.duration],
    ["Head room tone", targets.head_room_tone, `${report.head_room_tone_s.toFixed(2)} s`, report.checks.head_room_tone],
    ["Tail room tone", targets.tail_room_tone, `${report.tail_room_tone_s.toFixed(2)} s`, report.checks.tail_room_tone],
  ] as const;

  return (
    <section className="result-panel" aria-labelledby="acx-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Audio check</p>
          <h4 id="acx-title">{report.preset_label} check</h4>
        </div>
        <span className={`traffic-light ${report.traffic_light}`}>
          {checkStatusLabel(report.traffic_light)}
        </span>
      </div>
      {onPresetChange ? (
        <label className="meter-target-select">
          <span>Delivery target</span>
          <select
            value={presetId ?? report.preset_id}
            onChange={(event) => onPresetChange(event.target.value)}
          >
            {BUILTIN_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <table className="meter-table">
        <thead>
          <tr><th>Check</th><th>Target</th><th>Result</th><th /></tr>
        </thead>
        <tbody>
          {rows.map(([label, required, measured, status]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{required}</td>
              <td>{measured}</td>
              <td><span className={`check-dot ${status}`}>{checkStatusLabel(status)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="meter-evidence">
        <div>
          <strong>Noise-floor evidence</strong>
          <span>
            Measured from {report.noise_floor_start_seconds.toFixed(2)}–{(report.noise_floor_start_seconds + report.noise_floor_duration_seconds).toFixed(2)} s, the quietest sustained section found. Listen to confirm it is voice-free.
          </span>
        </div>
        {onPlayNoiseFloor ? (
          <button className="table-action" type="button" onClick={onPlayNoiseFloor}>
            Listen to this section
          </button>
        ) : null}
      </div>
      <p className="meter-honesty">
        These checks cover levels and format. Listen once for clicks and room noise.
        {" "}Rows marked “Not specified” are measured but not judged, because {report.preset_label} sets no limit for them.
      </p>
    </section>
  );
}

function RoomTestResult({ report }: { report: RoomTestReport }) {
  return (
    <section className="result-panel room-result" aria-labelledby="room-result-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Room check</p>
          <h4 id="room-result-title">Room noise</h4>
        </div>
        <span className={`traffic-light ${report.status}`}>{checkStatusLabel(report.status)}</span>
      </div>
      <dl className="room-stats">
        <div><dt>Silence recorded</dt><dd>{report.durationSeconds.toFixed(1)} s</dd></div>
        <div><dt>Room noise</dt><dd>{formatDb(report.noiseFloorDbfs)}</dd></div>
        <div><dt>Voice level</dt><dd>{formatDb(report.speechRmsDbfs)}</dd></div>
        <div><dt>Boost needed</dt><dd>{report.neededBoostDb.toFixed(1)} dB</dd></div>
        <div><dt>Noise after boost</dt><dd>{formatDb(report.predictedFloorDbfs)}</dd></div>
      </dl>
      <p className={`room-warning ${report.status}`}>{report.warning}</p>
      <p className="meter-honesty">Use this as a quick guide before recording. Listen for HVAC, clicks, and echo.</p>
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
        <p className="phase-label">Add a chapter</p>
        <h2 id="composer-title">Add chapter 1</h2>
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
      <div className="brand-mark" aria-hidden="true">K</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}

interface BoothStep {
  tab: StudioTab;
  label: string;
  detail: string;
  chapterId?: string;
}

function studioPageCopy(tab: StudioTab): { kicker: string; title: string; lede: string } {
  switch (tab) {
    case "book":
      return { kicker: "The manuscript", title: "Book", lede: "Chapters, status, and the next honest step." };
    case "record":
      return { kicker: "The booth", title: "Record", lede: "Prompter, microphone, and the room." };
    case "review":
      return { kicker: "The take", title: "Review", lede: "Words that drifted, pauses, and pickups." };
    case "finish":
      return { kicker: "The pack", title: "Finish", lede: "Levels, export, and a shareable copy." };
    case "words":
      return { kicker: "Names and spellings", title: "Words", lede: "So everyone says them the same way." };
    case "people":
      return { kicker: "The handoff", title: "People", lede: "Author, narrator, and who may approve." };
    default:
      return { kicker: "This computer", title: "Settings", lede: "How chapters are checked and how the prompter looks." };
  }
}

function nextBoothStep(project: ProjectFile, chapter: ChapterFile | null, proof: ProofResult | null): BoothStep {
  if (project.chapters.length === 0) {
    return { tab: "book", label: "Add a chapter", detail: "Paste or import the manuscript before you record." };
  }
  const current = chapter ?? project.chapters[0];
  if (!current.audio_path) {
    return {
      tab: "record",
      chapterId: current.id,
      label: `Record ${current.title}`,
      detail: "Open the booth and capture this chapter.",
    };
  }
  const openPickups = proof?.pickups.filter((pickup) => pickup.status === "open").length ?? current.open_pickups ?? 0;
  if (openPickups > 0) {
    return {
      tab: "review",
      chapterId: current.id,
      label: `Review ${current.title}`,
      detail: `${openPickups} open pickup${openPickups === 1 ? "" : "s"} still need a listen.`,
    };
  }
  if (!current.acx_traffic_light) {
    return {
      tab: "finish",
      chapterId: current.id,
      label: "Check the audio",
      detail: "Measure levels before you export.",
    };
  }
  if (current.acx_traffic_light === "red") {
    return {
      tab: "finish",
      chapterId: current.id,
      label: "Fix the audio check",
      detail: "This chapter still needs attention.",
    };
  }
  const nextWithoutAudio = project.chapters.find((item) => !item.audio_path);
  if (nextWithoutAudio) {
    return {
      tab: "record",
      chapterId: nextWithoutAudio.id,
      label: `Record ${nextWithoutAudio.title}`,
      detail: `${current.title} has a take. The next chapter does not.`,
    };
  }
  return { tab: "finish", label: "Export ACX pack", detail: "Chapters are recorded. Package the book." };
}

function NavIcon({ name }: { name: StudioTab }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "book":
      return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
    case "record":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></svg>;
    case "review":
      return <svg {...common}><path d="M4 6h16M4 12h10M4 18h13" /><path d="M16 15l2 2 4-4" /></svg>;
    case "finish":
      return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
    case "words":
      return <svg {...common}><path d="M4 7h7M4 12h16M4 17h10" /><path d="M15 7h5" /></svg>;
    case "people":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.4" /><path d="M16 19a4.5 4.5 0 0 1 5-4" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  }
}

function authorStatusLabel(status: AuthorStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "needs_pickup":
      return "Needs pickup";
    case "ignore_this_flag":
      return "Ignored";
    default:
      return "Draft";
  }
}

function checkStatusLabel(status: string): string {
  switch (status) {
    case "green":
    case "pass":
      return "Ready";
    case "yellow":
    case "warn":
      return "Review";
    case "red":
    case "fail":
      return "Needs attention";
    case "unspecified":
      return "Not judged";
    default:
      return status;
  }
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
