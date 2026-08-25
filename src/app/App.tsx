import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AcxReport } from "../core/acx/measure";
import { noiseFloorListenRange } from "../core/acx/measure";
import { getExportReadiness, type ExportReadiness } from "../core/acx/export";
import {
  checkDefinition,
  exportSettles,
  summarizeExportFixes,
  type AggregateChange,
  type CheckKey,
  type ExportFixSummary,
} from "../core/acx/fixes";
import {
  formatChannels,
  formatDb,
  formatLength,
  formatLufs,
  formatRoomTone,
  formatSampleRate,
} from "../core/acx/format";
import { BUILTIN_PRESETS, deliveryProfile, presetTargets, resolvePreset } from "../core/acx/presets";
import type { CheckStatus } from "../core/acx/spec";
import { analyzeRoomTest, type RoomTestReport } from "../core/acx/room";
import { encodeWavPcm16 } from "../core/audio/wav";
import { resamplePcmToMono } from "../core/audio/resample";
import {
  contextPlaybackRange,
  playbackReachedEnd,
  preciseSelectedPlaybackRange,
  selectedPlaybackRange,
} from "../core/audio/playback-range";
import {
  alignTranscript,
  isSuppressedPickup,
  normalizeSuppressedWords,
  preservePickupWorkflow,
  type TranscriptWord,
} from "../core/proof/align";
import { buildPickupComparisons, type PickupComparison } from "../core/proof/comparison";
import {
  finalPickupProofReadiness,
  verifyPickupTranscript,
  type PickupVerification,
} from "../core/proof/pickup-verification";
import type { SilenceRange } from "../core/proof/silence";
import { scanBookOccurrences, type BookScanReport } from "../core/proof/book-scan";
import type { MergeConflict } from "../core/sharing/merge";
import {
  reflectPickupDecision,
  summarizeBookPickups,
  type BookPickupRow,
  type BookPickupSummary,
  type ChapterProgress,
} from "../core/proof/book-pickups";
import { findWordOccurrences, type WordOccurrence } from "../core/proof/occurrences";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  linkGlossarySpans,
  renameGlossaryEntry,
} from "../core/glossary/candidates";
import {
  checkChapterPronunciations,
  nextPronunciationCueByRows,
  type PromptPronunciationCue,
  type PronunciationCheck,
} from "../core/glossary/workflow";
import { fromPlainText } from "../core/manuscript/import";
import { hideMarkdownHeadingMarkers, parsePastedChapter } from "../core/manuscript/split";
import { normalizeToken, tokenizeManuscript } from "../core/proof/normalize";
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
  acceptGuestAnswer,
  acceptHostOffer,
  bindCollabChannel,
  closeCollabLink,
  createHostOffer,
  sendCollabFrame,
  watchCollabConnection,
} from "./collab-link";
import {
  bookDashboardStats,
  buildPromptLines,
  clampFontSize,
  createLiveFlagsState,
  dismissLiveFlag,
  filterPromptChapters,
  liveHighlightWordIndex,
  promptSentenceEnds,
  promptTextTokens,
  promptWordCount,
  recordLiveFlag,
  promptChapterStatus,
  readingProgress,
  relevantPromptGlossary,
  remainingReadTimeLabel,
  teleprompterLayout,
  liveCursorForVisibleLine,
  promptBandCovers,
  promptHighlightRange,
  promptWordRows,
  type PromptHighlightMode,
  type PromptTheme,
  type PromptWordRange,
} from "../core/teleprompter/model";
import { appendLiveQcSamples, applyLiveVisualRows, createLiveQcBuffer, drainLiveQcBuffer, matchLiveWindow, liveBackFlag, liveRequestStatus, liveVoiceStatusCopy, liveWordMark, liveFlagChipCopy, liveHaltCopy, manualLivePickup, mergeLivePickup, pickupFromLiveFlag, pcmHasSpeech, dropUnstableLiveTail, LIVE_CONTEXT_SECONDS, LIVE_HOP_SECONDS, LIVE_MIN_SPEECH_SECONDS, LIVE_OVERLAP_SECONDS, LIVE_SPEECH_RMS, LIVE_STREAM_HOP_SECONDS, LIVE_QC_STALL_SECONDS, LIVE_HALT_RUN_WORDS, type LiveExpectedWord, type LiveMismatch, type LiveMatchState, type LiveQcBuffer, type LiveVoiceStatus, type LiveWordConfirmation } from "../core/teleprompter/live";
import { boothShortcutAction } from "../core/teleprompter/booth-controls";
import { recordedManuscriptCoverage, stoppedReadFlow } from "../core/teleprompter/recording-flow";
import { initialTeleprompterPanels, shouldOfferChapterReview, teleprompterWorkflow, type TeleprompterWorkflow } from "../core/teleprompter/workflow";
import {
  createInputQuality,
  describeInputQuality,
  microphoneConstraints,
  observeInputQuality,
  type LiveInputQuality,
} from "../core/teleprompter/input-quality";
import { createLeadState, leadAdvance, leadOnConfirm, type LeadState } from "../core/teleprompter/lead";
import { createLiveTap, type LiveTap } from "../core/teleprompter/live-tap";
import { pickupKindPresentation } from "../core/proof/pickup-display";
import {
  advancePickupSession,
  buildPickupSession,
  type PickupSession,
} from "../core/proof/pickup-session";
import {
  alignedManuscriptTokens,
  buildNarrationRedoRanges,
  createNarratorRedoPickup,
  type NarrationRedoRange,
  type NarrationRedoRanges,
  type NarrationRedoScope,
} from "../core/proof/selection";
import {
  proofTimingPipeline,
  type ProofTimingEngine,
} from "../core/proof/pipeline";
import { refineLiveManuscriptTimeline } from "../core/proof/live-refinement";
import {
  ManuscriptProofProse,
  selectionActionReducer,
  type ManuscriptProofAnnotation,
} from "./paper-prose";
import {
  audioSourceForPickup,
  availableProofSources,
  buildLivePunchCue,
  chapterWithBoothTapeAsTake,
  concatLiveTape,
  listenDisabledReason,
  planLivePunchRoll,
  pickupLineBounds,
  proofAudioSource,
  punchDisabledReason,
  resolveProofSource,
  shouldKeepLiveTape,
  truncateLiveTape,
  type ProofSourceKind,
} from "../core/teleprompter/session-tape";
import { pickupPrerollStart, PICKUP_PREROLL_SECONDS } from "../core/teleprompter/pickup-line";
import type {
  AuthorStatus,
  ChapterFile,
  ChapterNote,
  GlossaryEntry,
  Pickup,
  PickupStatus,
  ProjectFile,
  ProjectPerson,
  ProjectSettings,
  ScriptSpan,
} from "../core/project/types";
import {
  settingsUpdateCopy,
  type AppUpdateStatus,
} from "./app-update";
import { AppUpdateNotice } from "./AppUpdateNotice";
import {
  shouldUseTranscriptOverride,
  type ProofTranscriptOrigin,
} from "./proof-transcript";

interface ProjectEnvelope {
  folder: string;
  project: ProjectFile;
}

interface ProofResult {
  pickups: Pickup[];
  transcript: TranscriptWord[];
  timingEngine?: ProofTimingEngine;
}

type StudioTab = "book" | "record" | "review" | "finish" | "words" | "people" | "settings";

const STUDIO_TABS: Array<{ id: Exclude<StudioTab, "settings">; label: string; hint: string }> = [
  { id: "book", label: "Book", hint: "Chapters" },
  { id: "record", label: "Record", hint: "Booth" },
  { id: "review", label: "Review", hint: "Pickups" },
  { id: "finish", label: "Finish", hint: "Delivery" },
  { id: "words", label: "Words", hint: "Pronounce" },
  { id: "people", label: "People", hint: "Roles" },
];

function useAppUpdate(): AppUpdateStatus | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge?.onAppUpdate) {
      return;
    }
    void bridge.appUpdateStatus().then(setStatus).catch(() => undefined);
    return bridge.onAppUpdate(setStatus);
  }, []);
  return status;
}

export function App() {
  const [project, setProject] = useState<ProjectEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectRequestRef = useRef(0);
  const updateStatus = useAppUpdate();

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
        updateStatus={updateStatus}
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
      <AppUpdateNotice status={updateStatus} />

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="phase-label">Start here</p>
          <h2 id="welcome-title">Make your next chapter sound right.</h2>
          <p className="lede">
            A quiet desk for one book: manuscript, human recordings, pickups,
            and the delivery check — all on this computer.
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
  updateStatus,
  onClose,
  onChange,
}: {
  envelope: ProjectEnvelope;
  updateStatus: AppUpdateStatus | null;
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
  const envelopeRef = useRef(envelope);
  envelopeRef.current = envelope;
  const selectedChapterIdRef = useRef(selectedChapterId);
  selectedChapterIdRef.current = selectedChapterId;
  const [chapterReloadVersion, setChapterReloadVersion] = useState(0);
  const [chapterText, setChapterText] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("Chapter 1");
  const [pastedText, setPastedText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const transcriptOriginRef = useRef<ProofTranscriptOrigin>("generated");
  const [proof, setProof] = useState<ProofResult | null>(null);
  const proofRef = useRef<ProofResult | null>(null);
  const [acxReport, setAcxReport] = useState<AcxReport | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [reviewAudioUrl, setReviewAudioUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const collabOutboundUnsub = useRef<null | (() => void)>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [exportResult, setExportResult] = useState<DeliveryExportResult | null>(null);
  const [activePanel, setActivePanel] = useState<StudioTab>("book");
  const [scanWord, setScanWord] = useState("");
  const [scanReport, setScanReport] = useState<BookScanReport | null>(null);
  const [bookPickups, setBookPickups] = useState<BookPickupSummary | null>(null);
  const [packReview, setPackReview] = useState<PackReview | null>(null);
  const [collabInvite, setCollabInvite] = useState<string | null>(null);
  const [collabWords, setCollabWords] = useState<string | null>(null);
  const [collabReply, setCollabReply] = useState<string | null>(null);
  const [collabPaste, setCollabPaste] = useState("");
  const [collabPhase, setCollabPhase] = useState("idle");
  const [collabPeer, setCollabPeer] = useState<{ name: string; role: string } | null>(null);
  const [collabConflicts, setCollabConflicts] = useState<MergeConflict[]>([]);
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
  const [promptHighlight, setPromptHighlight] = useState<PromptHighlightMode>(projectSettings.teleprompter_highlight);
  const [roomTestOpen, setRoomTestOpen] = useState(false);
  const [roomReport, setRoomReport] = useState<RoomTestReport | null>(null);
  const [punchPickup, setPunchPickup] = useState<Pickup | null>(null);
  const [pickupSession, setPickupSession] = useState<PickupSession | null>(null);
  const [glossaryRecording, setGlossaryRecording] = useState<GlossaryEntry | null>(null);
  const pendingTranscriptRef = useRef<{ chapterId: string; text: string } | null>(null);
  const [pickupSeatFilter, setPickupSeatFilter] = useState<"all" | "narration" | "N1" | "N2">("all");
  const [reviewSourceKind, setReviewSourceKind] = useState<ProofSourceKind | null>(null);
  const [checkedSourceKind, setCheckedSourceKind] = useState<ProofSourceKind | null>(null);
  const [duetNarrationSeat, setDuetNarrationSeat] = useState<"N1" | "N2">("N1");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pickupListenRef = useRef<HTMLAudioElement | null>(null);
  const pickupListenPathRef = useRef<string | null>(null);
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

  useEffect(() => {
    setReviewSourceKind(selectedChapter ? (proofAudioSource(selectedChapter)?.kind ?? null) : null);
    setCheckedSourceKind(null);
  }, [selectedChapter?.id]);

  const reviewAudioSource = selectedChapter
    ? resolveProofSource(selectedChapter, reviewSourceKind)
    : null;
  const chapterAudioSource = selectedChapter ? proofAudioSource(selectedChapter) : null;

  // A replacement take, punch, or duet mix keeps the same chapter id but
  // invalidates the previous proof/meter result. Clear those local views when
  // the attached audio changes; the chapter-loading effect below will restore
  // a persisted alignment only when the new take actually has one.
  useEffect(() => {
    setProof(null);
    setAcxReport(null);
    setRoomReport(null);
    transcriptOriginRef.current = "generated";
    setTranscriptText("");
  }, [selectedChapter?.id, selectedChapter?.audio_path]);

  useEffect(() => {
    setRoomReport(null);
  }, [project.room_test_path]);

  useEffect(() => {
    let disposed = false;
    setProof(null);
    setAcxReport(null);
    transcriptOriginRef.current = "generated";
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
          setProof({
            pickups: alignment.pickups,
            transcript: alignment.transcript,
            timingEngine: alignment.timing_engine,
          });
          setCheckedSourceKind(alignment.source_kind ?? (proofAudioSource(selectedChapter)?.kind ?? null));
          transcriptOriginRef.current = "generated";
          setTranscriptText(alignment.transcript.map((word) => word.text).join(" "));
        } else if (pendingTranscriptRef.current?.chapterId === selectedChapter.id) {
          transcriptOriginRef.current = "manual";
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
    const source = chapterAudioSource;
    if (!source || !window.boothDesk || folder === "(browser preview)") {
      return;
    }

    void window.boothDesk.audioUrl({ folder, relativePath: source.relativePath })
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
    };
  }, [chapterAudioSource?.relativePath, selectedChapter?.updated_at, folder]);

  useEffect(() => {
    let disposed = false;
    const source = reviewAudioSource;
    const sameAsChapter = source?.relativePath === chapterAudioSource?.relativePath;
    if (!source || sameAsChapter || !window.boothDesk || folder === "(browser preview)") {
      setReviewAudioUrl(null);
      return;
    }

    void window.boothDesk.audioUrl({ folder, relativePath: source.relativePath })
      .then((url) => {
        if (!disposed) {
          setReviewAudioUrl(url);
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setNotice(messageFor(reason, "Could not load the selected recording."));
        }
      });

    return () => {
      disposed = true;
    };
  }, [reviewAudioSource?.relativePath, chapterAudioSource?.relativePath, selectedChapter?.updated_at, folder]);

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
        setReviewSourceKind("take");
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
      setNotice("Attach an audio file before running the delivery check.");
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
      setExportResult((current) => current?.targetId === report.preset_id ? current : null);
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

  async function runProof(chapter: ChapterFile, options: { preferLive?: boolean } = {}): Promise<boolean> {
    // A fresh booth read must be checked against the tape that was just made,
    // even when the chapter also has an older attached take. Manual proofing
    // keeps preferring the chapter take.
    const source = options.preferLive && chapter.live_audio_path
      ? { relativePath: chapter.live_audio_path, start: 0, end: 0, kind: "live" as const }
      : proofAudioSource(chapter);
    if (!source) {
      setNotice("Start narrating and hit Stop, or attach a take, before checking.");
      return false;
    }
    if (chapterText.trim().length === 0) {
      setNotice("This chapter has no manuscript text to compare.");
      return false;
    }
    return runAction(`proof-${chapter.id}`, async () => {
      // The audio element can still expose the previous chapter's duration
      // for one render after selection changes. Ask the main process for the
      // selected path's metadata so alignment timestamps never inherit stale
      // UI state.
      let duration: number | undefined;
      if (window.boothDesk && folder !== "(browser preview)") {
        const metadata = await window.boothDesk.audioMetadata({
          folder,
          relativePath: source.relativePath,
        });
        duration = metadata.durationSeconds;
      } else {
        duration = audioRef.current?.duration;
      }

      // A Kosmos booth read is already tied to the manuscript while it is
      // recorded. Reuse that canonical word clock; sending the finished tape
      // through Whisper would create a second, noisier text representation of
      // words the app already knows.
      if (proofTimingPipeline(source.kind) === "manuscript-clock") {
        const timeline = checkedSourceKind === "live"
          ? (proofRef.current?.transcript ?? [])
          : [];
        if (timeline.length === 0) {
          throw new Error("This booth tape predates manuscript timing. Record the passage again in Kosmos to make it directly editable on the page.");
        }
        const next = {
          pickups: proofRef.current?.pickups ?? [],
          transcript: timeline,
          timingEngine: "manuscript-clock" as const,
        };
        proofRef.current = next;
        setProof(next);
        setCheckedSourceKind("live");
        setNotice("The booth tape is mapped directly to the manuscript. Highlight any timed passage to perform it again.");
        return;
      }

      let transcript: TranscriptWord[];
      let silences: SilenceRange[] | undefined;
      let timingEngine: ProofTimingEngine;
      if (shouldUseTranscriptOverride({
        text: transcriptText,
        origin: transcriptOriginRef.current,
        preferLive: options.preferLive === true,
      })) {
        transcript = timedTranscript(transcriptText, duration || 1);
        timingEngine = "manual";
      } else if (window.boothDesk) {
        const local = await window.boothDesk.transcribe({
          folder,
          relativePath: source.relativePath,
          language: "en",
        });
        transcript = local.words;
        silences = local.silences;
        timingEngine = local.timingEngine ?? (local.engine === "whisperx" ? "whisperx" : "whisper.cpp");
        transcriptOriginRef.current = "generated";
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
        silences,
      });
      const freshPickups = project.mode === "duet"
        ? assignPickupSeats(
            result.pickups,
            buildDuetTimeline(chapterSpans, transcript, duration || 1),
          )
        : result.pickups;
      const pickups = preservePickupWorkflow(proof?.pickups ?? [], freshPickups);
      setProof({ pickups, transcript, timingEngine });
      setCheckedSourceKind(source.kind);
      if (window.boothDesk && folder !== "(browser preview)") {
        const saved = await window.boothDesk.saveAlignment({
          ...envelope,
          chapterId: chapter.id,
          pickups,
          transcript,
          sourceKind: source.kind,
          timingEngine,
        });
        onChange(saved);
      }
      const mismatchCount = pickups.filter((pickup) => pickup.kind !== "pause").length;
      const pauseCount = pickups.filter((pickup) => pickup.kind === "pause").length;
      const timingCopy = timingEngine === "whisperx"
        ? " Precise word timing was aligned with WhisperX."
        : timingEngine === "manual"
          ? " Timing is estimated from the supplied transcript."
          : " WhisperX was unavailable, so Kosmos used its bundled Whisper timing.";
      setNotice(
        pickups.length === 0
          ? `No word changes or long pauses found. Listen once for delivery and background noise.${timingCopy}`
          : `${mismatchCount > 0 ? `${mismatchCount} word ${mismatchCount === 1 ? "mismatch" : "mismatches"}` : "No word mismatches"}`
            + `${pauseCount > 0 ? `; ${pauseCount} long ${pauseCount === 1 ? "pause" : "pauses"}` : ""} found.${timingCopy}`,
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

  async function exportDelivery() {
    const target = resolvePreset(projectSettings.spec_preset_id);
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice(`${target.label} export is available in the desktop app after the master core is built.`);
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
      const result = await window.boothDesk?.exportDelivery(envelope);
      if (result) {
        setExportResult(result);
        setNotice(
          result.status === "ready_with_warnings"
            ? `${result.targetLabel} pack is ready with ${result.warningCount} item${result.warningCount === 1 ? "" : "s"} to review.`
            : `${result.targetLabel} pack is ready. Listen once before delivery.`,
        );
      }
    });
  }

  async function showDeliveryPack() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("The pack folder is available in the desktop app.");
      return;
    }
    try {
      await window.boothDesk.showDeliveryPack(envelope);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not open the delivery pack folder."));
    }
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
          sourceKind: checkedSourceKind ?? undefined,
          timingEngine: proof.timingEngine,
        });
        onChange(saved);
      }
      // The whole-book list sits under this one on the same screen, so a flag
      // must not still read as open there after being settled here.
      const decided = pickups.find((candidate) => candidate.id === pickup.id);
      if (changes.status && decided) {
        setBookPickups((current) => current
          ? reflectPickupDecision(current, decided, {
            chapterId: selectedChapter.id,
            chapterIndex: selectedChapter.index,
            chapterTitle: selectedChapter.title,
          })
          : current);
      }
      setNotice(`Pickup ${changes.status ? changes.status : "note"} saved.`);
    });
  }

  async function persistAlignment(chapterId: string, next: ProofResult, sourceKind?: ProofSourceKind) {
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
      sourceKind: sourceKind ?? checkedSourceKind ?? undefined,
      timingEngine: next.timingEngine,
    });
    envelopeRef.current = saved;
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
      timingEngine: current?.timingEngine ?? "manuscript-clock",
    }, "live");
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
        if (kind === "chapter") {
          setReviewSourceKind("take");
        }
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

  async function applyPunchRecordingWav(wavBase64: string, pickup: Pickup): Promise<PunchSaveResult | false> {
    if (!window.boothDesk || folder === "(browser preview)" || !selectedChapter) {
      throw new Error("Add a chapter recording before creating a pickup.");
    }
    // Replace the line, not the word. A word dropped into the middle of a
    // sentence carries the pace and pitch of the take it was recorded in, so the
    // seam is audible however clean the edit is; a sentence boundary falls in a
    // breath, where a change of tone reads as the start of a new thought.
    const replaced = pickupLineBounds(pickup);
    if (actionLockRef.current) {
      return false;
    }
    actionLockRef.current = true;
    setBusyAction("punch");
    setNotice(null);
    try {
      const result = await window.boothDesk.applyPunchRecording({
        ...envelope,
        chapterId: selectedChapter.id,
        pickupId: pickup.id,
        expected: pickup.expected,
        heard: pickup.heard,
        tStart: replaced.start,
        tEnd: replaced.end,
        trimSilence: true,
        wavBase64,
      });
      onChange(result);
      setProof(null);
      setCheckedSourceKind(null);
      transcriptOriginRef.current = "generated";
      setTranscriptText("");
      setNotice("Pickup applied to the chapter's edited take. The original recording is unchanged.");
      return result;
    } catch (reason) {
      setNotice(messageFor(reason, "The pickup could not be applied."));
      return false;
    } finally {
      setBusyAction(null);
      actionLockRef.current = false;
    }
  }

  async function previewPunchRecordingWav(
    wavBase64: string,
    pickup: Pickup,
  ): Promise<PunchPreviewResult | false> {
    if (!window.boothDesk || folder === "(browser preview)" || !selectedChapter) {
      throw new Error("Add a chapter recording before previewing a pickup.");
    }
    if (actionLockRef.current) {
      return false;
    }
    const replaced = pickupLineBounds(pickup);
    actionLockRef.current = true;
    setBusyAction("punch-preview");
    setNotice(null);
    try {
      return await window.boothDesk.previewPunchRecording({
        ...envelope,
        chapterId: selectedChapter.id,
        tStart: replaced.start,
        tEnd: replaced.end,
        trimSilence: true,
        wavBase64,
      });
    } catch (reason) {
      setNotice(messageFor(reason, "The pickup preview could not be created."));
      return false;
    } finally {
      setBusyAction(null);
      actionLockRef.current = false;
    }
  }

  async function verifyPunchRecordingWav(wavBase64: string, pickup: Pickup): Promise<PickupVerification> {
    const manuscript = pickup.line_text?.trim() || pickup.expected.trim();
    if (!window.boothDesk?.transcribeBuffer || manuscript.length === 0) {
      return verifyPickupTranscript({ manuscript, transcript: [] });
    }
    try {
      const transcription = await promiseWithTimeout(
        window.boothDesk.transcribeBuffer({
          audioBase64: wavBase64,
          mimeType: "audio/wav",
          language: "en",
          engine: "whisper",
        }),
        120_000,
        "The pickup word check took too long.",
      );
      return verifyPickupTranscript({ manuscript, transcript: transcription.words });
    } catch {
      // Recognition is supporting evidence, never a gate. A missing model or
      // uncertain short clip still leaves the narrator's A/B review available.
      return verifyPickupTranscript({ manuscript, transcript: [] });
    }
  }

  async function persistProject(nextProject: ProjectFile): Promise<void> {
    const nextEnvelope = window.boothDesk && folder !== "(browser preview)"
      ? await window.boothDesk.saveProject({ folder, project: nextProject })
      : { folder, project: nextProject };
    onChange(nextEnvelope);
  }

  async function verifyPunchRecording(punchId: string): Promise<void> {
    const punch = (project.punch_recordings ?? []).find((candidate) => candidate.id === punchId);
    if (!punch || punch.edit_status === "reverted" || punch.verification_status === "verified") {
      return;
    }
    await runAction(`verify-punch-${punchId}`, async () => {
      await persistProject({
        ...project,
        punch_recordings: (project.punch_recordings ?? []).map((candidate) => candidate.id === punchId
          ? { ...candidate, verification_status: "verified" as const }
          : candidate),
        updated_at: new Date().toISOString(),
      });
      setNotice("Pickup marked verified after listening in context.");
    });
  }

  async function undoLatestPunch(): Promise<void> {
    if (!window.boothDesk || folder === "(browser preview)" || !selectedChapter) {
      setNotice("Pickup undo is available after a chapter recording is attached.");
      return;
    }
    await runAction("undo-punch", async () => {
      const result = await window.boothDesk?.undoLatestPunchRecording({
        ...envelope,
        chapterId: selectedChapter.id,
      });
      if (result) {
        onChange(result);
        setProof(null);
        setCheckedSourceKind(null);
        transcriptOriginRef.current = "generated";
        setTranscriptText("");
        setNotice("Latest pickup undone. Its clip remains in history and the original is unchanged.");
      }
    });
  }

  async function openPunchRecorder(pickup: Pickup, inSession = false): Promise<boolean> {
    if (!selectedChapter) {
      return false;
    }
    const blocked = punchDisabledReason(pickup, selectedChapter);
    if (blocked) {
      setNotice(blocked);
      return false;
    }
    const next = chapterWithBoothTapeAsTake(selectedChapter);
    if (next.audio_path !== selectedChapter.audio_path) {
      const now = new Date().toISOString();
      try {
        await persistProject({
          ...project,
          chapters: project.chapters.map((item) => item.id === selectedChapter.id
            ? { ...next, updated_at: now }
            : item),
          updated_at: now,
        });
        setNotice("Kept this booth tape as the chapter take so the pickup can be spliced in.");
      } catch (reason) {
        setNotice(messageFor(reason, "Could not keep this booth tape as the chapter take."));
        return false;
      }
    }
    if (!inSession) {
      setPickupSession(null);
    }
    setPunchPickup(pickup);
    return true;
  }

  async function startPickupSession(pickups: Pickup[]): Promise<void> {
    if (!selectedChapter) {
      return;
    }
    const eligible = pickups.filter((pickup) => !punchDisabledReason(pickup, selectedChapter));
    const session = buildPickupSession(eligible);
    if (session.items.length === 0) {
      setNotice("None of these review points can be recorded against the current chapter take.");
      return;
    }
    const opened = await openPunchRecorder(session.items[0].pickup, true);
    if (opened) {
      setPickupSession(session);
    }
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

  async function openCollaboratorPack() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Opening a collaborator pack is available in the desktop app.");
      return;
    }
    await runAction("pack-review", async () => {
      const review = await window.boothDesk?.reviewPack(envelope);
      if (!review) {
        return;
      }
      setPackReview(review);
      setNotice(`${review.packName}: ${review.summary}`);
    });
  }

  async function applyCollaboratorPack() {
    if (!packReview || !window.boothDesk) {
      return;
    }
    const stagingId = packReview.stagingId;
    await runAction("pack-apply", async () => {
      const result = await window.boothDesk?.applyPack({ ...envelope, stagingId });
      if (!result) {
        return;
      }
      onChange({ folder: result.folder, project: result.project });
      setPackReview(null);
      setProof(null);
      setChapterReloadVersion((version) => version + 1);
      const applied = result.applied;
      setNotice(
        `Brought in ${applied.recordings} recording${applied.recordings === 1 ? "" : "s"}, `
        + `${applied.decisions} flag decision${applied.decisions === 1 ? "" : "s"}, `
        + `${applied.notes} note${applied.notes === 1 ? "" : "s"} and `
        + `${applied.glossary} pronunciation entr${applied.glossary === 1 ? "y" : "ies"}.`,
      );
    });
  }

  async function discardCollaboratorPack() {
    const stagingId = packReview?.stagingId;
    setPackReview(null);
    if (!stagingId || !window.boothDesk) {
      return;
    }
    await window.boothDesk.discardPack({ stagingId }).catch(() => undefined);
  }

  function applyCollabSnapshot(snapshot: CollabSnapshot) {
    setCollabPhase(snapshot.phase);
    setCollabInvite(snapshot.invite);
    setCollabWords(snapshot.words);
    setCollabPeer(snapshot.peer);
    setCollabConflicts(snapshot.lastReview?.plan.conflicts ?? []);
    if (snapshot.projectUpdated && snapshot.project && snapshot.folder) {
      onChange({ folder: snapshot.folder, project: snapshot.project });
      setChapterReloadVersion((version) => version + 1);
    }
  }

  function wireCollabChannel(asHost: boolean) {
    collabOutboundUnsub.current?.();
    collabOutboundUnsub.current = window.boothDesk?.onCollabOutbound((text) => sendCollabFrame(text)) ?? null;
    bindCollabChannel({
      onOpen: () => {
        if (asHost) {
          void window.boothDesk?.collabStart().then((snapshot) => {
            if (snapshot) {
              applyCollabSnapshot(snapshot);
            }
            setNotice("They are on the book with you.");
          });
        } else {
          void window.boothDesk?.collabAnnounce();
          setCollabPhase("connected");
          setNotice("Connected. Waiting for their book…");
        }
      },
      onMessage: (text) => {
        void window.boothDesk?.collabInbound(text).then((snapshot) => {
          if (!snapshot) {
            return;
          }
          applyCollabSnapshot(snapshot);
          const conflicts = snapshot.lastReview?.plan.conflicts?.length ?? 0;
          if (conflicts > 0) {
            setNotice(`${conflicts} disagreement${conflicts === 1 ? "" : "s"} kept your copy.`);
          }
        });
      },
      onClose: () => {
        setCollabPhase("idle");
        setCollabPeer(null);
        setNotice("The live session ended.");
      },
    });
  }

  async function createLiveInvite() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Live invite is available in the desktop app.");
      return;
    }
    if (!identity) {
      setNotice("Save your name and role first.");
      return;
    }
    await runAction("collab-invite", async () => {
      const minted = await window.boothDesk?.collabIceServers();
      const offer = await createHostOffer(minted?.iceServers);
      const snapshot = await window.boothDesk?.collabEncodeInvite({ project, sdp: offer });
      if (!snapshot) {
        return;
      }
      await window.boothDesk?.collabAttach({
        folder,
        project,
        identity: { name: identity.personName, role: identity.role },
      });
      wireCollabChannel(true);
      applyCollabSnapshot(snapshot);
      setCollabReply(null);
      setNotice("Invite ready. Send it, then paste their reply.");
    });
  }

  async function joinLiveInvite() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Joining is available in the desktop app.");
      return;
    }
    if (!identity) {
      setNotice("Save your name and role first.");
      return;
    }
    await runAction("collab-join", async () => {
      const decoded = await window.boothDesk?.collabDecodeInvite(collabPaste);
      if (!decoded?.sdp) {
        throw new Error("That invite is missing a connection offer.");
      }
      const minted = await window.boothDesk?.collabIceServers();
      const answer = await acceptHostOffer(decoded.sdp, minted?.iceServers);
      const reply = await window.boothDesk?.collabEncodeReply({ sdp: answer });
      await window.boothDesk?.collabAttach({
        folder,
        project,
        identity: { name: identity.personName, role: identity.role },
      });
      wireCollabChannel(false);
      watchCollabConnection((message) => {
        setNotice(message);
        void hangUpLive();
      });
      setCollabWords(decoded.words);
      setCollabReply(reply ?? null);
      setCollabPhase("joining");
      setNotice("Send this reply back. Say the three words out loud to check the line.");
    });
  }

  async function acceptLiveReply() {
    if (!window.boothDesk) {
      return;
    }
    await runAction("collab-reply", async () => {
      const parsed = await window.boothDesk?.collabDecodeReply(collabPaste);
      if (!parsed) {
        return;
      }
      await acceptGuestAnswer(parsed.sdp);
      watchCollabConnection((message) => {
        setNotice(message);
        void hangUpLive();
      });
      setNotice("Reply accepted. Waiting for the line to open…");
    });
  }

  async function hangUpLive() {
    collabOutboundUnsub.current?.();
    collabOutboundUnsub.current = null;
    closeCollabLink();
    await window.boothDesk?.collabDisconnect().catch(() => undefined);
    setCollabPhase("idle");
    setCollabInvite(null);
    setCollabReply(null);
    setCollabPeer(null);
    setCollabConflicts([]);
    setNotice("You left the live session.");
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
      if (patch.teleprompter_highlight !== undefined) {
        setPromptHighlight(settings.teleprompter_highlight);
      }
      setNotice("Preferences saved.");
    });
  }

  /**
   * Save reading preferences changed inside the teleprompter. They are session
   * state while reading so the controls stay instant, and are written once on
   * the way out rather than on every tap.
   */
  function persistPromptPreferences() {
    if (
      promptFontSize === projectSettings.teleprompter_font_size
      && promptTheme === projectSettings.teleprompter_theme
      && promptHighlight === projectSettings.teleprompter_highlight
    ) {
      return;
    }
    void persistSettings({
      teleprompter_font_size: promptFontSize,
      teleprompter_theme: promptTheme,
      teleprompter_highlight: promptHighlight,
    });
  }

  async function loadBookPickups() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("The whole-book list is available in the desktop app.");
      return;
    }
    await runAction("book-pickups", async () => {
      const book = await window.boothDesk?.readBookProof(envelope);
      if (!book) {
        return;
      }
      setBookPickups(summarizeBookPickups(book.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        hasAudio: chapter.hasAudio,
        checked: chapter.checked,
        pickups: chapter.pickups,
      }))));
    });
  }

  async function decideBookPickups(rows: BookPickupRow[], status: PickupStatus) {
    if (rows.length === 0) {
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("The whole-book list is available in the desktop app.");
      return;
    }
    const byChapter = new Map<string, string[]>();
    for (const row of rows) {
      const ids = byChapter.get(row.chapterId) ?? [];
      ids.push(row.pickup.id);
      byChapter.set(row.chapterId, ids);
    }
    const requests = [...byChapter.entries()].map(([chapterId, ids]) => ({ chapterId, ids }));
    await runAction("book-pickups", async () => {
      const result = await window.boothDesk?.resolveBookPickups({ ...envelope, requests, status });
      if (!result) {
        return;
      }
      onChange({ folder: result.folder, project: result.project });
      // The open chapter's list is on screen, so reflect the decision there too.
      const openChapterIds = byChapter.get(selectedChapterId ?? "");
      if (openChapterIds) {
        setProof((current) => current
          ? {
            ...current,
            pickups: current.pickups.map((pickup) => openChapterIds.includes(pickup.id)
              ? { ...pickup, status }
              : pickup),
          }
          : current);
      }
      setNotice(`${rows.length} ${rows.length === 1 ? "flag" : "flags"} marked ${status} across ${result.changedChapters} ${result.changedChapters === 1 ? "chapter" : "chapters"}.`);
    });
    await loadBookPickups();
  }

  async function scanBookForWord(candidate?: string) {
    const word = (candidate ?? scanWord).trim();
    if (candidate !== undefined) {
      setScanWord(candidate);
    }
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

  /**
   * A scan that finds a name read two ways ends in one decision: write the
   * pronunciation down. Do it from the scan, without retyping the word.
   */
  async function addScannedWordToGuide(word: string, heard: string) {
    const trimmed = word.trim();
    if (trimmed === "") {
      return;
    }
    const existing = glossaryEntryFor(project.glossary ?? [], trimmed);
    await runAction("glossary-add", async () => {
      const glossary = existing
        ? renameGlossaryEntry(project.glossary ?? [], existing.id, existing.spelling, heard, existing.voice_note ?? "")
        : addGlossaryEntry(project.glossary ?? [], trimmed, { respell: heard });
      await persistGlossary(glossary);
      setNotice(
        heard.trim() === ""
          ? `“${trimmed}” is in the pronunciation guide. Add the respelling in Words.`
          : `“${trimmed}” is in the pronunciation guide as “${heard}”. Edit it in Words.`,
      );
    });
  }

  async function editGlossary(id: string, spelling: string, respell: string, voiceNote: string) {
    await runAction(`glossary-${id}`, async () => {
      const glossary = renameGlossaryEntry(project.glossary ?? [], id, spelling, respell, voiceNote);
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

  async function fillGlossaryRespells() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Dictionary pronunciations are available in the desktop app.");
      return;
    }
    await runAction("glossary-suggest", async () => {
      const result = await window.boothDesk?.suggestGlossaryRespells(envelope);
      if (!result) {
        return;
      }
      onChange({ folder: result.folder, project: result.project });
      const unknown = result.unknown.length;
      setNotice(
        result.filled === 0
          ? `The dictionary does not know ${unknown === 1 ? "that name" : `any of those ${unknown} names`}. Write the pronunciation yourself.`
          : `Filled ${result.filled} pronunciation${result.filled === 1 ? "" : "s"} from the dictionary.`
            + (unknown > 0 ? ` ${unknown} still need${unknown === 1 ? "s" : ""} a person: ${result.unknown.slice(0, 6).join(", ")}${unknown > 6 ? "…" : ""}.` : ""),
      );
    });
  }

  async function exportVoiceGuide() {
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Voice guide export is available in the desktop app.");
      return;
    }
    await runAction("glossary-export-guide", async () => {
      const result = await window.boothDesk?.exportVoiceGuide(envelope);
      if (result) {
        setNotice(`Wrote ${result.files.length} file${result.files.length === 1 ? "" : "s"} to ${result.folder}.`);
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

  function waitAudioReady(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= 1) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onReady = () => {
        audio.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        reject(new Error("Could not load the recording."));
      };
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.load();
    });
  }

  /**
   * `pad` is deliberate context on both sides. Selected-word playback passes
   * zero so the stored first/last word boundaries remain exact.
   */
  function playOnElement(audio: HTMLAudioElement, start: number, end?: number, pad = 0.5) {
    rangeStopRef.current?.();
    const range = end !== undefined && Number.isFinite(end) && end > start
      ? (pad > 0 ? contextPlaybackRange(start, end, pad) : selectedPlaybackRange(start, end))
      : selectedPlaybackRange(Math.max(0, start - pad), Math.max(0, start - pad));
    audio.currentTime = range.start;
    const playing = audio.play();
    if (end !== undefined && Number.isFinite(end) && end > start) {
      let animationFrame: number | null = null;
      let stopped = false;
      const stopAtEnd = () => {
        if (playbackReachedEnd(audio.currentTime, range.end)) {
          stopped = true;
          audio.pause();
          rangeStopRef.current?.();
        }
      };
      const monitor = () => {
        stopAtEnd();
        if (!stopped) {
          animationFrame = window.requestAnimationFrame(monitor);
        }
      };
      audio.addEventListener("timeupdate", stopAtEnd);
      animationFrame = window.requestAnimationFrame(monitor);
      rangeStopRef.current = () => {
        stopped = true;
        audio.removeEventListener("timeupdate", stopAtEnd);
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
        rangeStopRef.current = null;
      };
    }
    return playing;
  }

  async function playPickup(pickup: Pickup) {
    if (!selectedChapter) {
      return;
    }
    const source = audioSourceForPickup(pickup, selectedChapter);
    if (!source) {
      setNotice(listenDisabledReason(pickup, selectedChapter) ?? "Nothing to play.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Listening is available in the desktop app.");
      return;
    }
    const visible = reviewAudioSource;
    const visibleAudio = audioRef.current;
    const visibleUrl = reviewAudioUrl ?? audioUrl;
    if (visible && visible.relativePath === source.relativePath && visibleAudio && visibleUrl) {
      playOnElement(visibleAudio, source.start, source.end, source.wordOnly ? 0.5 : 0);
      return;
    }
    const audio = pickupListenRef.current;
    if (!audio) {
      setNotice("Listen player is not ready.");
      return;
    }
    try {
      if (pickupListenPathRef.current !== source.relativePath) {
        const url = await window.boothDesk.audioUrl({ folder, relativePath: source.relativePath });
        pickupListenPathRef.current = source.relativePath;
        audio.src = url;
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            audio.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener("loadedmetadata", onReady);
            reject(new Error("Could not load the recording."));
          };
          audio.addEventListener("loadedmetadata", onReady, { once: true });
          audio.addEventListener("error", onError, { once: true });
          audio.load();
        });
      }
      playOnElement(audio, source.start, source.end, source.wordOnly ? 0.5 : 0);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not play this flag."));
    }
  }

  async function playPronunciationMoment(check: PronunciationCheck, preferLive = false) {
    if (!selectedChapter || check.start === undefined) {
      setNotice("This pronunciation has no aligned audio moment to play.");
      return;
    }
    const source = preferLive && selectedChapter.live_audio_path
      ? { relativePath: selectedChapter.live_audio_path }
      : proofAudioSource(selectedChapter);
    if (!source || !window.boothDesk || folder === "(browser preview)") {
      setNotice("Listening is available after this recording has been saved.");
      return;
    }
    const audio = pickupListenRef.current;
    if (!audio) {
      return;
    }
    try {
      if (pickupListenPathRef.current !== source.relativePath) {
        const url = await window.boothDesk.audioUrl({ folder, relativePath: source.relativePath });
        pickupListenPathRef.current = source.relativePath;
        audio.src = url;
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            audio.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener("loadedmetadata", onReady);
            reject(new Error("Could not load the recording."));
          };
          audio.addEventListener("loadedmetadata", onReady, { once: true });
          audio.addEventListener("error", onError, { once: true });
          audio.load();
        });
      }
      playOnElement(audio, check.start, check.end, 0.8);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not play this pronunciation."));
    }
  }

  /**
   * Punch and roll: play the read leading into the line, then hand over to the
   * recorder. Narrators come in on the tone and pace they just heard, which is
   * what makes the replacement sit inside the take instead of on top of it.
   */
  async function playPickupPreroll(pickup: Pickup) {
    if (!selectedChapter) {
      return;
    }
    const source = audioSourceForPickup(pickup, selectedChapter);
    if (!source || !window.boothDesk || folder === "(browser preview)") {
      setNotice(listenDisabledReason(pickup, selectedChapter) ?? "Nothing to play.");
      return;
    }
    const audio = pickupListenRef.current;
    if (!audio) {
      return;
    }
    try {
      if (pickupListenPathRef.current !== source.relativePath) {
        const url = await window.boothDesk.audioUrl({ folder, relativePath: source.relativePath });
        pickupListenPathRef.current = source.relativePath;
        audio.src = url;
        audio.load();
      }
      playOnElement(audio, pickupPrerollStart(source.start), source.start, 0);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not play the lead-in."));
    }
  }

  /** Play only the manuscript words the narrator highlighted—no lead-in or post-roll. */
  async function playPickupSelection(pickup: Pickup) {
    if (!selectedChapter) {
      return;
    }
    const source = audioSourceForPickup(pickup, selectedChapter);
    if (!source || !window.boothDesk || folder === "(browser preview)") {
      setNotice(listenDisabledReason(pickup, selectedChapter) ?? "Nothing to play.");
      return;
    }
    const audio = pickupListenRef.current;
    if (!audio) {
      return;
    }
    try {
      if (pickupListenPathRef.current !== source.relativePath) {
        const url = await window.boothDesk.audioUrl({ folder, relativePath: source.relativePath });
        pickupListenPathRef.current = source.relativePath;
        audio.src = url;
        audio.load();
      }
      await waitAudioReady(audio);
      await playOnElement(audio, source.start, source.end, 0);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not play the selected words."));
    }
  }

  async function finishLiveTape(
    result: ProjectEnvelope,
    chapterId: string,
    timeline: TranscriptWord[],
  ): Promise<void> {
    if (!window.boothDesk || folder === "(browser preview)") {
      return;
    }
    const existing = await window.boothDesk.readAlignment({
      folder: result.folder,
      project: result.project,
      chapterId,
    });
    const pickups = existing?.pickups
      ?? (selectedChapter?.id === chapterId ? proofRef.current?.pickups : undefined)
      ?? [];
    const saved = await window.boothDesk.saveAlignment({
      folder: result.folder,
      project: result.project,
      chapterId,
      pickups,
      transcript: timeline,
      sourceKind: "live",
      timingEngine: "manuscript-clock",
    });
    onChange(saved);
    if (selectedChapter?.id === chapterId) {
      const next = { pickups, transcript: timeline, timingEngine: "manuscript-clock" as const };
      proofRef.current = next;
      setProof(next);
      setCheckedSourceKind("live");
      setReviewSourceKind("live");
    }
    setNotice(
      timeline.length > 0
        ? "Kept the booth tape and mapped it directly to the manuscript. Precise word timing is refining in the background."
        : "Kept the booth tape. No manuscript timing was captured, so record the passage again before editing it on the page.",
    );
    if (timeline.length > 0) {
      void refineStoppedLiveTape(saved, chapterId, timeline, pickups);
    }
  }

  async function refineStoppedLiveTape(
    saved: ProjectEnvelope,
    chapterId: string,
    baseline: TranscriptWord[],
    pickups: Pickup[],
  ): Promise<void> {
    if (!window.boothDesk) {
      return;
    }
    const chapter = saved.project.chapters.find((candidate) => candidate.id === chapterId);
    const relativePath = chapter?.live_audio_path ?? chapter?.audio_path;
    if (!relativePath) {
      return;
    }
    try {
      const aligned = await window.boothDesk.transcribe({
        folder: saved.folder,
        relativePath,
        language: "en",
      });
      if (aligned.timingEngine !== "whisperx") {
        setNotice("The booth tape is ready with its manuscript timing. Precise refinement was unavailable, so nothing was replaced.");
        return;
      }
      const refinement = refineLiveManuscriptTimeline({
        manuscript: chapterText,
        baseline,
        aligned: aligned.words,
      });
      if (!refinement.adopted) {
        setNotice(`The booth tape is ready. Precise timing covered only ${Math.round(refinement.coverage * 100)}%, so Kosmos kept the original manuscript clock.`);
        return;
      }
      if (envelopeRef.current.folder !== saved.folder) {
        return;
      }
      const refined = await window.boothDesk.saveAlignment({
        folder: envelopeRef.current.folder,
        project: envelopeRef.current.project,
        chapterId,
        pickups,
        transcript: refinement.timeline,
        sourceKind: "live",
        timingEngine: "whisperx",
      });
      envelopeRef.current = refined;
      onChange(refined);
      if (selectedChapterIdRef.current === chapterId) {
        const next = { pickups, transcript: refinement.timeline, timingEngine: "whisperx" as const };
        proofRef.current = next;
        setProof(next);
        setCheckedSourceKind("live");
        setReviewSourceKind("live");
      }
      setNotice(`Precise timing is ready for ${refinement.refinedWordCount} manuscript words. Highlighted playback now uses the refined boundaries.`);
    } catch (reason) {
      console.warn("Live timing refinement unavailable; keeping manuscript clock", reason);
      setNotice("The booth tape is ready with its original manuscript timing. Precise refinement could not finish, so nothing was replaced.");
    }
  }

  async function saveLiveTape(wavBase64: string, chapterId: string, timeline: TranscriptWord[]) {
    if (!window.boothDesk || folder === "(browser preview)") {
      throw new Error("Booth tape save is available in the desktop app.");
    }
    const result = await window.boothDesk.saveRecordingWav({
      ...envelope,
      kind: "live",
      chapterId,
      wavBase64,
    });
    if (result) {
      await finishLiveTape(result, chapterId, timeline);
    }
  }

  function playRange(start: number, end?: number, pad = 0.5) {
    const audio = audioRef.current;
    if (!audio) {
      setNotice("The chapter player is not ready.");
      return;
    }
    audio.scrollIntoView({ block: "nearest", behavior: "smooth" });
    void waitAudioReady(audio)
      .then(() => playOnElement(audio, start, end, pad))
      .catch((reason: unknown) => {
        setNotice(messageFor(reason, "Could not play that section."));
      });
  }

  async function playNoiseFloor() {
    if (!selectedChapter || !acxReport) {
      setNotice("Check audio first so there is a noise floor to hear.");
      return;
    }
    const measuredPath = selectedChapter.audio_path;
    if (!measuredPath) {
      setNotice("Attach a chapter take before listening to the noise floor.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Listening is available in the desktop app.");
      return;
    }
    const range = noiseFloorListenRange(
      acxReport.noise_floor_start_seconds,
      acxReport.noise_floor_duration_seconds,
      acxReport.duration_seconds,
    );
    try {
      const visible = chapterAudioSource;
      const visibleAudio = audioRef.current;
      if (visibleAudio && visible?.relativePath === measuredPath) {
        visibleAudio.scrollIntoView({ block: "nearest", behavior: "smooth" });
        await waitAudioReady(visibleAudio);
        await playOnElement(visibleAudio, range.start, range.end, 0);
        return;
      }
      const hidden = pickupListenRef.current;
      if (!hidden) {
        setNotice("Listen player is not ready.");
        return;
      }
      if (pickupListenPathRef.current !== measuredPath) {
        const url = await window.boothDesk.audioUrl({ folder, relativePath: measuredPath });
        pickupListenPathRef.current = measuredPath;
        hidden.src = url;
      }
      await waitAudioReady(hidden);
      await playOnElement(hidden, range.start, range.end, 0);
    } catch (reason) {
      setNotice(messageFor(reason, "Could not play the noise floor."));
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

  async function exportPickupPacket() {
    if (!selectedChapter || !proof) {
      setNotice("Check the chapter first so there is something to put in a packet.");
      return;
    }
    if (!window.boothDesk || folder === "(browser preview)") {
      setNotice("Packets are built in the desktop app.");
      return;
    }
    await runAction("pickup-packet", async () => {
      const result = await window.boothDesk?.exportPickupPacket({
        ...envelope,
        chapterId: selectedChapter.id,
        transcript: proof.transcript,
        pickups: proof.pickups,
      });
      if (result) {
        setNotice(
          `Packet saved to ${result.folder}: ${result.pickupCount} ${result.pickupCount === 1 ? "flag" : "flags"}, ${result.clipCount} ${result.clipCount === 1 ? "clip" : "clips"}. Open index.html to review it anywhere.`,
        );
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
      checkedSourceKind={checkedSourceKind}
      acxReport={acxReport}
      audioUrl={audioUrl}
      modelAvailable={modelAvailable}
      busyAction={busyAction}
      fontSize={promptFontSize}
      theme={promptTheme}
      highlight={promptHighlight}
      onFontSize={setPromptFontSize}
      onTheme={setPromptTheme}
      onHighlight={setPromptHighlight}
      onPlayGlossary={(entry) => void playGlossaryClip(entry)}
      onListenPronunciation={(check, preferLive) => void playPronunciationMoment(check, preferLive)}
      onSelectChapter={(id) => setSelectedChapterId(id)}
      onAttach={(id) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (chapter) void attachAudio(chapter);
      }}
      onProof={async (id, options) => {
        const chapter = project.chapters.find((item) => item.id === id);
        return chapter ? runProof(chapter, options) : false;
      }}
      onSelectReviewRecording={async (id, sourceKind) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (!chapter) return false;
        setReviewSourceKind(sourceKind);
        return runProof(chapter, { preferLive: sourceKind === "live" });
      }}
      onCheckAudio={(id) => {
        const chapter = project.chapters.find((item) => item.id === id);
        if (chapter) void runAcxCheck(chapter);
      }}
      onReview={() => {
        setTeleprompterMode(false);
        setActivePanel("review");
        persistPromptPreferences();
      }}
      onClose={() => {
        setTeleprompterMode(false);
        persistPromptPreferences();
      }}
      onFileLivePickup={(pickup) => void fileLivePickup(pickup)}
      onIgnoreLivePickup={(pickupId) => void ignoreLivePickup(pickupId)}
      onSaveLiveTape={(wavBase64, chapterId, timeline) => saveLiveTape(wavBase64, chapterId, timeline)}
      onLiveTapeSaved={(result, chapterId, timeline) => finishLiveTape(result, chapterId, timeline)}
      liveTapeContext={{ folder, project }}
    />
  ) : null;

  const punchBounds = punchPickup ? pickupLineBounds(punchPickup) : null;
  const performancePickup = punchPickup?.intent === "performance";
  const pickupSelectionLabel = punchPickup?.selection_kind === "paragraph"
    ? "paragraph"
    : punchPickup?.selection_kind === "sentence"
      ? "sentence"
      : punchPickup?.selection_kind === "selection"
        ? "selection"
        : "line";
  const pickupSessionTotalTasks = pickupSession
    ? pickupSession.completedTasks + pickupSession.items.length
    : 0;

  function closePickupSession(): void {
    setPunchPickup(null);
    setPickupSession(null);
  }

  function skipPickupSessionItem(): void {
    if (!pickupSession) {
      return;
    }
    const [, ...rest] = pickupSession.items;
    if (rest.length === 0) {
      closePickupSession();
      setNotice("Pickup session ended. The skipped review point was not changed.");
      return;
    }
    const next = { ...pickupSession, items: rest };
    setPickupSession(next);
    setPunchPickup(next.items[0].pickup);
    setNotice("Skipped for this session. Nothing was changed.");
  }

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
        <AppUpdateNotice status={updateStatus} hidden={teleprompterOpen} />
        <audio ref={pickupListenRef} preload="metadata" hidden />

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
                pronunciationEntries={project.glossary ?? []}
                busyAction={busyAction}
                audioUrl={reviewAudioUrl ?? audioUrl}
                audioRef={audioRef}
                proof={proof}
                modelAvailable={modelAvailable}
                modelProgress={modelProgress}
                onDownloadModel={() => void downloadWhisperModel()}
                onProof={() => void runProof(selectedChapter, { preferLive: reviewAudioSource?.kind === "live" })}
                onFinalProof={() => {
                  setReviewSourceKind("take");
                  void runProof(selectedChapter);
                }}
                reviewSourceKind={reviewAudioSource?.kind ?? null}
                checkedSourceKind={checkedSourceKind}
                onReviewSourceKind={(sourceKind) => {
                  setReviewSourceKind(sourceKind);
                  void runProof(selectedChapter, { preferLive: sourceKind === "live" });
                }}
                onAttach={() => void attachAudio(selectedChapter)}
                onOpenBooth={() => {
                  setTeleprompterMode(true);
                }}
                onPlayPickup={playPickup}
                listenDisabledReason={(pickup) => listenDisabledReason(pickup, selectedChapter)}
                punchDisabledReason={(pickup) => punchDisabledReason(pickup, selectedChapter)}
                onPlayRange={playRange}
                onPlaySelection={(start, end) => {
                  const range = proof?.timingEngine === "whisperx"
                    ? preciseSelectedPlaybackRange(start, end)
                    : selectedPlaybackRange(start, end);
                  playRange(range.start, range.end, 0);
                }}
                onExportMarkers={() => void exportMarkers()}
                onExportReport={() => void exportProofReport()}
                onExportPacket={() => void exportPickupPacket()}
                onPunchPickup={(pickup) => void openPunchRecorder(pickup)}
                onStartPickupSession={(pickups) => void startPickupSession(pickups)}
                onUpdatePickup={(pickup, changes) => void updateProofPickup(pickup, changes)}
                onSuppressPickup={(pickup) => void suppressPickupWord(pickup)}
                pickupSeatFilter={pickupSeatFilter}
                onPickupSeatFilter={setPickupSeatFilter}
                comparisonFolder={folder}
                comparisons={pickupComparisons}
                onVerifyComparison={(id) => void verifyPunchRecording(id)}
                onUndoLatestPickup={() => void undoLatestPunch()}
                selectionOverlayOpen={Boolean(punchPickup)}
              />
            ) : (
              <MissingChapter onAdd={() => { setActivePanel("book"); setComposerOpen(true); }} />
            )
          ) : null}

          {!teleprompterOpen && activePanel === "review" ? (
            <BookPickupPanel
              summary={bookPickups}
              busyAction={busyAction}
              selectedChapterId={selectedChapterId}
              canRead={Boolean(window.boothDesk) && folder !== "(browser preview)"}
              onLoad={() => void loadBookPickups()}
              onOpen={(chapterId, start) => openOccurrence(chapterId, start)}
              onIgnoreAll={(rows) => void decideBookPickups(rows, "ignored")}
            />
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
                onExport={() => void exportDelivery()}
                onShowPack={() => void showDeliveryPack()}
                onShare={() => setActivePanel("people")}
                onPlayNoiseFloor={() => void playNoiseFloor()}
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
              onSuggestRespells={() => void fillGlossaryRespells()}
              onExportGuide={() => void exportVoiceGuide()}
              onRename={(id, spelling, respell, voiceNote) => void editGlossary(id, spelling, respell, voiceNote)}
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
              guide={glossaryEntryFor(project.glossary ?? [], scanReport?.word ?? scanWord)}
              suggestions={scanSuggestions(project.glossary ?? [])}
              busyAction={busyAction}
              onWord={setScanWord}
              onScan={() => void scanBookForWord()}
              onPickSuggestion={(candidate) => void scanBookForWord(candidate)}
              onOpenOccurrence={(chapterId, start) => openOccurrence(chapterId, start)}
              onAddToGuide={(entryWord, heard) => void addScannedWordToGuide(entryWord, heard)}
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
              chapterNote={chapterNote}
              selectedChapterId={selectedChapterId}
              busyAction={busyAction}
              onIdentityName={setIdentityName}
              onIdentityRole={setIdentityRole}
              onIdentitySeat={setIdentitySeat}
              onChapterNote={setChapterNote}
              onSaveIdentity={() => void saveLocalIdentity()}
              collabPhase={collabPhase}
              collabInvite={collabInvite}
              collabWords={collabWords}
              collabReply={collabReply}
              collabPaste={collabPaste}
              collabPeer={collabPeer}
              collabConflicts={collabConflicts}
              onCollabPaste={setCollabPaste}
              onCreateInvite={() => void createLiveInvite()}
              onJoinInvite={() => void joinLiveInvite()}
              onAcceptReply={() => void acceptLiveReply()}
              onHangUp={() => void hangUpLive()}
              onSaveNote={() => void saveNote()}
              onStatus={(status) => void changeAuthorStatus(status)}
              onSelectChapter={setSelectedChapterId}
              onMode={(mode) => void changeProjectMode(mode)}
            />
          ) : null}

          {!teleprompterOpen && activePanel === "settings" ? (
            <SettingsPanel
              settings={projectSettings}
              busyAction={busyAction}
              updateStatus={updateStatus}
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
          <section
            className="chapter-composer punch-recorder pickup-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="punch-title"
            onKeyDown={(event) => {
              if (event.key.toLowerCase() === "l" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                void playPickupPreroll(punchPickup);
              }
            }}
          >
            <header className="pickup-dialog-header">
              <div>
                <p className="phase-label">
                  {pickupSession
                    ? `Pickup ${pickupSession.completedTasks + 1} of ${pickupSessionTotalTasks}`
                    : performancePickup ? "Narrator-selected redo" : "Single pickup"}
                </p>
                <h2 id="punch-title">{performancePickup ? `Redo this ${pickupSelectionLabel}` : "Record this line"}</h2>
              </div>
              <button className="pickup-dialog-close" type="button" aria-label="Close pickup recorder" onClick={closePickupSession}>×</button>
            </header>
            {pickupSession ? (
              <div
                className="pickup-session-progress"
                aria-label={`Pickup ${pickupSession.completedTasks + 1} of ${pickupSessionTotalTasks}`}
              >
                <span style={{ width: `${pickupSessionTotalTasks > 0 ? ((pickupSession.completedTasks + 1) / pickupSessionTotalTasks) * 100 : 0}%` }} />
              </div>
            ) : null}
            {punchPickup.line_text ? (
              <p className="punch-line" lang="en">
                {punchPickup.line_text}
              </p>
            ) : (
              <p className="manager-help pickup-missing-line">
                This pickup was filed before Kosmos recorded lines, so it only knows the word
                “{punchPickup.expected}”. Read the whole sentence it sits in anyway — a word on its own
                will not match the take.
              </p>
            )}
            <div className="pickup-cue-row">
              <span>
                {performancePickup
                  ? "Give this passage the performance you want. You will hear the real edit before Apply."
                  : "Match the pace and tone. Read the full sentence."}
              </span>
              {performancePickup
                ? <strong>{punchPickup.note || `Selected ${pickupSelectionLabel}`}</strong>
                : punchPickup.expected ? <strong>Fix: “{punchPickup.expected}”</strong> : null}
            </div>
            <div className="punch-preroll">
              <button
                className="pickup-selection-listen-button"
                type="button"
                disabled={!window.boothDesk || folder === "(browser preview)"}
                onClick={() => void playPickupSelection(punchPickup)}
              >
                {performancePickup ? "Play selected words" : "Play replacement line"}
              </button>
              <button
                className="pickup-leadin-button"
                type="button"
                disabled={!window.boothDesk || folder === "(browser preview)"}
                onClick={() => void playPickupPreroll(punchPickup)}
              >
                Hear {PICKUP_PREROLL_SECONDS}s before selection (L)
              </button>
              <span>
                Source {formatTime(punchBounds?.start ?? punchPickup.t_start)}–{formatTime(punchBounds?.end ?? punchPickup.t_end)}
              </span>
            </div>
            <div className="pickup-safety-note">
              <span aria-hidden="true">✓</span>
              <strong>Original safe</strong>
              <span>Nothing changes until you choose Apply.</span>
            </div>
            <RecorderPanel
              label={`Punch at ${formatTime(punchBounds?.start ?? punchPickup.t_start)}`}
              disabled={!window.boothDesk || busyAction !== null}
              applyLabel={pickupSession ? "Apply & next" : "Apply pickup"}
              onVerify={(wav) => verifyPunchRecordingWav(wav, punchPickup)}
              onPreview={(wav) => previewPunchRecordingWav(wav, punchPickup)}
              onSave={async (wav) => {
                const result = await applyPunchRecordingWav(wav, punchPickup);
                if (!result) {
                  return;
                }
                if (pickupSession) {
                  const currentItem = pickupSession.items[0];
                  const next = advancePickupSession(pickupSession, {
                    pickupIds: currentItem.pickupIds,
                    start: result.appliedStart,
                    end: result.appliedEnd,
                    durationDelta: result.durationDelta,
                  });
                  if (next.items.length > 0) {
                    setPickupSession(next);
                    setPunchPickup(next.items[0].pickup);
                    const skipped = next.supersededFlags.length - pickupSession.supersededFlags.length;
                    setNotice(
                      `Pickup applied. Next: ${next.completedTasks + 1} of ${next.completedTasks + next.items.length}`
                      + (skipped > 0 ? ` · ${skipped} overlapping flag${skipped === 1 ? "" : "s"} covered by that line.` : "."),
                    );
                    void playPickupPreroll(next.items[0].pickup);
                  } else {
                    closePickupSession();
                    setNotice(
                      `Pickup session complete: ${next.completedTasks} line${next.completedTasks === 1 ? "" : "s"} applied. Review the edited joins below when ready.`,
                    );
                  }
                } else {
                  setPunchPickup(null);
                }
              }}
            />
            <footer className="pickup-session-footer">
              {pickupSession ? (
                <button className="pickup-footer-button" type="button" onClick={skipPickupSessionItem}>Skip this pickup</button>
              ) : null}
              <button className="pickup-footer-button quiet" type="button" onClick={closePickupSession}>
                {pickupSession ? "Exit session" : "Cancel"}
              </button>
            </footer>
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

/** Row lists are re-measured often but rarely change; avoid pointless renders. */
function sameWordRows(left: PromptWordRange[], right: PromptWordRange[]): boolean {
  return left.length === right.length
    && left.every((row, index) => row.from === right[index].from && row.to === right[index].to);
}

/** Play a PCM roll-in without routing it back through the muted mic graph. */
function playLivePunchCue(samples: Float32Array, sampleRate: number): Promise<void> {
  if (samples.length === 0) {
    return Promise.resolve();
  }
  const wav = encodeWavPcm16(samples, Math.round(sampleRate), 1);
  const bytes = new Uint8Array(wav.length);
  bytes.set(wav);
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "audio/wav" }));
  const audio = new Audio(url);
  return new Promise((resolve, reject) => {
    const finish = (reason?: unknown) => {
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      if (reason) {
        reject(reason);
      } else {
        resolve();
      }
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("The punch-and-roll lead-in could not play."));
    void audio.play().catch(finish);
  });
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
  checkedSourceKind,
  acxReport,
  audioUrl,
  modelAvailable,
  busyAction,
  fontSize,
  theme,
  highlight,
  onFontSize,
  onTheme,
  onHighlight,
  onPlayGlossary,
  onListenPronunciation,
  onSelectChapter,
  onAttach,
  onProof,
  onSelectReviewRecording,
  onCheckAudio,
  onReview,
  onClose,
  onFileLivePickup,
  onIgnoreLivePickup,
  onSaveLiveTape,
  onLiveTapeSaved,
  liveTapeContext,
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
  checkedSourceKind: ProofSourceKind | null;
  acxReport: AcxReport | null;
  audioUrl: string | null;
  modelAvailable: boolean | null;
  busyAction: string | null;
  fontSize: number;
  theme: PromptTheme;
  highlight: PromptHighlightMode;
  onFontSize: (value: number) => void;
  onTheme: (value: PromptTheme) => void;
  onHighlight: (value: PromptHighlightMode) => void;
  onPlayGlossary: (entry: GlossaryEntry) => void;
  onListenPronunciation: (check: PronunciationCheck, preferLive: boolean) => void;
  onSelectChapter: (id: string) => void;
  onAttach: (chapterId: string) => void;
  onProof: (chapterId: string, options?: { preferLive?: boolean }) => Promise<boolean>;
  onSelectReviewRecording: (chapterId: string, sourceKind: ProofSourceKind) => Promise<boolean>;
  onCheckAudio: (chapterId: string) => void;
  onReview: () => void;
  onClose: () => void;
  onFileLivePickup: (pickup: Pickup) => void;
  onIgnoreLivePickup: (pickupId: string) => void;
  onSaveLiveTape: (wavBase64: string, chapterId: string, timeline: TranscriptWord[]) => Promise<void>;
  onLiveTapeSaved: (
    result: { folder: string; project: import("../core/project/types").ProjectFile },
    chapterId: string,
    timeline: TranscriptWord[],
  ) => Promise<void>;
  liveTapeContext: { folder: string; project: import("../core/project/types").ProjectFile };
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => buildPromptLines(spans), [spans]);
  const expectedWords = useMemo<LiveExpectedWord[]>(() => {
    let index = 0;
    return lines.flatMap((line) => {
      const words = promptTextTokens(line.text).filter((token) => token.isWord).map((token) => token.text);
      // Sentence ends travel with the words so a flag raised mid-read knows
      // which line it belongs to. Nothing downstream can recover that: a
      // pickup in Review has word text and timestamps but not the page.
      const ends = promptSentenceEnds(line.text);
      return words.map((text, offset) => ({
        index: index++,
        lineIndex: line.index,
        text,
        endsSentence: ends[offset] === true,
      }));
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
  const [liveStatus, setLiveStatus] = useState<LiveVoiceStatus>("off");
  const [livePaused, setLivePaused] = useState(false);
  const [livePauseChanging, setLivePauseChanging] = useState(false);
  const [liveFlag, setLiveFlag] = useState<LiveMismatch | null>(null);
  const [liveHalt, setLiveHalt] = useState<LiveMismatch | null>(null);
  const [stopOnMismatch, setStopOnMismatch] = useState(true);
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
  const [liveInputQuality, setLiveInputQuality] = useState<LiveInputQuality>(createInputQuality);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState(() => {
    try {
      return window.localStorage.getItem("booth-desk:microphone-device") ?? "";
    } catch {
      return "";
    }
  });
  const [livePunchRollStatus, setLivePunchRollStatus] = useState<"idle" | "cueing" | "counting" | "restarting">("idle");
  const [liveBoothNotice, setLiveBoothNotice] = useState<string | null>(null);
  const [replaceReadConfirmationOpen, setReplaceReadConfirmationOpen] = useState(false);
  const [reviewRecordingChooserOpen, setReviewRecordingChooserOpen] = useState(false);
  const [reviewSelectionBusy, setReviewSelectionBusy] = useState<ProofSourceKind | null>(null);
  // The booth tape for this chapter, so a narrator can hear back what they just
  // read without leaving the booth for Review. `tapeTake` counts the reads
  // recorded since this chapter was opened: zero means the tape on disk is from
  // an earlier sitting, and each bump is a new recording of the same file.
  const [tapeUrl, setTapeUrl] = useState<string | null>(null);
  const [tapeSeconds, setTapeSeconds] = useState<number | null>(null);
  const [tapeTake, setTapeTake] = useState(0);
  const [pendingDraft, setPendingDraft] = useState<{
    folder: string;
    path: string;
    chapterId: string;
    timeline: TranscriptWord[];
    resumeCursor: number;
  } | null>(null);
  const [pendingDraftUrl, setPendingDraftUrl] = useState<string | null>(null);
  const [pendingDraftSeconds, setPendingDraftSeconds] = useState<number | null>(null);
  const [pendingDraftName, setPendingDraftName] = useState("");
  const [pendingDraftSaving, setPendingDraftSaving] = useState(false);
  const [pronunciationBriefingOpen, setPronunciationBriefingOpen] = useState(false);
  const [pronunciationCheckState, setPronunciationCheckState] = useState<"idle" | "running" | "ready" | "failed">("idle");
  const [pronunciationCheckSource, setPronunciationCheckSource] = useState<"live" | "take" | null>(null);
  const [upcomingPronunciation, setUpcomingPronunciation] = useState<{
    cue: PromptPronunciationCue;
    entry: GlossaryEntry;
    rowsAhead: number;
  } | null>(null);
  const [glossaryHint, setGlossaryHint] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [materialsTab, setMaterialsTab] = useState<"chapter" | "manuscript" | "voices" | "words" | "notes">("chapter");
  const [chapterFilter, setChapterFilter] = useState("");
  const [chaptersOpen, setChaptersOpen] = useState(() => initialTeleprompterPanels(chapters.length).chaptersOpen);
  const [materialsOpen, setMaterialsOpen] = useState(() => initialTeleprompterPanels(chapters.length).materialsOpen);
  const [mode, setMode] = useState<"narrate" | "proof">("narrate");
  const [readingFont, setReadingFont] = useState<"serif" | "sans" | "hyperlegible">("serif");
  const [lineSpacing, setLineSpacing] = useState(1.8);
  const [progress, setProgress] = useState(0);
  const [savedResumeCursor, setSavedResumeCursor] = useState<number | null>(null);
  // Visual rows of the paragraph being read, for line-by-line highlighting.
  const [wordRows, setWordRows] = useState<PromptWordRange[]>([]);
  // Bumped whenever anything that could rewrap the text changes, so measured
  // rows are discarded rather than banding the wrong words.
  const [wrapEpoch, setWrapEpoch] = useState(0);
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
  const pronunciationCues = useMemo<PromptPronunciationCue[]>(() => {
    let wordIndex = 0;
    return lines.flatMap((line) => line.segments.flatMap((segment) => {
      const start = wordIndex;
      const count = promptWordCount(segment.text);
      wordIndex += count;
      return segment.glossary_id && count > 0
        ? [{ entryId: segment.glossary_id, wordIndex: start, lineIndex: line.index }]
        : [];
    }));
  }, [lines]);
  const briefingGlossary = useMemo(() => {
    const byId = new Map(chapterGlossary.map((entry) => [entry.id, entry]));
    const seen = new Set<string>();
    const ordered = pronunciationCues.flatMap((cue) => {
      const entry = byId.get(cue.entryId);
      if (!entry || seen.has(entry.id)) {
        return [];
      }
      seen.add(entry.id);
      return [entry];
    });
    return [...ordered, ...chapterGlossary.filter((entry) => !seen.has(entry.id))];
  }, [chapterGlossary, pronunciationCues]);
  const chapterManuscript = useMemo(() => spans.map((span) => span.text).join(""), [spans]);
  const savedReadCoverage = useMemo(
    () => checkedSourceKind === "live" && proof
      ? recordedManuscriptCoverage(chapterManuscript, proof.transcript)
      : progress,
    [chapterManuscript, checkedSourceKind, progress, proof],
  );
  const pronunciationChecks = useMemo(
    () => proof
      ? checkChapterPronunciations({
          chapterId,
          chapterIndex: chapter.index,
          chapterTitle: title,
          manuscript: chapterManuscript,
          transcript: proof.transcript,
          entries: chapterGlossary,
        })
      : [],
    [chapter.index, chapterGlossary, chapterId, chapterManuscript, proof, title],
  );
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
  const savedResumeKey = `booth-desk:teleprompter-resume:${chapterId}`;
  const lineRefs = useRef(new Map<number, HTMLParagraphElement>());
  const wordRefs = useRef(new Map<number, HTMLSpanElement>());
  const positionRestoreRef = useRef(false);
  const savedResumeCursorRef = useRef<number | null>(null);
  const liveStateRef = useRef(liveState);
  const liveEnabledRef = useRef(false);
  const livePausedRef = useRef(false);
  const livePauseChangingRef = useRef(false);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveContextRef = useRef<AudioContext | null>(null);
  const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveGainRef = useRef<GainNode | null>(null);
  const liveTapRef = useRef<LiveTap | null>(null);
  const liveSamplesRef = useRef<Float32Array[]>([]);
  const liveTapeRef = useRef<Float32Array[]>([]);
  const liveTapeSampleCountRef = useRef(0);
  const liveTapeBaseSecondsRef = useRef(0);
  const liveTapeChapterIdRef = useRef(chapterId);
  const onSaveLiveTapeRef = useRef(onSaveLiveTape);
  const onLiveTapeSavedRef = useRef(onLiveTapeSaved);
  const liveTapeContextRef = useRef(liveTapeContext);
  const liveSampleCountRef = useRef(0);
  const liveSampleRateRef = useRef(48_000);
  const liveCapturedSecondsRef = useRef(0);
  const liveBufferStartSecondsRef = useRef(0);
  const liveRequestRef = useRef(false);
  const liveMatchStateRef = useRef<LiveMatchState>({ cursor: 0, lastHeardEnd: 0 });
  const liveManuscriptTimelineRef = useRef<Map<number, TranscriptWord>>(new Map());
  const livePriorTimelineRef = useRef<TranscriptWord[]>([]);
  // The word the read stopped on, read by the capture callbacks that run
  // outside React's render. Null whenever the page is free to move.
  const liveHaltRef = useRef<LiveMismatch | null>(null);
  const liveHaltResumeIndexRef = useRef(-1);
  const stopOnMismatchRef = useRef(stopOnMismatch);
  const liveDismissedRef = useRef<string[]>([]);
  const liveStartingRef = useRef(false);
  const startFromBeginningRef = useRef(false);
  const resumeExistingRef = useRef(false);
  const liveMeterUpdateRef = useRef(0);
  const liveInputQualityRef = useRef<LiveInputQuality>(createInputQuality());
  const liveSessionRef = useRef(0);
  const automaticPronunciationTakeRef = useRef("");
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
  const liveLeadRef = useRef<LeadState>(createLeadState(0, 0));
  // Seconds of audio handed to the follow model. Word timestamps are
  // stream-relative, so this doubles as the clock for measuring follow lag.
  const liveStreamSecondsRef = useRef(0);
  // A restarted streaming recognizer reports a fresh zero-based clock. Add the
  // retained booth-tape duration so its words stay on the recording timeline.
  const liveStreamClockOffsetRef = useRef(0);
  const livePunchBusyRef = useRef(false);
  /**
   * Granularity, for the follow loop that runs outside React's render.
   *
   * The predictive lead only applies to word-by-word reading. At line and
   * paragraph granularity a one-word projection can cross a boundary and light
   * the *next* line before the narrator has finished the current one, which is a
   * far bigger error than a single word being early. The wider modes also absorb
   * the model's delay on their own — a ten-word line is only briefly wrong at
   * its edges — so they read confirmed positions only and never guess ahead.
   */
  const liveHighlightModeRef = useRef<PromptHighlightMode>(highlight);
  // Clock reading when speech was last heard. The predictive lead only coasts
  // while this is recent, so a pause cannot carry the highlight past the last
  // word the narrator actually read.
  const liveSpeechAtRef = useRef<number | null>(null);
  const expectedWordsRef = useRef<LiveExpectedWord[]>([]);
  const chapterIdRef = useRef(chapterId);

  useEffect(() => {
    expectedWordsRef.current = expectedWords;
  }, [expectedWords]);

  useEffect(() => {
    liveHighlightModeRef.current = highlight;
  }, [highlight]);

  useEffect(() => {
    chapterIdRef.current = chapterId;
  }, [chapterId]);

  useEffect(() => {
    onSaveLiveTapeRef.current = onSaveLiveTape;
  }, [onSaveLiveTape]);

  useEffect(() => {
    onLiveTapeSavedRef.current = onLiveTapeSaved;
  }, [onLiveTapeSaved]);

  useEffect(() => {
    liveTapeContextRef.current = liveTapeContext;
  }, [liveTapeContext]);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  async function refreshMicrophoneList() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === "audioinput" && device.deviceId));
    } catch {
      // Device labels are a convenience; Start narrating still requests the
      // system default when enumeration is restricted.
    }
  }

  function chooseMicrophone(deviceId: string) {
    setSelectedInputId(deviceId);
    try {
      if (deviceId) {
        window.localStorage.setItem("booth-desk:microphone-device", deviceId);
      } else {
        window.localStorage.removeItem("booth-desk:microphone-device");
      }
    } catch {
      // A private window can reject storage without blocking microphone use.
    }
  }

  useEffect(() => {
    void refreshMicrophoneList();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return;
    }
    const refresh = () => { void refreshMicrophoneList(); };
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  useEffect(() => {
    stopOnMismatchRef.current = stopOnMismatch;
    if (!stopOnMismatch) {
      resumeFromHalt();
    }
  }, [stopOnMismatch]);

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

  useEffect(() => {
    let saved: number | null = null;
    try {
      const raw = window.localStorage.getItem(savedResumeKey);
      const candidate = raw === null ? Number.NaN : Number(raw);
      saved = Number.isFinite(candidate) && candidate >= 0
        ? Math.min(expectedWords.length, Math.floor(candidate))
        : null;
    } catch {
      saved = null;
    }
    savedResumeCursorRef.current = saved;
    setSavedResumeCursor(saved);
  }, [expectedWords.length, savedResumeKey]);

  function rememberResumeCursor(cursor: number) {
    const safe = Math.min(expectedWordsRef.current.length, Math.max(0, Math.floor(cursor)));
    savedResumeCursorRef.current = safe;
    setSavedResumeCursor(safe);
    try {
      window.localStorage.setItem(savedResumeKey, String(safe));
    } catch {
      // The current page remains the fallback when local storage is unavailable.
    }
  }

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

  const liveWordIndex = liveHighlightWordIndex(liveCursor, liveState.enabled);
  const liveLineIndex = liveWordIndex >= 0 ? expectedWords[liveWordIndex]?.lineIndex : undefined;
  const liveLineWordCount = liveLineIndex === undefined
    ? 0
    : promptWordCount(lines[liveLineIndex]?.text ?? "");

  // Where the browser wrapped the current paragraph. Only that paragraph is
  // measured, and only when the reader moves to a new one, so line-by-line
  // highlighting costs one layout read per paragraph rather than per word.
  useEffect(() => {
    if (highlight !== "line" || liveLineIndex === undefined || liveLineWordCount === 0) {
      expectedWordsRef.current = expectedWords;
      setWordRows((rows) => (rows.length === 0 ? rows : []));
      return;
    }
    const firstWord = lineWordStarts.get(liveLineIndex);
    if (firstWord === undefined) {
      return;
    }
    const tops: Array<number | null> = [];
    for (let offset = 0; offset < liveLineWordCount; offset += 1) {
      const node = wordRefs.current.get(firstWord + offset);
      tops.push(node ? node.getBoundingClientRect().top : null);
    }
    const measured = promptWordRows(firstWord, tops);
    // The matcher runs outside React's render loop. Give it the exact wrapped
    // rows the narrator sees, so skipping a screen line inside a long prose
    // paragraph cannot be mistaken for a harmless within-line resync.
    expectedWordsRef.current = applyLiveVisualRows(expectedWords, measured);
    setWordRows((rows) => (sameWordRows(rows, measured) ? rows : measured));
  }, [expectedWords, highlight, liveLineIndex, liveLineWordCount, lineWordStarts, fontSize, lineSpacing, readingFont, wrapEpoch]);

  // Resizing the window or the side rails rewraps the text, which moves every
  // row boundary. Re-measure rather than band words that have moved.
  useEffect(() => {
    if (highlight !== "line") {
      return;
    }
    const onResize = () => setWrapEpoch((epoch) => epoch + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [highlight]);

  useEffect(() => {
    setWrapEpoch((epoch) => epoch + 1);
  }, [chaptersOpen, materialsOpen, spans]);

  useEffect(() => {
    if (!liveState.enabled) {
      setUpcomingPronunciation(null);
      return;
    }
    const tops = expectedWords.map((word) => wordRefs.current.get(word.index)?.getBoundingClientRect().top ?? null);
    const measured = nextPronunciationCueByRows(pronunciationCues, liveCursor, tops);
    if (!measured) {
      setUpcomingPronunciation(null);
      return;
    }
    const entry = chapterGlossary.find((candidate) => candidate.id === measured.cue.entryId);
    setUpcomingPronunciation(entry ? { ...measured, entry } : null);
  }, [
    chapterGlossary,
    chaptersOpen,
    expectedWords,
    fontSize,
    lineSpacing,
    liveCursor,
    liveState.enabled,
    materialsOpen,
    pronunciationCues,
    readingFont,
    wrapEpoch,
  ]);

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
    const limit = expectedWordsRef.current.length || expectedWords.length;
    const safeNext = Math.min(limit, Math.max(0, Math.floor(nextCursor)));
    liveLeadRef.current = leadOnConfirm(liveLeadRef.current, safeNext, performance.now());
    publishLiveCursor();
    // Whisper QC is deliberately delayed behind the follow cursor. Do not
    // erase a flag just because Parakeet advanced while that QC request was
    // in flight; the flag is tied to the frozen audio/gold checkpoint passed
    // to liveBackFlag and remains actionable until the narrator decides it.
  }

  /**
   * Stop the page on a word the narrator did not read as written. The cursor is
   * already pinned there by the matcher; this settles the predictive lead onto
   * the same word so the highlight cannot coast past the place they must
   * restart from.
   */
  function haltLiveFollow(halt: LiveMismatch) {
    liveHaltRef.current = halt;
    setLiveHalt(halt);
    liveLeadRef.current = createLeadState(halt.expectedIndex, performance.now());
    liveVisualCursorRef.current = halt.expectedIndex;
    setLiveCursor(halt.expectedIndex);
  }

  /**
   * Carry on from a stop. Everything heard while the page was held is dropped:
   * that audio is the narrator thinking, re-reading, or talking to the room,
   * and grading it against the word they are about to leave would stop them
   * again immediately. The run of misses that caused the stop goes with it, or
   * the next miss would be the fourth of a run the narrator has already dealt
   * with. The word itself is exempted from starting another run, so both ways
   * of continuing work — read the line again, or read straight on and let the
   * ordinary resync rejoin.
   */
  function resumeFromHalt() {
    const halted = liveHaltRef.current;
    if (!halted) {
      return;
    }
    liveHaltRef.current = null;
    liveHaltResumeIndexRef.current = halted.expectedIndex;
    setLiveHalt(null);
    // Rebuilt rather than spread, so the run and any pending resync go too.
    liveMatchStateRef.current = {
      cursor: liveMatchStateRef.current.cursor,
      lastHeardEnd: Math.max(
        liveMatchStateRef.current.lastHeardEnd,
        liveStreamSecondsRef.current,
        liveCapturedSecondsRef.current,
      ),
      recentHeard: [],
    };
    liveLeadRef.current = createLeadState(liveMatchStateRef.current.cursor, performance.now());
    liveSpeechAtRef.current = null;
    publishLiveCursor();
  }

  function currentLiveConfirmations(): LiveWordConfirmation[] {
    return [...liveManuscriptTimelineRef.current.entries()].map(([expectedIndex, word]) => ({
      expectedIndex,
      start: word.start,
      end: word.end,
      confidence: word.confidence ?? 0,
    }));
  }

  /** Place a hands-free review marker on the last word with a recording clock. */
  function markCurrentRead() {
    if (!liveEnabledRef.current || livePausedRef.current) {
      return;
    }
    const pickup = manualLivePickup({
      chapterId: chapterIdRef.current,
      expected: expectedWordsRef.current,
      confirmations: currentLiveConfirmations(),
      cursor: liveMatchStateRef.current.cursor,
    });
    if (!pickup) {
      setLiveBoothNotice("Read a few words before placing a marker.");
      return;
    }
    onFileLivePickup(pickup);
    setLiveBoothNotice(`Marked “${pickup.expected}” for Review.`);
  }

  /**
   * Replace the current sentence inside the active booth tape.
   *
   * The microphone is muted during the roll-in. Once the cue reaches the
   * sentence boundary, both tape owners and the recognizer are rewound to the
   * same clock before capture resumes, so the false start never reaches the
   * saved read.
   */
  async function restartSentenceWithPreroll() {
    if (
      livePunchBusyRef.current
      || !liveEnabledRef.current
      || livePausedRef.current
      || liveStoppingRef.current
    ) {
      return;
    }
    const context = liveContextRef.current;
    const stream = liveStreamRef.current;
    const bridge = window.boothDesk;
    if (!context || !stream || !bridge?.restartLiveTranscription) {
      setLiveError("Punch-and-roll is available while a desktop booth recording is active.");
      return;
    }
    const plan = planLivePunchRoll(
      expectedWordsRef.current,
      currentLiveConfirmations(),
      liveHaltRef.current?.expectedIndex ?? liveMatchStateRef.current.cursor,
      PICKUP_PREROLL_SECONDS,
    );
    if (!plan) {
      setLiveError("Read a little farther before restarting so Kosmos has a clean recorded boundary.");
      return;
    }
    const cue = buildLivePunchCue(
      liveTapeRef.current,
      liveSampleRateRef.current,
      Math.max(0, plan.cueFromSeconds - liveTapeBaseSecondsRef.current),
      Math.max(0, plan.punchAtSeconds - liveTapeBaseSecondsRef.current),
    );
    const tracks = stream.getAudioTracks();
    livePunchBusyRef.current = true;
    livePausedRef.current = true;
    setLivePaused(true);
    setLivePunchRollStatus(cue.kind === "recorded" ? "cueing" : "counting");
    setLiveStatus("paused");
    tracks.forEach((track) => { track.enabled = false; });
    try {
      await context.suspend();
      await playLivePunchCue(cue.samples, liveSampleRateRef.current);
      setLivePunchRollStatus("restarting");
      liveSessionRef.current += 1;
      const restarted = await bridge.restartLiveTranscription({
        truncateToSeconds: plan.punchAtSeconds,
      });
      const punchAtSeconds = restarted.truncatedToSeconds;

      liveTapeRef.current = truncateLiveTape(
        liveTapeRef.current,
        liveSampleRateRef.current,
        Math.max(0, punchAtSeconds - liveTapeBaseSecondsRef.current),
      );
      liveTapeSampleCountRef.current = liveTapeRef.current.reduce((total, chunk) => total + chunk.length, 0);
      liveSamplesRef.current = [];
      liveSampleCountRef.current = 0;
      liveCapturedSecondsRef.current = punchAtSeconds;
      liveBufferStartSecondsRef.current = punchAtSeconds;
      liveStreamSecondsRef.current = punchAtSeconds;
      liveStreamClockOffsetRef.current = punchAtSeconds;
      liveSentRef.current = false;
      liveRequestRef.current = false;
      liveFollowStreamRef.current = Boolean(restarted.streaming);
      liveQcBufferRef.current = createLiveQcBuffer();
      liveWhisperPromiseRef.current = null;
      liveFollowPromiseRef.current = null;
      liveWhisperBusyRef.current = false;

      for (const [expectedIndex, word] of liveManuscriptTimelineRef.current) {
        if (expectedIndex >= plan.restartIndex || word.start >= punchAtSeconds) {
          liveManuscriptTimelineRef.current.delete(expectedIndex);
        }
      }
      const replacedFlags = liveDetectedFlags.filter((flag) => flag.expectedIndex >= plan.restartIndex);
      replacedFlags.forEach((flag) => onIgnoreLivePickup(flag.id));
      setLiveDetectedFlags((flags) => flags.filter((flag) => flag.expectedIndex < plan.restartIndex));
      setLiveFlag(null);
      liveHaltRef.current = null;
      liveHaltResumeIndexRef.current = -1;
      setLiveHalt(null);
      liveMatchStateRef.current = {
        cursor: plan.restartIndex,
        lastHeardEnd: punchAtSeconds,
        recentHeard: [],
      };
      liveLeadRef.current = createLeadState(plan.restartIndex, performance.now());
      liveVisualCursorRef.current = plan.restartIndex;
      setLiveCursor(plan.restartIndex);
      setLiveHeardText("");
      setLiveBoothNotice(cue.kind === "recorded"
        ? "Sentence replaced. Recording from the restart point."
        : "No earlier voice was recorded in this session, so Kosmos counted you in. Recording from the restart point.");
      setLiveError(null);
    } catch (reason) {
      setLiveError(messageFor(reason, "Could not restart this sentence. The existing booth tape was kept."));
    } finally {
      try {
        await context.resume();
      } catch {
        // The ordinary microphone state below reports a disconnected context.
      }
      tracks.forEach((track) => { track.enabled = true; });
      livePausedRef.current = false;
      setLivePaused(false);
      livePunchBusyRef.current = false;
      setLivePunchRollStatus("idle");
      if (liveEnabledRef.current && !liveStoppingRef.current) {
        setLiveStatus("listening");
      }
    }
  }

  /**
   * Publish the cursor the narrator should see. On the streaming path this
   * coasts ahead of the last confirmed word at the narrator's measured pace,
   * which covers the follow model's emission delay — but only while speech is
   * still arriving, so stopping settles the highlight back onto the last word
   * actually read. The slower Whisper-only fallback shows confirmed positions
   * only, so it cannot outrun its evidence, and so do the line and paragraph
   * modes. A stopped page projects nothing at all: the narrator has to be able
   * to see which word to restart on.
   */
  function publishLiveCursor() {
    const halted = liveHaltRef.current;
    if (halted) {
      if (liveVisualCursorRef.current !== halted.expectedIndex) {
        liveVisualCursorRef.current = halted.expectedIndex;
        setLiveCursor(halted.expectedIndex);
      }
      return;
    }
    if (livePausedRef.current) {
      return;
    }
    const limit = expectedWordsRef.current.length || expectedWords.length;
    const advanced = leadAdvance(
      liveLeadRef.current,
      performance.now(),
      limit,
      liveFollowStreamRef.current && liveHighlightModeRef.current === "word",
      liveSpeechAtRef.current,
    );
    liveLeadRef.current = advanced.state;
    if (advanced.cursor === liveVisualCursorRef.current) {
      return;
    }
    liveVisualCursorRef.current = advanced.cursor;
    setLiveCursor(advanced.cursor);
  }

  function disconnectLiveInput() {
    liveTapRef.current?.close();
    liveProcessorRef.current?.disconnect();
    liveSourceRef.current?.disconnect();
    liveGainRef.current?.disconnect();
    liveTapRef.current = null;
    liveProcessorRef.current = null;
    liveSourceRef.current = null;
    liveGainRef.current = null;
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    void liveContextRef.current?.close();
    liveContextRef.current = null;
  }

  function resetLiveCaptureState() {
    livePausedRef.current = false;
    livePauseChangingRef.current = false;
    setLivePaused(false);
    setLivePauseChanging(false);
    liveSamplesRef.current = [];
    liveSampleCountRef.current = 0;
    liveCapturedSecondsRef.current = 0;
    liveBufferStartSecondsRef.current = 0;
    liveSentRef.current = false;
    liveFollowStreamRef.current = false;
    liveWhisperBusyRef.current = false;
    liveSpeechAtRef.current = null;
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
    liveStreamSecondsRef.current = 0;
    liveStreamClockOffsetRef.current = 0;
    liveTapeBaseSecondsRef.current = 0;
    livePriorTimelineRef.current = [];
    livePunchBusyRef.current = false;
    setLivePunchRollStatus("idle");
    setLiveBoothNotice(null);
    liveLeadRef.current = createLeadState(liveCursor, performance.now());
    liveHaltRef.current = null;
    liveHaltResumeIndexRef.current = -1;
    setLiveHalt(null);
    setLiveSignalLevel(0);
    liveInputQualityRef.current = createInputQuality();
    setLiveInputQuality(liveInputQualityRef.current);
    setLiveStatus("off");
  }

  function takeLiveTape() {
    const tape = {
      chunks: liveTapeRef.current,
      sampleRate: liveSampleRateRef.current,
      chapterId: liveTapeChapterIdRef.current,
      baseSeconds: liveTapeBaseSecondsRef.current,
    };
    liveTapeRef.current = [];
    liveTapeSampleCountRef.current = 0;
    liveTapeBaseSecondsRef.current = 0;
    return tape;
  }

  /**
   * Offer a freshly written tape back for playback, but only when it belongs to
   * the chapter on screen. Leaving mid-read saves the chapter that was being
   * read, which by then is not the one being shown.
   */
  function markTapeRecorded(tapeChapterId: string, resumeCursor: number) {
    if (tapeChapterId === chapterIdRef.current) {
      setTapeTake((take) => take + 1);
      rememberResumeCursor(resumeCursor);
    }
  }

  async function offerStoppedDraft(
    stopped: { folder?: string; draft_audio_path?: string; tapeError?: string } | undefined,
    tape: { chapterId: string },
    timeline: TranscriptWord[],
    resumeCursor: number,
  ): Promise<boolean> {
    if (!stopped?.folder || !stopped.draft_audio_path) return false;
    const draft = {
      folder: stopped.folder,
      path: stopped.draft_audio_path,
      chapterId: tape.chapterId,
      timeline,
      resumeCursor,
    };
    setPendingDraft(draft);
    setPendingDraftName(`${title} — Take ${tapeTake + 1}`);
    setPendingDraftUrl(null);
    setPendingDraftSeconds(null);
    try {
      const bridge = window.boothDesk;
      if (bridge) {
        const [url, metadata] = await Promise.all([
          bridge.audioUrl({ folder: draft.folder, relativePath: draft.path }),
          bridge.audioMetadata({ folder: draft.folder, relativePath: draft.path }),
        ]);
        setPendingDraftUrl(url);
        setPendingDraftSeconds(metadata.durationSeconds);
      }
    } catch {
      setLiveError("The draft was captured, but its audio preview could not be loaded.");
    }
    return true;
  }

  async function savePendingDraft() {
    const draft = pendingDraft;
    const name = pendingDraftName.trim();
    const bridge = window.boothDesk;
    if (!draft || !bridge || pendingDraftSaving) return;
    if (!name) {
      setLiveError("Give this recording a name before saving it.");
      return;
    }
    setPendingDraftSaving(true);
    setLiveError(null);
    try {
      const result = await bridge.saveLiveDraft({
        folder: draft.folder,
        project: liveTapeContext.project,
        chapterId: draft.chapterId,
        draftPath: draft.path,
        name,
      });
      markTapeRecorded(draft.chapterId, draft.resumeCursor);
      await onLiveTapeSavedRef.current({ folder: result.folder, project: result.project }, draft.chapterId, draft.timeline);
      setPendingDraft(null);
      setPendingDraftUrl(null);
      setPendingDraftSeconds(null);
      setLiveBoothNotice(`Saved “${name}”. Choose Continue recording or Review.`);
    } catch (reason) {
      setLiveError(messageFor(reason, "Could not save this recording."));
    } finally {
      setPendingDraftSaving(false);
    }
  }

  async function discardPendingDraft() {
    const draft = pendingDraft;
    if (!draft || pendingDraftSaving) return;
    try {
      await window.boothDesk?.discardLiveDraft({ folder: draft.folder, chapterId: draft.chapterId, draftPath: draft.path });
      setPendingDraft(null);
      setPendingDraftUrl(null);
      setPendingDraftSeconds(null);
      setLiveBoothNotice("Draft discarded. Your previously saved recording was not changed.");
    } catch (reason) {
      setLiveError(messageFor(reason, "Could not discard this draft."));
    }
  }

  function recordLiveConfirmations(confirmations: LiveWordConfirmation[]): void {
    const expected = expectedWordsRef.current;
    for (const confirmation of confirmations) {
      const word = expected.find((candidate) => candidate.index === confirmation.expectedIndex);
      if (!word) {
        continue;
      }
      liveManuscriptTimelineRef.current.set(confirmation.expectedIndex, {
        text: word.text,
        start: confirmation.start,
        end: confirmation.end,
        confidence: confirmation.confidence,
      });
    }
  }

  function takeLiveManuscriptTimeline(): TranscriptWord[] {
    const current = [...liveManuscriptTimelineRef.current.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, word]) => word);
    const ordered = [...livePriorTimelineRef.current, ...current]
      .sort((left, right) => left.start - right.start || left.end - right.end);
    liveManuscriptTimelineRef.current = new Map();
    livePriorTimelineRef.current = [];
    let previousStart = -1;
    let previousEnd = -1;
    return ordered.filter((word) => {
      if (word.start < previousStart || word.end < previousEnd) {
        return false;
      }
      previousStart = word.start;
      previousEnd = word.end;
      return true;
    });
  }

  /**
   * Write the captured read to disk, unless it was too short to be worth
   * keeping. Reports whether a tape landed so callers do not offer a previous
   * read back as though it were the one just finished.
   */
  async function persistTakenTape(
    tape: { chunks: Float32Array[]; sampleRate: number; chapterId: string; baseSeconds: number },
    timeline: TranscriptWord[],
  ): Promise<boolean> {
    if (tape.baseSeconds > 0) {
      throw new Error("The continued read could not be appended. The previously saved booth tape was kept unchanged.");
    }
    const samples = concatLiveTape(tape.chunks);
    if (!shouldKeepLiveTape(samples.length, tape.sampleRate)) {
      return false;
    }
    const wav = encodeWavPcm16(samples, Math.round(tape.sampleRate), 1);
    await onSaveLiveTapeRef.current(bytesToBase64(wav), tape.chapterId, timeline);
    return true;
  }

  async function stopLiveCaptureImmediately() {
    liveStoppingRef.current = true;
    const resumeCursor = liveMatchStateRef.current.cursor;
    liveSessionRef.current += 1;
    liveEnabledRef.current = false;
    disconnectLiveInput();
    const tape = takeLiveTape();
    const timeline = takeLiveManuscriptTimeline();
    const stopped = await window.boothDesk?.stopLiveTranscription?.();
    resetLiveCaptureState();
    liveStoppingRef.current = false;
    if (await offerStoppedDraft(stopped, tape, timeline, resumeCursor)) {
      return;
    }
    return persistTakenTape(tape, timeline).then((kept) => {
      if (kept) {
        markTapeRecorded(tape.chapterId, resumeCursor);
      }
    }).catch((reason) => {
      setLiveError(messageFor(reason, stopped?.tapeError || "Could not keep a booth tape of this read."));
    });
  }

  async function stopLiveCapture({ flushQc = false } = {}) {
    if (liveStoppingRef.current) {
      return;
    }
    if (!flushQc || !liveEnabledRef.current || !liveFollowStreamRef.current) {
      await stopLiveCaptureImmediately();
      return;
    }

    liveStoppingRef.current = true;
    const sessionId = liveSessionRef.current;
    const resumeCursor = liveMatchStateRef.current.cursor;
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
    const tape = takeLiveTape();
    const timeline = takeLiveManuscriptTimeline();
    const stopped = await window.boothDesk?.stopLiveTranscription?.();
    resetLiveCaptureState();
    liveStoppingRef.current = false;
    if (await offerStoppedDraft(stopped, tape, timeline, resumeCursor)) {
      return;
    }
    try {
      if (await persistTakenTape(tape, timeline)) {
        markTapeRecorded(tape.chapterId, resumeCursor);
      }
    } catch (reason) {
      setLiveError(messageFor(reason, stopped?.tapeError || "Could not keep a booth tape of this read."));
    }
  }

  useEffect(() => () => {
    if (liveCursorAnimationRef.current !== null) {
      window.clearInterval(liveCursorAnimationRef.current);
    }
    stopLiveCaptureImmediately();
  }, []);

  // The follow model reports words when it has them, not when asked. Match
  // each batch the moment it lands so the cursor is never waiting on a reply.
  useEffect(() => {
    const bridge = window.boothDesk;
    if (!bridge?.onLiveWords) {
      return;
    }
    return bridge.onLiveWords(({ words }) => {
      if (!liveEnabledRef.current || livePausedRef.current || !liveFollowStreamRef.current || liveStoppingRef.current) {
        return;
      }
      if (!Array.isArray(words) || words.length === 0) {
        return;
      }
      if (liveHaltRef.current) {
        return;
      }
      const clockOffset = liveStreamClockOffsetRef.current;
      const timedWords = clockOffset === 0 ? words : words.map((word) => ({
        ...word,
        start: word.start + clockOffset,
        end: word.end + clockOffset,
      }));
      const result = matchLiveWindow({
        chapterId: chapterIdRef.current,
        expected: expectedWordsRef.current,
        transcript: timedWords,
        state: liveMatchStateRef.current,
        flagsEnabled: false,
        confidenceThreshold: 0.9,
        dismissedIds: liveDismissedRef.current,
        haltOnMismatch: stopOnMismatchRef.current,
        haltResumeIndex: liveHaltResumeIndexRef.current,
      });
      recordLiveConfirmations(result.confirmed);
      liveMatchStateRef.current = result.state;
      commitLiveCursor(result.state.cursor);
      if (result.halt) {
        haltLiveFollow(result.halt);
      }
      setLiveCheckCount((count) => count + 1);
      setLiveHeardText(words.slice(-5).map((word) => word.text).join(" "));
      // Follow lag measured against the audio clock: how far behind the
      // narrator the newest confirmed word is. This is the number to watch.
      const heardThrough = words[words.length - 1]?.end;
      if (Number.isFinite(heardThrough)) {
        setLiveLatencyMs(Math.max(0, Math.round((liveStreamSecondsRef.current - heardThrough) * 1000)));
      }
      setLiveStatus("listening");
      setLiveError(null);
    });
  }, []);

  // Coast the highlight forward between confirmations. Only republishes when
  // the whole-word position changes, so this stays cheap.
  useEffect(() => {
    if (!liveState.enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!liveEnabledRef.current || livePausedRef.current || !liveFollowStreamRef.current || liveStoppingRef.current) {
        return;
      }
      publishLiveCursor();
    }, 50);
    return () => window.clearInterval(timer);
  }, [liveState.enabled]);

  /**
   * Resolve the booth tape for playback whenever one appears, which is the
   * moment Stop finishes writing it. Failing quietly is deliberate: a tape that
   * will not load is not worth an error in front of a narrator mid-session, and
   * Review can still transcribe the file.
   *
   * A chapter's tape always has the same path, so re-reading overwrites it and
   * the URL alone cannot tell the two apart — the player would keep serving the
   * previous read, with the previous length beside it. Carrying the take number
   * makes each recording its own resource.
   */
  const tapePath = chapter.live_audio_path;
  const tapeFolder = liveTapeContext.folder;
  useEffect(() => {
    let disposed = false;
    setTapeUrl(null);
    setTapeSeconds(null);
    const bridge = window.boothDesk;
    if (!tapePath || !bridge || tapeFolder === "(browser preview)") {
      return;
    }
    void (async () => {
      try {
        const url = await bridge.audioUrl({ folder: tapeFolder, relativePath: tapePath });
        if (disposed) {
          return;
        }
        setTapeUrl(tapeTake > 0 ? `${url}?take=${tapeTake}` : url);
        const metadata = await bridge.audioMetadata({ folder: tapeFolder, relativePath: tapePath });
        if (!disposed) {
          setTapeSeconds(metadata.durationSeconds);
        }
      } catch {
        // Leaves the panel away rather than interrupting the read.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [tapePath, tapeFolder, tapeTake]);

  // A finished booth read is checked without another trip through the UI. The
  // proof pass creates the time-aligned transcript used by the pronunciation
  // report; the take key prevents rerenders from transcribing the same tape
  // twice. This runs only when the chapter actually has words to check.
  useEffect(() => {
    if (tapeTake <= 0 || !tapePath || briefingGlossary.length === 0) {
      return;
    }
    const takeKey = `${chapterId}:${tapeTake}`;
    if (automaticPronunciationTakeRef.current === takeKey) {
      return;
    }
    automaticPronunciationTakeRef.current = takeKey;
    setPronunciationCheckState("running");
    setPronunciationCheckSource("live");
    void onProof(chapterId, { preferLive: true }).then((checked) => {
      if (automaticPronunciationTakeRef.current === takeKey) {
        setPronunciationCheckState(checked ? "ready" : "failed");
      }
    });
  }, [briefingGlossary.length, chapterId, onProof, tapePath, tapeTake]);

  useEffect(() => {
    stopLiveCaptureImmediately();
    setTapeTake(0);
    automaticPronunciationTakeRef.current = "";
    setPronunciationBriefingOpen(false);
    setReplaceReadConfirmationOpen(false);
    setReviewRecordingChooserOpen(false);
    setReviewSelectionBusy(null);
    setPronunciationCheckState("idle");
    setPronunciationCheckSource(null);
    liveMatchStateRef.current = { cursor: 0, lastHeardEnd: 0 };
    liveVisualCursorRef.current = 0;
    liveLeadRef.current = createLeadState(0, performance.now());
    liveStreamSecondsRef.current = 0;
    liveHaltRef.current = null;
    liveHaltResumeIndexRef.current = -1;
    setLiveHalt(null);
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
    if (!bridge?.transcribeBuffer || !liveEnabledRef.current || livePausedRef.current || sessionId !== liveSessionRef.current) {
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
      if (!liveEnabledRef.current || livePausedRef.current || sessionId !== liveSessionRef.current) {
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
      if (liveHaltRef.current) {
        setLiveStatus(livePausedRef.current ? "paused" : "listening");
        return;
      }
      const cursorBeforeAudio = liveMatchStateRef.current.cursor;
      // The follow model owns the cursor even on this slower path, so it is
      // also where a stop has to be decided. The Whisper back-check below runs
      // seconds behind the narrator and would stop them on a word they left
      // long ago; it stays a flag.
      const result = matchLiveWindow({
        chapterId,
        expected: expectedWordsRef.current,
        transcript: transcriptWords,
        state: liveMatchStateRef.current,
        flagsEnabled: liveFollowStreamRef.current ? false : liveStateRef.current.enabled,
        confidenceThreshold: 0.9,
        dismissedIds: liveDismissedRef.current,
        haltOnMismatch: stopOnMismatchRef.current,
        haltResumeIndex: liveHaltResumeIndexRef.current,
      });
      recordLiveConfirmations(result.confirmed);
      liveMatchStateRef.current = result.state;
      commitLiveCursor(result.state.cursor);
      if (result.halt) {
        haltLiveFollow(result.halt);
      }
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
      setLiveStatus(livePausedRef.current ? "paused" : "listening");
      setLiveError(null);
      if (liveFollowStreamRef.current) {
        queueWhisperQc(samples, sampleRate, sessionId, cursorBeforeAudio, result.state.cursor, startSeconds);
      }
    } catch (reason) {
      const message = messageFor(reason, "Live flags could not transcribe this microphone window.");
      if (/not running/i.test(message) && liveFollowStreamRef.current) {
        liveFollowStreamRef.current = false;
        setLiveStatus(livePausedRef.current ? "paused" : "listening");
        setLiveError(null);
      } else if (liveEnabledRef.current && sessionId === liveSessionRef.current) {
        setLiveStatus(livePausedRef.current ? "paused" : "listening");
      }
    } finally {
      liveRequestRef.current = false;
      if (!liveStoppingRef.current && liveEnabledRef.current && !livePausedRef.current && sessionId === liveSessionRef.current && shouldFlushLiveBuffer()) {
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
    if (livePausedRef.current || liveStateRef.current.dimmed) {
      liveQcBufferRef.current = createLiveQcBuffer();
      return;
    }
    // While the page is stopped the narrator is deciding or re-reading, and the
    // QC cursor is frozen on the word that stopped them. Grading that audio
    // would file pickups against a position they are about to leave. Audio from
    // before the stop is already buffered and still gets graded, so the slip
    // that caused the stop is not lost.
    if (!liveHaltRef.current) {
      liveQcBufferRef.current = appendLiveQcSamples(
        liveQcBufferRef.current,
        samples,
        cursorBeforeAudio,
        startSeconds,
        coveredCursor,
      );
    }
    // Encoding a QC clip is heavy and this runs from the audio callback on the
    // streaming path. Hand it to a later task so capture never waits on it.
    window.setTimeout(() => {
      if (!liveEnabledRef.current || livePausedRef.current || sessionId !== liveSessionRef.current) {
        return;
      }
      flushLiveQcWindow(sampleRate, sessionId);
    }, 0);
  }

  function flushLiveQcWindow(sampleRate: number, sessionId: number, force = false) {
    if (liveWhisperBusyRef.current || (!force && livePausedRef.current) || liveStateRef.current.dimmed) {
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
      // manuscript/test vocabulary: matchLiveWindow only uses nearby matches,
      // except for a bounded unique phrase that clearly repeats the page.
      //
      // Only when there is no streaming follow model, though. This window is
      // audio Parakeet already transcribed seconds ago, graded at a lower
      // confidence bar, so against a live stream it can only push the cursor
      // past where the narrator actually is — and one stray word here moves the
      // highlight a whole line in line and paragraph modes.
      if (!liveFollowStreamRef.current && !liveHaltRef.current) {
        const followBeforeWhisper = liveMatchStateRef.current;
        const whisperFollow = matchLiveWindow({
          chapterId,
          expected: expectedWordsRef.current,
          transcript,
          state: followBeforeWhisper,
          flagsEnabled: false,
          confidenceThreshold: 0.55,
        });
        if (whisperFollow.state.cursor > followBeforeWhisper.cursor) {
          liveMatchStateRef.current = whisperFollow.state;
          commitLiveCursor(whisperFollow.state.cursor);
        }
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

  /** Pull exactly `count` captured samples off the front of the queue. */
  function takeLiveSamples(count: number): Float32Array {
    const out = new Float32Array(count);
    let filled = 0;
    while (filled < count && liveSamplesRef.current.length > 0) {
      const head = liveSamplesRef.current[0];
      const need = count - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        liveSamplesRef.current.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        liveSamplesRef.current[0] = head.subarray(need);
        filled += need;
      }
    }
    liveSampleCountRef.current = Math.max(0, liveSampleCountRef.current - filled);
    return filled === count ? out : out.subarray(0, filled);
  }

  /**
   * Hand the follow model every whole hop that has been captured, and nothing
   * else. The helper reads fixed-size blocks, so a short or oversized write
   * leaves the remainder sitting unprocessed until more audio arrives. Words
   * come back over `onLiveWords` rather than as a reply, so a busy interface
   * can never stall audio ingest.
   */
  function pumpLiveStream() {
    const bridge = window.boothDesk;
    if (!bridge?.sendLivePcm) {
      return;
    }
    const sampleRate = liveSampleRateRef.current;
    const hopSamples = Math.max(1, Math.round(sampleRate * LIVE_STREAM_HOP_SECONDS));
    while (liveSampleCountRef.current >= hopSamples) {
      const block = takeLiveSamples(hopSamples);
      if (block.length < hopSamples) {
        break;
      }
      const startSeconds = Math.max(
        0,
        liveCapturedSecondsRef.current - (liveSampleCountRef.current + block.length) / sampleRate,
      );
      const mono = resamplePcmToMono(block, sampleRate, 16_000);
      liveStreamSecondsRef.current += mono.length / 16_000;
      bridge.sendLivePcm({
        pcmBase64: bytesToBase64(new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength)),
      });
      liveSentRef.current = true;
      const cursor = liveMatchStateRef.current.cursor;
      queueWhisperQc(block, sampleRate, liveSessionRef.current, cursor, cursor, startSeconds);
    }
  }

  /**
   * Take one captured block of microphone audio. Shared by the audio-thread tap
   * and the main-thread fallback so both paths behave identically.
   */
  function handleLiveBlock(samples: Float32Array, rms: number) {
    if (!liveEnabledRef.current || livePausedRef.current) {
      return;
    }
    const now = performance.now();
    if (rms >= LIVE_SPEECH_RMS) {
      liveSpeechAtRef.current = now;
    }
    let peak = 0;
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
    }
    liveInputQualityRef.current = observeInputQuality(liveInputQualityRef.current, {
      rms,
      peak,
      atSeconds: liveCapturedSecondsRef.current,
    });
    if (now - liveMeterUpdateRef.current >= 250) {
      liveMeterUpdateRef.current = now;
      setLiveSignalLevel(peak);
      setLiveInputQuality(liveInputQualityRef.current);
    }
    liveSamplesRef.current.push(samples);
    liveSampleCountRef.current += samples.length;
    liveTapeRef.current.push(samples);
    liveTapeSampleCountRef.current += samples.length;
    liveCapturedSecondsRef.current += samples.length / liveSampleRateRef.current;
    if (liveFollowStreamRef.current) {
      pumpLiveStream();
      return;
    }
    // The main process owns the crash/page-close-safe booth tape. Streaming
    // follow normally supplies its 16 kHz PCM; on the Whisper fallback path we
    // still send a copy even though no live recognizer consumes it.
    const mono = resamplePcmToMono(samples, liveSampleRateRef.current, 16_000);
    window.boothDesk?.sendLivePcm({
      pcmBase64: bytesToBase64(new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength)),
    });
    if (shouldFlushLiveBuffer()) {
      flushLiveWindow();
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
    if (livePausedRef.current) {
      return;
    }
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

  /**
   * Start delivering microphone blocks. Preferred path is a tap on the audio
   * rendering thread, which hands off each hop as soon as its last sample lands
   * and keeps capture immune to whatever the interface is busy doing. A runtime
   * without audio worklets falls back to the older main-thread processor.
   */
  async function attachLiveTap(context: AudioContext, source: MediaStreamAudioSourceNode) {
    const hopSamples = Math.max(1, Math.round(context.sampleRate * LIVE_STREAM_HOP_SECONDS));
    try {
      liveTapRef.current = await createLiveTap({
        context,
        source,
        hopSamples,
        onBlock: ({ samples, rms }) => handleLiveBlock(samples, rms),
      });
      return;
    } catch (reason) {
      // Falling back is safe but changes follow latency, so say so rather than
      // leaving the slower path to be mistaken for the faster one.
      console.warn("Audio-thread capture unavailable; using main-thread tap.", reason);
    }
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;
    liveProcessorRef.current = processor;
    liveGainRef.current = gain;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (const sample of input) {
        sumSquares += sample * sample;
      }
      handleLiveBlock(
        new Float32Array(input),
        input.length > 0 ? Math.sqrt(sumSquares / input.length) : 0,
      );
    };
    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);
  }

  async function startLiveCapture(options?: { fromBeginning?: boolean; resumeExisting?: boolean }) {
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
    let microphoneNotice: string | null = null;
    setLiveError(null);
    setLiveStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not available in this app window.");
      }
      const priorAlignment = options?.resumeExisting
        ? await window.boothDesk.readAlignment({
            folder: liveTapeContextRef.current.folder,
            project: liveTapeContextRef.current.project,
            chapterId: chapterIdRef.current,
          })
        : null;
      // Load the persistent local recognizer while the button visibly says
      // "Starting". Subsequent microphone windows reuse that loaded model;
      // the main process releases it when this session stops.
      const warmed = await window.boothDesk.startLiveTranscription({
        folder: liveTapeContextRef.current.folder,
        project: liveTapeContextRef.current.project,
        chapterId: chapterIdRef.current,
        resumeExisting: options?.resumeExisting === true,
      });
      const resumedSeconds = options?.resumeExisting ? Math.max(0, warmed?.resumedSeconds ?? 0) : 0;
      if (options?.resumeExisting && resumedSeconds <= 0) {
        throw new Error("The saved booth read could not be loaded for continuation. It was not replaced.");
      }
      liveTapeBaseSecondsRef.current = resumedSeconds;
      livePriorTimelineRef.current = priorAlignment?.source_kind === "live"
        ? [...priorAlignment.transcript]
        : [];
      liveFollowStreamRef.current = Boolean(warmed?.streaming);
      // A Parakeet follow server can still warm successfully when Whisper
      // failed. Keep voice-follow usable, but make the missing proofreader
      // explicit instead of presenting a healthy-looking cursor-only run.
      const whisperReady = warmed?.backcheck === "whisper";
      if (!whisperReady) {
        setLiveWhisperLastError("Whisper back-check is unavailable; cursor follow is still running.");
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints(selectedInputId),
        });
      } catch (reason) {
        if (!selectedInputId) {
          throw reason;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints(""),
        });
        chooseMicrophone("");
        microphoneNotice = "The saved microphone was unavailable, so this read is using the system default.";
      }
      void refreshMicrophoneList();
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      liveEnabledRef.current = true;
      liveStreamRef.current = stream;
      liveContextRef.current = context;
      liveSourceRef.current = source;
      livePausedRef.current = false;
      setLivePaused(false);
      liveSampleRateRef.current = context.sampleRate;
      liveTapeChapterIdRef.current = chapterIdRef.current;
      liveTapeRef.current = [];
      liveTapeSampleCountRef.current = 0;
      liveTapeBaseSecondsRef.current = resumedSeconds;
      liveManuscriptTimelineRef.current = new Map();
      liveSamplesRef.current = [];
      liveSampleCountRef.current = 0;
      liveCapturedSecondsRef.current = resumedSeconds;
      liveBufferStartSecondsRef.current = resumedSeconds;
      liveSentRef.current = false;
      liveQcBufferRef.current = createLiveQcBuffer();
      liveWhisperPromiseRef.current = null;
      liveFollowPromiseRef.current = null;
      liveSessionRef.current += 1;
      // Scroll percentage is a visual position, not a word index: headings,
      // spacing, and wrapped lines make multiplying it by the chapter word
      // count wrong. Use the measured first visible manuscript line.
      // "Read again from the start" forces the first word even if the page
      // is still sitting on the last paragraph of the previous take.
      if (options?.fromBeginning) {
        scrollRef.current?.scrollTo({ top: 0 });
      }
      const startingCursor = options?.fromBeginning
        ? 0
        : options?.resumeExisting && savedResumeCursorRef.current !== null
          ? savedResumeCursorRef.current
          : visibleLiveCursor();
      setLiveStartCursor(startingCursor);
      liveMatchStateRef.current = { cursor: startingCursor, lastHeardEnd: resumedSeconds };
      liveVisualCursorRef.current = startingCursor;
      liveLeadRef.current = createLeadState(startingCursor, performance.now());
      liveStreamSecondsRef.current = 0;
      liveStreamClockOffsetRef.current = resumedSeconds;
      liveSpeechAtRef.current = null;
      liveHaltRef.current = null;
      liveHaltResumeIndexRef.current = -1;
      setLiveHalt(null);
      setLiveCursor(startingCursor);
      liveDismissedRef.current = [];
      setLiveHeardText("");
      setLiveCheckCount(0);
      setLiveLatencyMs(null);
      liveInputQualityRef.current = createInputQuality();
      setLiveInputQuality(liveInputQualityRef.current);
      setLiveWhisperAttempted(0);
      setLiveWhisperSucceeded(0);
      setLiveWhisperFailed(0);
      setLiveWhisperLastError(null);
      setLiveWhisperLastWords("");
      setLiveDetectedFlags([]);
      setLiveBoothNotice(options?.resumeExisting
        ? `Continuing the saved ${formatLength(resumedSeconds)} booth read. New audio will be appended when you stop.`
        : microphoneNotice);
      await attachLiveTap(context, source);
      await context.resume();
      const nextState = { ...createLiveFlagsState(), enabled: true };
      liveStateRef.current = nextState;
      setLiveState(nextState);
      setLiveStatus("listening");
      if (liveQcFlushTimerRef.current !== null) {
        window.clearInterval(liveQcFlushTimerRef.current);
      }
      liveQcFlushTimerRef.current = window.setInterval(() => {
        if (!liveEnabledRef.current || livePausedRef.current || liveStateRef.current.dimmed) {
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

  /**
   * Hold one narration session open while the narrator takes a break.
   *
   * Suspending the existing AudioContext keeps the manuscript cursor, matcher,
   * and booth tape in the same session. Muting the track before suspension
   * ensures a cough, conversation, or glass of water never enters the tape.
   */
  async function setLiveCapturePaused(shouldPause: boolean) {
    if (
      !liveEnabledRef.current
      || liveStoppingRef.current
      || livePauseChangingRef.current
      || livePausedRef.current === shouldPause
    ) {
      return;
    }
    const context = liveContextRef.current;
    const stream = liveStreamRef.current;
    if (!context || !stream || context.state === "closed") {
      setLiveError("The microphone session ended. Stop this read, then start a new one.");
      setLiveStatus("error");
      return;
    }

    livePauseChangingRef.current = true;
    setLivePauseChanging(true);
    const tracks = stream.getAudioTracks();
    try {
      if (shouldPause) {
        livePausedRef.current = true;
        tracks.forEach((track) => {
          track.enabled = false;
        });
        await context.suspend();
        liveSpeechAtRef.current = null;
        liveLeadRef.current = createLeadState(liveVisualCursorRef.current, performance.now());
        setLiveSignalLevel(0);
        setLivePaused(true);
        setLiveStatus("paused");
        setLiveError(null);
      } else {
        if (tracks.length === 0 || tracks.every((track) => track.readyState === "ended")) {
          throw new Error("The microphone disconnected during the break.");
        }
        await context.resume();
        tracks.forEach((track) => {
          track.enabled = true;
        });
        livePausedRef.current = false;
        liveSpeechAtRef.current = null;
        liveLeadRef.current = createLeadState(liveVisualCursorRef.current, performance.now());
        setLivePaused(false);
        setLiveStatus("listening");
        setLiveError(null);
      }
    } catch (reason) {
      if (!liveEnabledRef.current || liveStoppingRef.current) {
        return;
      }
      const remainsPaused = !shouldPause;
      livePausedRef.current = remainsPaused;
      setLivePaused(remainsPaused);
      tracks.forEach((track) => {
        track.enabled = !remainsPaused;
      });
      setLiveError(messageFor(reason, shouldPause ? "Could not pause this read." : "Could not resume this read."));
      setLiveStatus("error");
    } finally {
      livePauseChangingRef.current = false;
      setLivePauseChanging(false);
    }
  }

  function startNarrationNow() {
    const fromBeginning = startFromBeginningRef.current;
    const resumeExisting = resumeExistingRef.current;
    startFromBeginningRef.current = false;
    resumeExistingRef.current = false;
    setPronunciationBriefingOpen(false);
    setPronunciationCheckState("idle");
    void startLiveCapture({ fromBeginning, resumeExisting });
  }

  function requestNarration(options?: { fromBeginning?: boolean; resumeExisting?: boolean }) {
    startFromBeginningRef.current = options?.fromBeginning === true;
    resumeExistingRef.current = options?.resumeExisting === true;
    setLiveEnabled(true);
  }

  function setLiveEnabled(enabled: boolean) {
    if (enabled) {
      if (briefingGlossary.length > 0 && !resumeExistingRef.current) {
        setPronunciationBriefingOpen(true);
      } else {
        startNarrationNow();
      }
      return;
    }
    void stopLiveCapture({ flushQc: true });
    const nextState = { ...liveStateRef.current, enabled: false };
    liveStateRef.current = nextState;
    setLiveState(nextState);
    setLiveFlag(null);
  }

  async function checkChapterNow() {
    setPronunciationCheckState("running");
    setPronunciationCheckSource(proofAudioSource(chapter)?.kind ?? null);
    const checked = await onProof(chapterId);
    setPronunciationCheckState(checked ? "ready" : "failed");
  }

  function openReviewRecordingChooser() {
    if (!chapter.live_audio_path && !chapter.audio_path) {
      setMode("proof");
      return;
    }
    setReviewRecordingChooserOpen(true);
  }

  async function selectReviewRecording(sourceKind: ProofSourceKind) {
    if (reviewSelectionBusy) return;
    setReviewSelectionBusy(sourceKind);
    try {
      const checked = await onSelectReviewRecording(chapterId, sourceKind);
      if (checked) {
        setReviewRecordingChooserOpen(false);
        onReview();
      }
    } finally {
      setReviewSelectionBusy(null);
    }
  }

  async function leavePage(next: () => void) {
    if (liveEnabledRef.current) {
      await stopLiveCapture({ flushQc: false });
      setLiveBoothNotice("Recording stopped. Save or discard this draft before leaving.");
      return;
    }
    if (pendingDraft) {
      setLiveError("Save or discard this draft before leaving the teleprompter.");
      return;
    }
    next();
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
      if (reviewRecordingChooserOpen) {
        if (event.key === "Escape" && !reviewSelectionBusy) {
          event.preventDefault();
          setReviewRecordingChooserOpen(false);
        }
        return;
      }
      if (replaceReadConfirmationOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setReplaceReadConfirmationOpen(false);
        }
        return;
      }
      if (pronunciationBriefingOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          startFromBeginningRef.current = false;
          resumeExistingRef.current = false;
          setPronunciationBriefingOpen(false);
        }
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = Boolean(
        target?.isContentEditable
        || target?.closest("input, textarea, select"),
      );
      const boothAction = boothShortcutAction({
        key: event.key,
        recording: liveEnabledRef.current,
        paused: livePausedRef.current,
        halted: liveHaltRef.current !== null,
        repeat: event.repeat,
        editing,
      });
      if (boothAction) {
        event.preventDefault();
        if (boothAction === "continue") {
          resumeFromHalt();
        } else if (boothAction === "restart") {
          void restartSentenceWithPreroll();
        } else if (boothAction === "mark") {
          markCurrentRead();
        } else {
          void setLiveCapturePaused(!livePausedRef.current);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void leavePage(onClose);
      } else if ((event.key === " " || event.key === "PageDown") && !target?.closest("button, input, textarea, select")) {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: Math.max(120, window.innerHeight * 0.72), behavior: "smooth" });
      } else if (event.key === "PageUp" && !target?.closest("button, input, textarea, select")) {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: -Math.max(120, window.innerHeight * 0.72), behavior: "smooth" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [liveDetectedFlags, onClose, onIgnoreLivePickup, pronunciationBriefingOpen, replaceReadConfirmationOpen, reviewRecordingChooserOpen, reviewSelectionBusy]);

  // Word mode marks a single word; the wider modes band a range instead, so
  // only one of the two is ever active.
  const liveBand = promptHighlightRange({
    mode: highlight,
    wordIndex: liveWordIndex,
    paragraphFirstWord: liveLineIndex === undefined ? undefined : lineWordStarts.get(liveLineIndex),
    paragraphWordCount: liveLineWordCount,
    rows: wordRows,
  });
  const liveInputDescription = describeInputQuality(liveInputQuality, liveCapturedSecondsRef.current);
  const stoppedFlow = stoppedReadFlow(Boolean(chapter.live_audio_path));
  const workflow = teleprompterWorkflow({
    hasSavedTape: Boolean(chapter.live_audio_path),
    hasPendingDraft: Boolean(pendingDraft),
    recording: liveState.enabled,
    paused: livePaused,
    status: liveStatus,
  });
  const offerChapterReview = shouldOfferChapterReview({
    recordedCoverage: savedReadCoverage,
    pageProgress: progress,
  });
  const resumeAtWord = savedResumeCursor === null
    ? null
    : expectedWords[Math.min(expectedWords.length - 1, savedResumeCursor)]?.text ?? null;

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
            {mode === "proof" ? (
              <button type="button" className="booth-icon-button" onClick={() => setMode("narrate")}>Back to reading</button>
            ) : !workflow.canReview && !liveState.enabled && (chapter.live_audio_path || chapter.audio_path) ? (
              <button type="button" className="booth-icon-button booth-review-button" onClick={openReviewRecordingChooser}>Review a recording…</button>
            ) : null}
            <button type="button" className={materialsOpen ? "booth-icon-button active" : "booth-icon-button"} aria-expanded={materialsOpen} onClick={() => setMaterialsOpen((open) => !open)}>Materials</button>
            <button type="button" className="booth-icon-button" onClick={() => void leavePage(onClose)}>Leave</button>
          </div>
        </header>

        {mode === "narrate" ? (
          <>
            <TeleprompterWorkflowGuide workflow={workflow} />

            <details className="booth-recording-help">
              <summary>How voice follow and saving work</summary>
              <p>The highlighted line follows your voice. Stop creates a draft you can listen to and name; only Save adds it to Review. Voice follow is experimental, and Space or PageDown always scrolls the page.</p>
              {liveState.dimmed ? <button type="button" className="table-action" onClick={undoLiveDim}>Try voice follow again</button> : null}
            </details>
            {glossaryHint ? <p className="booth-honesty"><strong role="status">{glossaryHint}</strong></p> : null}

            {liveStatus !== "off" || liveState.enabled || liveError ? (
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
                inputQuality={liveInputDescription}
                cursor={liveCursor}
                totalWords={expectedWords.length}
              />
            ) : null}
            {liveBoothNotice ? <p className="booth-honesty" role="status">{liveBoothNotice}</p> : null}

            {livePunchRollStatus !== "idle" ? (
              <div className="booth-halt" role="status">
                <div className="booth-halt-copy">
                  <strong>{livePunchRollStatus === "cueing"
                    ? "Rolling into the sentence"
                    : livePunchRollStatus === "counting"
                      ? "Counting into the sentence"
                      : "Rewinding the clean take"}</strong>
                  <span>{livePunchRollStatus === "cueing"
                    ? "Listen for your rhythm; recording resumes at the marked boundary."
                    : livePunchRollStatus === "counting"
                      ? "There is no earlier voice in this session, so three tones mark the restart."
                      : "Replacing the false start and resetting voice follow…"}</span>
                </div>
              </div>
            ) : null}

            {liveState.enabled && upcomingPronunciation ? (
              <PronunciationCueBar
                entry={upcomingPronunciation.entry}
                linesAhead={upcomingPronunciation.rowsAhead}
                onPlay={() => activateGlossary(upcomingPronunciation.entry)}
              />
            ) : null}

            {liveHalt ? (
              <div className="booth-halt" role="alert">
                <div className="booth-halt-copy">
                  <strong>{liveHaltCopy(liveHalt).title}</strong>
                  <span>{liveHaltCopy(liveHalt).detail}</span>
                </div>
                <div className="booth-playback-actions">
                  <button type="button" className="secondary-button" onClick={() => void restartSentenceWithPreroll()}>Restart sentence</button>
                  <button type="button" className="primary-button" onClick={resumeFromHalt}>Continue</button>
                </div>
              </div>
            ) : null}

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
                      className={`teleprompter-line${liveLineIndex === line.index && highlight !== "paragraph" ? " teleprompter-line-live" : ""}`}
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
                              // Spacing inside the band carries it too, so the
                              // highlight reads as one stripe.
                              return (
                                <span
                                  key={`${line.index}-${index}-${tokenIndex}`}
                                  className={promptBandCovers(liveBand, wordIndex, false) ? "teleprompter-band-live" : undefined}
                                >{token.text}</span>
                              );
                            }
                            const currentWordIndex = wordIndex;
                            wordIndex += 1;
                            const mark = liveWordMark(currentWordIndex, liveWordIndex, liveFlag?.expectedIndex);
                            const wordClass = [
                              // The single-word mark belongs to word mode. The
                              // wider modes band a range instead, but the
                              // reading position still drives scrolling and
                              // assistive technology in every mode.
                              mark.follow && highlight === "word" ? "teleprompter-word-live" : "",
                              promptBandCovers(liveBand, currentWordIndex, true) ? "teleprompter-band-live" : "",
                              mark.flag ? "teleprompter-word-flag" : "",
                              // Marked in every highlight mode: a band alone
                              // cannot say which of its words to restart on.
                              liveHalt?.expectedIndex === currentWordIndex ? "teleprompter-word-halt" : "",
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
                {offerChapterReview ? (
                  <section className="booth-end-card">
                    <strong>Ready to review this chapter?</strong>
                    <span>Stop, name, and save the booth read first. Then choose the recording you want to check against the manuscript.</span>
                    {chapter.live_audio_path || chapter.audio_path ? (
                      <button type="button" className="primary-button" onClick={openReviewRecordingChooser}>Review a recording…</button>
                    ) : null}
                  </section>
                ) : null}
              </article>
            </div>

            {/*
              * Hearing the read back is the first thing a narrator wants after
              * Stop, so it happens here rather than behind a trip to Review.
              * Hidden while recording: the tape being offered would be the
              * previous read, which is not what the button next to it means.
              */}
            {pendingDraft && !liveState.enabled ? (
              <section className="booth-playback stopped-read-card draft-read-card" aria-label="Unsaved stopped recording">
                <div className="recording-progress-top">
                  <span>{Math.round(savedReadCoverage * 100)}% of manuscript recorded</span>
                  <div className="recorded-coverage-track" role="progressbar" aria-label="Recorded manuscript coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(savedReadCoverage * 100)}>
                    <i style={{ width: `${Math.round(savedReadCoverage * 100)}%` }} />
                  </div>
                </div>
                <div className="compact-recording-copy">
                  <div><p className="card-kicker">Not saved yet</p><strong>Recording stopped</strong></div>
                  <span>{pendingDraftSeconds !== null ? formatLength(pendingDraftSeconds) : "Draft"}</span>
                </div>
                {pendingDraftUrl ? <audio controls src={pendingDraftUrl} preload="metadata" /> : <p className="booth-empty">Preparing playback…</p>}
                <label className="recording-name-field">
                  <span>Recording name</span>
                  <input value={pendingDraftName} maxLength={120} onChange={(event) => setPendingDraftName(event.target.value)} />
                </label>
                <div className="stopped-read-actions">
                  <button type="button" className="primary-button" disabled={pendingDraftSaving || !pendingDraftName.trim()} onClick={() => void savePendingDraft()}>{pendingDraftSaving ? "Saving…" : "Save this recording"}</button>
                  <button type="button" className="secondary-button" disabled={pendingDraftSaving} onClick={() => void discardPendingDraft()}>Discard draft</button>
                </div>
                <p className="stopped-read-explainer">Saving makes this named take available for Continue and Review. Discarding keeps your previously saved recording unchanged.</p>
              </section>
            ) : tapeUrl && !liveState.enabled ? (
              <section className={`booth-playback stopped-read-card${tapeTake > 0 ? " fresh" : ""}`} aria-label="Stopped booth recording">
                <div className="recording-progress-top">
                  <span>{Math.round(savedReadCoverage * 100)}% of manuscript recorded</span>
                  <div className="recorded-coverage-track" role="progressbar" aria-label="Recorded manuscript coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(savedReadCoverage * 100)}>
                    <i style={{ width: `${Math.round(savedReadCoverage * 100)}%` }} />
                  </div>
                </div>
                <div className="booth-playback-head">
                  <div>
                    <p className="card-kicker">Saved recording</p>
                    <strong>{chapter.live_audio_name ?? `${title} — Booth read`}</strong>
                    <span>
                      {tapeSeconds !== null ? `${formatLength(tapeSeconds)} · ` : ""}
                      {Math.round(savedReadCoverage * 100)}% of the manuscript has recorded timing.
                    </span>
                  </div>
                </div>
                <p className="stopped-read-explainer">
                  Continue appends {resumeAtWord ? <>at “<strong>{resumeAtWord}</strong>,” where you stopped</> : "from your saved page position"}. Use the action bar below to continue, review, or start over.
                </p>
                <div className="stopped-read-audio">
                  <span>Listen to the saved read</span>
                  <audio controls src={tapeUrl} preload="metadata" />
                </div>
              </section>
            ) : null}
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
            {proofAudioSource(chapter) ? (
              <>
                {audioUrl ? <audio controls src={audioUrl} preload="metadata" /> : <p className="booth-empty">Loading the recording…</p>}
                <div className="booth-proof-stats">
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.status === "open").length ?? chapter.open_pickups ?? 0}</strong><span>Open pickups</span></article>
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.kind !== "pause" && pickup.status === "open").length ?? "—"}</strong><span>Word changes</span></article>
                  <article><strong>{proof?.pickups.filter((pickup) => pickup.kind === "pause" && pickup.status === "open").length ?? "—"}</strong><span>Long pauses</span></article>
                  <article><strong>{acxReport ? checkStatusLabel(acxReport.traffic_light) : chapter.acx_traffic_light ? checkStatusLabel(chapter.acx_traffic_light) : "Not checked"}</strong><span>Audio check</span></article>
                </div>
                <div className="booth-proof-actions">
                  <button type="button" className="primary-button" disabled={busyAction !== null} onClick={() => void checkChapterNow()}>{busyAction?.startsWith("proof-") ? "Checking…" : "Check this chapter"}</button>
                  <button type="button" className="secondary-button" disabled={busyAction !== null} onClick={() => onCheckAudio(chapterId)}>{busyAction?.startsWith("meter-") ? "Measuring…" : "Check audio levels"}</button>
                  <button type="button" className="secondary-button" onClick={() => void leavePage(onReview)}>Open full review</button>
                </div>
                {briefingGlossary.length > 0 ? (
                  <PronunciationCheckPanel
                    state={pronunciationCheckState}
                    checks={pronunciationChecks}
                    entries={briefingGlossary}
                    onPlay={activateGlossary}
                    onListen={(check) => onListenPronunciation(check, pronunciationCheckSource === "live")}
                  />
                ) : null}
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
            liveState.enabled ? (
              <div className="booth-recording-controls" aria-label="Narration recording controls">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={livePauseChanging || livePaused || livePunchRollStatus !== "idle"}
                  title="Restart the current sentence with a lead-in (F8)"
                  onClick={() => void restartSentenceWithPreroll()}
                >
                  <span className="booth-start-icon" aria-hidden="true">↶</span>
                  <span>Restart sentence</span>
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={livePaused || livePunchRollStatus !== "idle"}
                  title="Place a marker for Review (F9)"
                  onClick={markCurrentRead}
                >
                  <span className="booth-start-icon" aria-hidden="true">◆</span>
                  <span>Mark</span>
                </button>
                <button
                  className="secondary-button booth-pause-button"
                  type="button"
                  disabled={livePauseChanging || livePunchRollStatus !== "idle"}
                  aria-pressed={livePaused}
                  onClick={() => void setLiveCapturePaused(!livePaused)}
                >
                  <span className="booth-start-icon" aria-hidden="true">{livePaused ? "▶" : "Ⅱ"}</span>
                  <span>{livePaused ? "Resume" : "Pause"}</span>
                </button>
                <button
                  className="primary-button booth-start-button booth-stop-button"
                  type="button"
                  disabled={livePauseChanging || livePunchRollStatus !== "idle"}
                  onClick={() => setLiveEnabled(false)}
                >
                  <span className="booth-start-icon" aria-hidden="true">■</span>
                  <span>Stop recording</span>
                </button>
              </div>
            ) : pendingDraft ? null : (
              <div className="booth-recording-controls" aria-label="Stopped recording actions">
                <button
                  className="primary-button booth-start-button booth-narrate-button"
                  type="button"
                  disabled={liveStatus === "starting" || liveStatus === "processing"}
                  onClick={() => stoppedFlow.primary === "continue"
                    ? requestNarration({ resumeExisting: true })
                    : setLiveEnabled(true)}
                >
                  <span className="booth-start-icon" aria-hidden="true">▶</span>
                  <span>{workflow.primaryLabel ?? "Start recording"}</span>
                </button>
                {workflow.canReview ? (
                  <button
                    className="secondary-button booth-review-recording-button"
                    type="button"
                    disabled={liveStatus === "starting" || liveStatus === "processing"}
                    onClick={openReviewRecordingChooser}
                  >
                    <span>Review recording…</span>
                  </button>
                ) : null}
                {workflow.canStartOver ? (
                  <button
                    className="secondary-button booth-start-over-button"
                    type="button"
                    disabled={liveStatus === "starting" || liveStatus === "processing"}
                    onClick={() => setReplaceReadConfirmationOpen(true)}
                  >
                    <span className="booth-start-icon" aria-hidden="true">↺</span>
                    <span>Start over…</span>
                  </button>
                ) : null}
              </div>
            )
          ) : (
            <button className="primary-button booth-start-button" type="button" onClick={() => setMode("narrate")}>Back to narration</button>
          )}
          <div className="booth-progress-wrap">
            <span>{mode === "narrate" ? workflow.stage === "stopped" ? `${Math.round(savedReadCoverage * 100)}% recorded` : remainingLabel : currentChapterStatus.label}</span>
            <div className="booth-progress" role="progressbar" aria-label={workflow.stage === "stopped" ? "Recorded manuscript coverage" : "Chapter reading progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((workflow.stage === "stopped" ? savedReadCoverage : progress) * 100)}>
              <i style={{ width: `${Math.round((workflow.stage === "stopped" ? savedReadCoverage : progress) * 100)}%` }} />
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
                <p className="card-kicker">Microphone</p>
                <label className="booth-input-device">
                  <span>Recording input</span>
                  <select
                    value={selectedInputId}
                    disabled={liveState.enabled}
                    onChange={(event) => chooseMicrophone(event.target.value)}
                  >
                    <option value="">System default</option>
                    {audioInputs.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <em>Raw mono capture. Change inputs between reads.</em>
                </label>
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
                <p className="card-kicker">Highlight as you read</p>
                <div className="booth-choice-grid" role="radiogroup" aria-label="Highlight as you read">
                  {(["word", "line", "paragraph"] as const).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={highlight === value} className={highlight === value ? "active" : ""} onClick={() => onHighlight(value)}>
                      {value === "word" ? "Word" : value === "line" ? "Line" : "Paragraph"}
                    </button>
                  ))}
                </div>
                <p className="booth-settings-hint">
                  {highlight === "word"
                    ? "Marks the single word you are on."
                    : highlight === "line"
                      ? "Lights the line you are on. Easier to follow, and it never moves ahead of you."
                      : "Lights the whole paragraph you are on. Steadiest, with the least movement."}
                </p>
                <p className="card-kicker">Line spacing</p>
                <div className="booth-choice-grid" role="radiogroup" aria-label="Line spacing">
                  {[1.35, 1.55, 1.8].map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={lineSpacing === value} className={lineSpacing === value ? "active" : ""} onClick={() => setLineSpacing(value)}>{value === 1.35 ? "Tight" : value === 1.55 ? "Comfortable" : "Spacious"}</button>
                  ))}
                </div>
                <label className="booth-toggle">
                  <span><strong>Check my reading</strong><em>Marks words that may not match the script so you can review them later.</em></span>
                  <input type="checkbox" checked={liveState.enabled} disabled={liveStatus === "starting" || liveStatus === "processing"} onChange={(event) => setLiveEnabled(event.target.checked)} />
                </label>
                <label className="booth-toggle">
                  <span><strong>Pause if I lose my place</strong><em>Freezes the page after {LIVE_HALT_RUN_WORDS} words do not match. Recording keeps going.</em></span>
                  <input type="checkbox" checked={stopOnMismatch} onChange={(event) => setStopOnMismatch(event.target.checked)} />
                </label>
                <div className="booth-shortcuts" aria-label="Keyboard and foot pedal shortcuts">
                  <strong>Keyboard or programmable pedal</strong>
                  <span><kbd>F7</kbd> Continue</span>
                  <span><kbd>F8</kbd> Restart sentence</span>
                  <span><kbd>F9</kbd> Mark for Review</span>
                  <span><kbd>F10</kbd> Pause or resume</span>
                </div>
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
      {replaceReadConfirmationOpen ? (
        <ReplaceBoothReadConfirmation
          duration={tapeSeconds}
          coverage={savedReadCoverage}
          onCancel={() => setReplaceReadConfirmationOpen(false)}
          onConfirm={() => {
            setReplaceReadConfirmationOpen(false);
            requestNarration({ fromBeginning: true });
          }}
        />
      ) : null}
      {reviewRecordingChooserOpen ? (
        <ReviewRecordingChooser
          hasBoothRead={Boolean(chapter.live_audio_path)}
          boothName={chapter.live_audio_name ?? `${title} — Booth read`}
          hasChapterTake={Boolean(chapter.audio_path)}
          boothDuration={tapeSeconds}
          boothCoverage={savedReadCoverage}
          busy={reviewSelectionBusy}
          onCancel={() => setReviewRecordingChooserOpen(false)}
          onSelect={(sourceKind) => void selectReviewRecording(sourceKind)}
        />
      ) : null}
      {pronunciationBriefingOpen ? (
        <PronunciationBriefing
          chapterTitle={title}
          entries={briefingGlossary}
          onPlay={activateGlossary}
          onCancel={() => {
            startFromBeginningRef.current = false;
            resumeExistingRef.current = false;
            setPronunciationBriefingOpen(false);
          }}
          onStart={startNarrationNow}
        />
      ) : null}
    </div>
  );
}

function TeleprompterWorkflowGuide({ workflow }: { workflow: TeleprompterWorkflow }) {
  return (
    <section className={`teleprompter-workflow stage-${workflow.stage}`} aria-label="Recording workflow">
      <div className="teleprompter-workflow-copy" role="status" aria-live="polite">
        <span className="teleprompter-workflow-state" aria-hidden="true" />
        <div>
          <strong>{workflow.title}</strong>
          <p>{workflow.detail}</p>
        </div>
      </div>
    </section>
  );
}

function ReplaceBoothReadConfirmation({
  duration,
  coverage,
  onCancel,
  onConfirm,
}: {
  duration: number | null;
  coverage: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="recording-decision-shade" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="recording-decision-dialog replace-read-dialog" role="alertdialog" aria-modal="true" aria-labelledby="replace-read-title" aria-describedby="replace-read-detail">
        <span className="recording-decision-icon warning" aria-hidden="true">↺</span>
        <div>
          <p className="card-kicker">Start over from the first word</p>
          <h2 id="replace-read-title">Replace the current booth read?</h2>
          <p id="replace-read-detail">
            Your {duration !== null ? `${formatLength(duration)} recording` : "saved recording"} covers {Math.round(coverage * 100)}% of the manuscript.
            Starting over creates a new read from the beginning. Your current recording stays safe until you stop, name, and explicitly save the replacement.
          </p>
          <p className="recording-decision-safety">Your attached chapter take is not changed. Cancel to keep everything exactly as it is.</p>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>Keep current read</button>
          <button type="button" className="replace-confirm-button" onClick={onConfirm}>Start over and replace</button>
        </footer>
      </section>
    </div>
  );
}

function ReviewRecordingChooser({
  hasBoothRead,
  boothName,
  hasChapterTake,
  boothDuration,
  boothCoverage,
  busy,
  onCancel,
  onSelect,
}: {
  hasBoothRead: boolean;
  boothName: string;
  hasChapterTake: boolean;
  boothDuration: number | null;
  boothCoverage: number;
  busy: ProofSourceKind | null;
  onCancel: () => void;
  onSelect: (sourceKind: ProofSourceKind) => void;
}) {
  return (
    <div className="recording-decision-shade" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="recording-decision-dialog review-recording-dialog" role="dialog" aria-modal="true" aria-labelledby="review-recording-title">
        <header>
          <div>
            <p className="card-kicker">Before Review</p>
            <h2 id="review-recording-title">Which recording do you want to review?</h2>
            <p>Kosmos will check the selected recording, then open it against the manuscript. The source stays named throughout Review.</p>
          </div>
          <button type="button" aria-label="Close recording chooser" disabled={Boolean(busy)} onClick={onCancel}>×</button>
        </header>
        <div className="review-recording-options">
          {hasBoothRead ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => onSelect("live")}>
              <span className="recording-choice-icon" aria-hidden="true">●</span>
              <strong>{boothName}</strong>
              <em>{boothDuration !== null ? formatLength(boothDuration) : "Saved here"} · {Math.round(boothCoverage * 100)}% recorded</em>
              <small>Keeps the teleprompter timing and narrator markers.</small>
              <b>{busy === "live" ? "Preparing Review…" : "Review this recording"}</b>
            </button>
          ) : null}
          {hasChapterTake ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => onSelect("take")}>
              <span className="recording-choice-icon imported" aria-hidden="true">↑</span>
              <strong>Attached chapter take</strong>
              <em>Imported recording</em>
              <small>Uses the take attached to this chapter, not the booth read.</small>
              <b>{busy === "take" ? "Preparing Review…" : "Review this recording"}</b>
            </button>
          ) : null}
        </div>
        <footer>
          <span>Selecting a source does not delete or replace either recording.</span>
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onCancel}>Cancel</button>
        </footer>
      </section>
    </div>
  );
}

function PronunciationBriefing({
  chapterTitle,
  entries,
  onPlay,
  onCancel,
  onStart,
}: {
  chapterTitle: string;
  entries: GlossaryEntry[];
  onPlay: (entry: GlossaryEntry) => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const undecided = entries.filter((entry) => !entry.respell?.trim() && !entry.clip_path).length;
  return (
    <div className="pronunciation-briefing-shade" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onCancel();
      }
    }}>
      <section className="pronunciation-briefing" role="dialog" aria-modal="true" aria-labelledby="pronunciation-briefing-title">
        <header>
          <div>
            <p className="card-kicker">Before this take</p>
            <h2 id="pronunciation-briefing-title">Pronunciations in {chapterTitle}</h2>
            <p>
              Review these once, then read without interruption. Kosmos will give you a quiet reminder
              shortly before each word.
            </p>
          </div>
          <span>{entries.length} {entries.length === 1 ? "word" : "words"}</span>
        </header>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className={!entry.respell?.trim() && !entry.clip_path ? "undecided" : undefined}>
              <div>
                <strong>{entry.spelling}</strong>
                <span>{entry.respell?.trim() || "Pronunciation still needs a decision"}</span>
                {entry.voice_note?.trim() ? <p>{entry.voice_note}</p> : null}
              </div>
              {entry.clip_path ? (
                <button type="button" className="secondary-button" onClick={() => onPlay(entry)}>▶ Hear</button>
              ) : null}
            </li>
          ))}
        </ul>
        {undecided > 0 ? (
          <p className="pronunciation-briefing-warning">
            {undecided} {undecided === 1 ? "word has" : "words have"} no agreed pronunciation yet. You can still record, but settle {undecided === 1 ? "it" : "them"} before the final take.
          </p>
        ) : null}
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>Not yet</button>
          <button type="button" className="primary-button" onClick={onStart}>Start narrating</button>
        </footer>
      </section>
    </div>
  );
}

function PronunciationCueBar({
  entry,
  linesAhead,
  onPlay,
}: {
  entry: GlossaryEntry;
  linesAhead: number;
  onPlay: () => void;
}) {
  return (
    <aside className="pronunciation-cue" aria-label={`Pronunciation coming up: ${entry.spelling}`}>
      <span className="pronunciation-cue-kicker">
        {linesAhead === 0 ? "On this line" : linesAhead === 1 ? "Next line" : "Coming up"}
      </span>
      <div>
        <strong>{entry.spelling}</strong>
        <span>{entry.respell?.trim() || "No respelling agreed yet"}</span>
        {entry.voice_note?.trim() ? <p>{entry.voice_note}</p> : null}
      </div>
      {entry.clip_path ? <button type="button" onClick={onPlay}>▶ Hear</button> : null}
    </aside>
  );
}

function PronunciationCheckPanel({
  state,
  checks,
  entries,
  onPlay,
  onListen,
}: {
  state: "idle" | "running" | "ready" | "failed";
  checks: PronunciationCheck[];
  entries: GlossaryEntry[];
  onPlay: (entry: GlossaryEntry) => void;
  onListen: (check: PronunciationCheck) => void;
}) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const matched = checks.filter((check) => check.status === "matches").length;
  const listen = checks.filter((check) => ["inconsistent", "review", "unverified"].includes(check.status)).length;
  return (
    <section className="pronunciation-check" aria-labelledby="pronunciation-check-title">
      <header>
        <div>
          <p className="card-kicker">After this take</p>
          <h3 id="pronunciation-check-title">Pronunciation check</h3>
        </div>
        {state === "running" ? <span className="checking">Checking automatically…</span> : null}
        {state !== "running" && checks.length > 0 ? (
          <span>{matched} matched · {listen} to listen</span>
        ) : null}
      </header>
      {state === "running" ? (
        <p>Transcribing the saved read and comparing this chapter’s names with the agreed guide.</p>
      ) : state === "failed" ? (
        <p>The automatic check could not finish. Use “Check this chapter” to try the recording again.</p>
      ) : checks.length === 0 ? (
        <p>Check this chapter to compare its recorded pronunciations with the guide.</p>
      ) : (
        <>
          <ul>
            {checks.map((check) => {
              const entry = byId.get(check.entryId);
              return (
                <li key={check.entryId} className={`status-${check.status}`}>
                  <div>
                    <strong>{check.spelling}</strong>
                    <span>{check.respell ? `Guide: ${check.respell}` : "No agreed pronunciation"}</span>
                    <p>{pronunciationCheckDetail(check)}</p>
                  </div>
                  <em>{pronunciationCheckLabel(check.status)}</em>
                  {check.start !== undefined ? <button type="button" onClick={() => onListen(check)}>▶ Take</button> : null}
                  {entry?.clip_path ? <button type="button" onClick={() => onPlay(entry)}>▶ Reference</button> : null}
                </li>
              );
            })}
          </ul>
          <p className="pronunciation-check-honesty">
            The speech model is a screen, not a verdict. “Needs a listen” means it could not prove the sound from text alone; play that moment before requesting a pickup.
          </p>
        </>
      )}
    </section>
  );
}

function pronunciationCheckLabel(status: PronunciationCheck["status"]): string {
  switch (status) {
    case "matches": return "Matches guide";
    case "inconsistent": return "Different readings";
    case "review": return "Needs a listen";
    case "unverified": return "Needs a listen";
    case "undecided": return "Not decided";
    case "unheard": return "Not heard";
  }
}

function pronunciationCheckDetail(check: PronunciationCheck): string {
  if (check.status === "unverified") {
    return "The recogniser returned the manuscript spelling, so it cannot prove how the word sounded.";
  }
  if (check.status === "unheard") {
    return "No aligned speech was available for this word.";
  }
  if (check.status === "undecided") {
    return check.heard.length > 0
      ? `Heard as “${check.heard.join("” and “")}”; choose the book’s pronunciation.`
      : "Choose the book’s pronunciation before the final take.";
  }
  if (check.status === "inconsistent") {
    return `Heard as “${check.heard.join("” and “")}” in this chapter.`;
  }
  if (check.status === "matches") {
    return `Heard as “${check.heard.join("” and “")}” across ${check.checkedCount} ${check.checkedCount === 1 ? "place" : "places"}.`;
  }
  return check.heard.length > 0
    ? `The recogniser heard “${check.heard.join("” and “")}”; compare it with the reference.`
    : "Listen to the recording and compare it with the reference.";
}

function LiveVoiceStatus({
  modelAvailable,
  status,
  enabled,
  dimmed,
  error,
  heardText,
  checkCount,
  latencyMs,
  whisperAttempted,
  whisperSucceeded,
  whisperFailed,
  whisperLastError,
  whisperLastWords,
  startCursor,
  detectedFlags,
  signalLevel,
  inputQuality,
  cursor,
  totalWords,
}: {
  modelAvailable: boolean | null;
  status: LiveVoiceStatus;
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
  inputQuality: ReturnType<typeof describeInputQuality>;
  cursor: number;
  totalWords: number;
}) {
  const copy = liveVoiceStatusCopy({ status, enabled, dimmed, error, heardText });
  const importantDetail = status === "error" || status === "paused" || dimmed ? copy.detail : "";

  return (
    <div className={`live-voice-status live-voice-status-${status}`} role="status" aria-live="polite">
      <div className="live-voice-status-main">
        <span className="live-voice-status-dot" aria-hidden="true" />
        <strong>{copy.title}</strong>
        {importantDetail ? <span>{importantDetail}</span> : null}
      </div>
      {enabled ? (
        <span className={`live-input-quality quality-${inputQuality.kind}`} title={inputQuality.detail}>
          <span>{inputQuality.label}</span>
          <span className="live-mic-meter" aria-label={`Microphone peak ${Math.round(signalLevel * 100)} percent`}>
            <i><b style={{ width: `${Math.round(signalLevel * 100)}%` }} /></i>
          </span>
        </span>
      ) : null}
      <details className="live-voice-diagnostics">
        <summary>Diagnostics</summary>
        <div>
          <span>Model {modelAvailable === false ? "missing" : "ready"}</span>
          <span>Checks {checkCount}</span>
          {latencyMs !== null ? <span>{Math.round(latencyMs)} ms</span> : null}
          {enabled && whisperAttempted > 0 ? <span>Back-check {whisperSucceeded}/{whisperAttempted} · {whisperFailed} failed</span> : null}
          {enabled && whisperLastError ? <span>{whisperLastError}</span> : null}
          {enabled && whisperLastWords ? <span>Heard: {whisperLastWords}</span> : null}
          {enabled && startCursor != null ? <span>Start {startCursor}</span> : null}
          {enabled ? <span>Cursor {cursor}/{totalWords}</span> : null}
          {inputQuality.headroomDb !== null ? <span>Headroom {inputQuality.headroomDb.toFixed(1)} dB</span> : null}
          {inputQuality.noiseFloorDb !== null ? <span>Noise floor {inputQuality.noiseFloorDb.toFixed(1)} dBFS</span> : null}
          {enabled && detectedFlags.length > 0 ? <span>Flags {detectedFlags.length}</span> : null}
        </div>
      </details>
    </div>
  );
}

function RecorderPanel({
  label,
  disabled,
  applyLabel = "Apply pickup",
  onVerify,
  onPreview,
  onSave,
}: {
  label: string;
  disabled: boolean;
  applyLabel?: string;
  onVerify?: (wavBase64: string) => Promise<PickupVerification>;
  onPreview?: (wavBase64: string) => Promise<PunchPreviewResult | false>;
  onSave: (wavBase64: string) => Promise<unknown>;
}) {
  const MAX_RECORDING_SECONDS = 2 * 60 * 60;
  // MediaRecorder can flush one or more timeslice chunks after stop is
  // requested. Stop slightly early so the validated WAV cannot cross the
  // project's hard two-hour boundary while those final chunks arrive.
  const RECORDING_STOP_MARGIN_SECONDS = 1;
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "processing" | "review" | "comparison" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingWav, setPendingWav] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [verification, setVerification] = useState<PickupVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [contextUrls, setContextUrls] = useState<{ current: string; patched: string } | null>(null);
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
  const panelRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => () => {
    if (contextUrls) {
      URL.revokeObjectURL(contextUrls.current);
      URL.revokeObjectURL(contextUrls.patched);
    }
  }, [contextUrls]);

  useEffect(() => {
    if (onPreview) {
      panelRef.current?.focus();
    }
  }, [label, onPreview]);

  async function start() {
    if (
      disabled
      || startingRef.current
      || status === "recording"
      || status === "paused"
      || status === "processing"
      || status === "review"
      || status === "comparison"
    ) {
      return;
    }
    startingRef.current = true;
    setError(null);
    setVerification(null);
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
      setLevel(0);
      if (onVerify) {
        setVerifying(true);
        const result = await onVerify(wavBase64);
        if (!mountedRef.current) {
          return;
        }
        setVerification(result);
        setVerifying(false);
      }
      setStatus("review");
    } catch (reason) {
      if (mountedRef.current) {
        setVerifying(false);
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
        setStatus(onPreview && contextUrls ? "comparison" : "review");
        return;
      }
      setPendingWav(null);
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
      }
      setPendingUrl(null);
      setVerification(null);
      if (contextUrls) {
        URL.revokeObjectURL(contextUrls.current);
        URL.revokeObjectURL(contextUrls.patched);
      }
      setContextUrls(null);
      setStatus("idle");
    } catch (reason) {
      if (mountedRef.current) {
        setStatus(onPreview && contextUrls ? "comparison" : "review");
        setError(messageFor(reason, "Could not save this take."));
      }
    } finally {
      confirmingRef.current = false;
    }
  }

  async function previewTake() {
    if (!pendingWav || !onPreview || confirmingRef.current) {
      return;
    }
    confirmingRef.current = true;
    setStatus("processing");
    setError(null);
    try {
      const result = await onPreview(pendingWav);
      if (!mountedRef.current) {
        return;
      }
      if (!result) {
        setStatus("review");
        return;
      }
      const audioUrl = (base64: string) => {
        const bytes = base64ToBytes(base64);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      };
      if (contextUrls) {
        URL.revokeObjectURL(contextUrls.current);
        URL.revokeObjectURL(contextUrls.patched);
      }
      setContextUrls({
        current: audioUrl(result.currentWavBase64),
        patched: audioUrl(result.patchedWavBase64),
      });
      setStatus("comparison");
    } catch (reason) {
      if (mountedRef.current) {
        setStatus("review");
        setError(messageFor(reason, "Could not build a pickup preview."));
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
    setVerification(null);
    if (contextUrls) {
      URL.revokeObjectURL(contextUrls.current);
      URL.revokeObjectURL(contextUrls.patched);
    }
    setContextUrls(null);
    setStatus("idle");
    setError(null);
  }

  function handleRecorderShortcut(event: React.KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && ["BUTTON", "AUDIO", "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "r" && (status === "idle" || status === "error")) {
      event.preventDefault();
      void start();
    } else if (key === "s" && (status === "recording" || status === "paused")) {
      event.preventDefault();
      stop();
    } else if (event.key === " " && status === "recording") {
      event.preventDefault();
      pause();
    } else if (event.key === " " && status === "paused") {
      event.preventDefault();
      resume();
    } else if (key === "p" && status === "review" && onPreview) {
      event.preventDefault();
      void previewTake();
    } else if (key === "a" && status === "comparison") {
      event.preventDefault();
      void confirmTake();
    } else if (key === "n" && (status === "review" || status === "comparison")) {
      event.preventDefault();
      discardTake();
    }
  }

  const flowStep = contextUrls ? 3 : pendingWav ? 2 : 1;
  const processingLabel = verifying
    ? "Checking words against the manuscript…"
    : contextUrls
      ? "Applying pickup…"
      : pendingWav
        ? "Building the in-context comparison…"
        : "Preparing your take…";

  return (
    <section
      ref={panelRef}
      className={onPreview ? "recorder-panel pickup-recorder-panel" : "recorder-panel"}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleRecorderShortcut}
    >
      {onPreview ? (
        <ol className="pickup-flow-steps" aria-label="Pickup workflow">
          {["Record", "Compare", "Apply"].map((step, index) => {
            const number = index + 1;
            const state = number < flowStep ? "complete" : number === flowStep ? "active" : "upcoming";
            return (
              <li key={step} className={state} aria-current={number === flowStep ? "step" : undefined}>
                <span>{number < flowStep ? "✓" : number}</span><strong>{step}</strong>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="recorder-heading">
        <div>
          <p className="card-kicker">
            {status === "recording" ? "Recording now" : status === "paused" ? "Recording paused" : `Step ${flowStep}`}
          </p>
          <h4>{onPreview ? (flowStep === 1 ? "Capture the pickup" : flowStep === 2 ? "Check your performance" : "Hear the actual edit") : label}</h4>
          {onPreview ? <span className="pickup-recorder-location">{label}</span> : null}
        </div>
        <time>{formatTime(seconds)}</time>
      </div>
      <div className="level-track" aria-label={`recording level ${Math.round(level * 100)} percent`}>
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className="recorder-actions">
        {onPreview ? (
          <>
            {(status === "idle" || status === "error") ? (
              <button className="pickup-record-trigger" type="button" disabled={disabled} onClick={() => void start()}>
                <span className="record-dot" aria-hidden="true" /> Start recording <kbd>R</kbd>
              </button>
            ) : null}
            {status === "recording" ? (
              <>
                <button className="pickup-control-button" type="button" onClick={pause}>Pause <kbd>Space</kbd></button>
                <button className="pickup-stop-button" type="button" onClick={stop}>Stop & review <kbd>S</kbd></button>
              </>
            ) : null}
            {status === "paused" ? (
              <>
                <button className="pickup-control-button" type="button" onClick={resume}>Resume <kbd>Space</kbd></button>
                <button className="pickup-stop-button" type="button" onClick={stop}>Stop & review <kbd>S</kbd></button>
              </>
            ) : null}
            {status === "processing" ? <div className="pickup-processing" role="status">{processingLabel}</div> : null}
          </>
        ) : (
          <>
            <button type="button" disabled={disabled || status === "recording" || status === "paused" || status === "processing" || status === "review" || status === "comparison"} onClick={() => void start()}>Record</button>
            <button type="button" disabled={status !== "recording"} onClick={pause}>Pause</button>
            <button type="button" disabled={status !== "paused"} onClick={resume}>Resume</button>
            <button type="button" disabled={status !== "recording" && status !== "paused"} onClick={stop}>Stop & review</button>
          </>
        )}
      </div>
      {status === "review" && pendingUrl ? (
        <div className="recorder-review">
          <div className="pickup-review-heading"><span>Pickup take</span><strong>Does the performance match?</strong></div>
          {verification ? <PickupWordCheck result={verification} /> : null}
          <audio controls preload="metadata" src={pendingUrl} />
          <div className="recorder-review-actions">
            <button type="button" className="primary-button" onClick={() => void (onPreview ? previewTake() : confirmTake())}>
              {onPreview ? "Compare in context" : "Use this take"}{onPreview ? <kbd>P</kbd> : null}
            </button>
            <button type="button" className="secondary-button" onClick={discardTake}>{onPreview ? "Record again" : "Discard"}</button>
          </div>
        </div>
      ) : null}
      {status === "comparison" && contextUrls ? (
        <div className="recorder-review pickup-context-comparison">
          <div className="pickup-review-heading"><span>Same surrounding audio</span><strong>Which join sounds natural?</strong></div>
          {verification ? <PickupWordCheck result={verification} /> : null}
          <div className="pickup-compare-grid">
            <label>
              <span>Before</span>
              <strong>Current take</strong>
              <audio controls preload="metadata" src={contextUrls.current} />
            </label>
            <label className="candidate">
              <span>After</span>
              <strong>With your pickup</strong>
              <audio controls preload="metadata" src={contextUrls.patched} />
            </label>
          </div>
          <div className="recorder-review-actions">
            <button type="button" className="primary-button pickup-apply-button" onClick={() => void confirmTake()}>
              {verification?.status === "mismatch" ? "Apply anyway" : applyLabel} <kbd>A</kbd>
            </button>
            <button type="button" className="secondary-button" onClick={discardTake}>Record again <kbd>N</kbd></button>
          </div>
        </div>
      ) : null}
      {onPreview ? (
        <details className="pickup-shortcuts">
          <summary>Keyboard shortcuts</summary>
          <p><kbd>L</kbd> lead-in <kbd>R</kbd> record <kbd>Space</kbd> pause <kbd>S</kbd> stop <kbd>P</kbd> compare <kbd>A</kbd> apply <kbd>N</kbd> again</p>
        </details>
      ) : <p className="recorder-honesty">Listen before saving. You can keep this take or record another one.</p>}
      {error ? <p className="recorder-error">{error}</p> : null}
    </section>
  );
}

function PickupWordCheck({ result }: { result: PickupVerification }) {
  return (
    <div className={`pickup-word-check ${result.status}`} role="status">
      <span className="pickup-word-check-icon" aria-hidden="true">
        {result.status === "match" ? "✓" : result.status === "mismatch" ? "!" : "?"}
      </span>
      <div>
        <strong>{result.title}</strong>
        <p>{result.detail}</p>
      </div>
    </div>
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

export function BookPickupPanel({
  summary,
  busyAction,
  selectedChapterId,
  canRead,
  onLoad,
  onOpen,
  onIgnoreAll,
}: {
  summary: BookPickupSummary | null;
  busyAction: string | null;
  selectedChapterId: string | null;
  /** False in the browser preview, where chapters cannot be read from disk. */
  canRead: boolean;
  onLoad: () => void;
  onOpen: (chapterId: string, start?: number) => void;
  onIgnoreAll: (rows: BookPickupRow[]) => void;
}) {
  const busy = busyAction !== null;
  const loading = busyAction === "book-pickups";
  const requested = useRef(false);

  // Arriving at a panel called "everything still open" and finding it empty
  // until you press a button is a riddle. Read the book once, on arrival.
  useEffect(() => {
    if (canRead && summary === null && !requested.current) {
      requested.current = true;
      onLoad();
    }
  }, [canRead, onLoad, summary]);

  return (
    <section className="phase-panel book-panel" aria-labelledby="book-pickups-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Whole book</p>
          <h3 id="book-pickups-title">Everything still open</h3>
        </div>
        <button className="action-button" type="button" disabled={busy || !canRead} onClick={onLoad}>
          {loading ? "Reading…" : "Refresh"}
        </button>
      </header>
      <p className="panel-honesty">
        Flags from every chapter you have checked, in reading order. Chapters you have not checked
        yet are listed but have nothing to show.
      </p>
      {summary === null ? (
        <div className="panel-empty">
          {!canRead
            ? "The whole-book list needs the desktop app, where the chapters live."
            : loading
              ? "Reading every chapter…"
              : "Press Refresh to read every chapter."}
        </div>
      ) : (
        <div className="book-pickups">
          <div className="book-tally">
            <span><strong>{summary.openCount}</strong> still open</span>
            <span><strong>{summary.resolvedCount}</strong> handled</span>
            {summary.uncheckedChapters.length > 0 ? (
              <span className="quiet">
                <strong>{summary.uncheckedChapters.length}</strong>
                {summary.uncheckedChapters.length === 1 ? " chapter" : " chapters"} recorded but not checked
              </span>
            ) : null}
          </div>

          {summary.repeated.length > 0 ? (
            <div className="book-repeat-block">
              <h4>One word, flagged again and again</h4>
              <p>Usually one decision rather than {summary.repeated[0].count} separate ones.</p>
              <ul className="book-repeats">
                {summary.repeated.map((group) => (
                  <li key={group.word}>
                    <span>
                      <strong>{group.word}</strong>
                      {" · "}
                      {group.count} places in {group.chapters}
                      {group.chapters === 1 ? " chapter" : " chapters"}
                    </span>
                    <button
                      className="action-button small"
                      type="button"
                      disabled={busy}
                      onClick={() => onIgnoreAll(group.rows)}
                    >
                      Fine as read in all {group.count}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.openCount === 0 ? (
            <p className="result-empty">Nothing is open in the chapters you have checked.</p>
          ) : (
            <ul className="book-pickup-list">
              {summary.open.map((row) => (
                <li key={row.pickup.id} className={row.chapterId === selectedChapterId ? "current" : ""}>
                  <button
                    className="book-pickup-open"
                    type="button"
                    disabled={busy}
                    onClick={() => onOpen(row.chapterId, row.pickup.t_start)}
                  >
                    <span className="book-pickup-where">
                      {row.chapterTitle}
                      <time>{formatTime(row.pickup.t_start)}</time>
                    </span>
                    <span className="pickup-reading">{pickupReading(row.pickup)}</span>
                    <span className={`kind-badge kind-tone-${pickupKindPresentation(row.pickup.kind).tone}`}>
                      {pickupKindPresentation(row.pickup.kind).label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="book-progress-block">
            <h4>Chapter by chapter</h4>
            <ul className="book-progress">
              {summary.chapters.map((chapter) => (
                <li key={chapter.chapterId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpen(chapter.chapterId)}
                  >
                    <span>{chapter.chapterTitle}</span>
                    <span className={chapterProgressTone(chapter)}>
                      {!chapter.hasAudio
                        ? "no recording yet"
                        : !chapter.checked
                          ? "check it against the page"
                          : chapter.open === 0
                            ? "clear"
                            : `${chapter.open} open`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function chapterProgressTone(chapter: ChapterProgress): string {
  if (!chapter.hasAudio) {
    return "progress-state waiting";
  }
  if (!chapter.checked) {
    return "progress-state todo";
  }
  return chapter.open === 0 ? "progress-state clear" : "progress-state open";
}

export function BookWordScanner({
  word,
  report,
  guide,
  suggestions,
  busyAction,
  onWord,
  onScan,
  onOpenOccurrence,
  onAddToGuide,
  onPickSuggestion,
}: {
  word: string;
  report: BookScanReport | null;
  /** The pronunciation this book already agreed on, if the word is in the guide. */
  guide: GlossaryEntry | null;
  /** Names worth checking, so the search box is not a blank page. */
  suggestions: string[];
  busyAction: string | null;
  onWord: (value: string) => void;
  onScan: () => void;
  onOpenOccurrence: (chapterId: string, start?: number) => void;
  onAddToGuide: (word: string, respell: string) => void;
  onPickSuggestion: (word: string) => void;
}) {
  const spoken = report?.readings.filter((group) => group.occurrences[0]?.readingKey !== "#no-audio") ?? [];
  const unchecked = report?.readings.filter((group) => group.occurrences[0]?.readingKey === "#no-audio") ?? [];
  const agreed = guide?.respell?.trim() ? plainLetters(guide.respell) : "";

  return (
    <section className="phase-panel" aria-labelledby="scan-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Consistency</p>
          <h3 id="scan-title">Scan the whole book</h3>
        </div>
      </header>
      <p className="panel-honesty">
        Find every place a name appears and compare how it was read each time. Only chapters you have
        already checked against audio can be compared.
      </p>
      <div className="scan-controls">
        <input
          type="search"
          value={word}
          placeholder="A name or phrase, such as Leominster"
          aria-label="Word or phrase to scan for"
          onChange={(event) => onWord(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onScan();
            }
          }}
        />
        <button
          className="action-button primary"
          type="button"
          disabled={busyAction !== null || word.trim().length === 0}
          onClick={onScan}
        >
          {busyAction === "scan-occurrences" ? "Scanning…" : "Scan the book"}
        </button>
      </div>
      {suggestions.length > 0 ? (
        <div className="scan-suggestions">
          <span>Names in your guide:</span>
          {suggestions.map((candidate) => (
            <button
              key={candidate}
              className="action-button small"
              type="button"
              disabled={busyAction !== null}
              onClick={() => onPickSuggestion(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
      ) : null}
      {report === null ? null : report.totalOccurrences === 0 ? (
        <p className="result-empty">“{report.word}” does not appear in this book.</p>
      ) : (
        <div className="scan-results">
          {/* Say what was found before listing where. */}
          <div className={`scan-verdict ${report.consistent ? "steady" : "split"}`}>
            <div>
              <strong>
                {report.checkedOccurrences === 0
                  ? `“${report.word}” has not been read on tape yet.`
                  : report.consistent
                    ? `“${report.word}” is read the same way every time.`
                    : `“${report.word}” is read ${spoken.length} different ways.`}
              </strong>
              <span>
                {report.totalOccurrences} {report.totalOccurrences === 1 ? "place" : "places"} in the
                manuscript, {report.checkedOccurrences} checked against audio
                {report.chaptersWithoutAudio.length > 0
                  ? `. Still to check: ${report.chaptersWithoutAudio.join(", ")}.`
                  : "."}
              </span>
            </div>
            <div className="scan-verdict-guide">
              {guide?.respell?.trim() ? (
                <span className="scan-guide-chip">Guide says <strong>{guide.respell}</strong></span>
              ) : (
                <button
                  className="action-button small"
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => onAddToGuide(report.word, spoken[0]?.heard ?? "")}
                >
                  {guide ? "Set a respelling" : "Add to the pronunciation guide"}
                </button>
              )}
            </div>
          </div>

          {spoken.map((group) => {
            const matchesGuide = agreed !== "" && plainLetters(group.heard) === agreed;
            return (
              <div className="scan-group" key={group.heard}>
                <h4>
                  Heard as “{group.heard}” · {group.count}
                  {group.count === 1 ? " time" : " times"}
                  {matchesGuide ? <span className="scan-match">matches your guide</span> : null}
                </h4>
                <ul>
                  {group.occurrences.map((occurrence) => (
                    <li key={`${occurrence.chapterId}-${occurrence.offset}`}>
                      <button
                        className="action-button small"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onOpenOccurrence(occurrence.chapterId, occurrence.start)}
                      >
                        {occurrence.start === undefined ? "Open" : "Listen"} · {occurrence.chapterTitle}
                        {occurrence.start === undefined ? "" : ` ${formatTime(occurrence.start)}`}
                      </button>
                      <span>{occurrence.context}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {unchecked.map((group) => (
            <div className="scan-group quiet" key="unchecked">
              <h4>
                Not checked against audio yet · {group.count}
                {group.count === 1 ? " place" : " places"}
              </h4>
              <ul>
                {group.occurrences.map((occurrence) => (
                  <li key={`${occurrence.chapterId}-${occurrence.offset}`}>
                    <button
                      className="action-button small"
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => onOpenOccurrence(occurrence.chapterId, occurrence.start)}
                    >
                      Open · {occurrence.chapterTitle}
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

/** The names most worth a consistency pass: the ones said most often. */
function scanSuggestions(glossary: GlossaryEntry[]): string[] {
  return [...glossary]
    .sort((left, right) => right.frequency - left.frequency)
    .slice(0, 6)
    .map((entry) => entry.spelling);
}

/** Letters only, so “LEM-ster” and “Lemster” can be compared. */
function plainLetters(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z]/g, "");
}

function glossaryEntryFor(glossary: GlossaryEntry[], word: string): GlossaryEntry | null {
  const wanted = word.trim().toLocaleLowerCase("en-US");
  if (wanted === "") {
    return null;
  }
  return glossary.find((entry) => entry.spelling.trim().toLocaleLowerCase("en-US") === wanted) ?? null;
}

export function GlossaryPanel({
  glossary,
  spelling,
  respell,
  busyAction,
  onSpelling,
  onRespell,
  onAdd,
  onRefresh,
  onSuggestRespells,
  onExportGuide,
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
  onSuggestRespells: () => void;
  onExportGuide: () => void;
  onRename: (id: string, spelling: string, respell: string, voiceNote: string) => void;
  onDelete: (id: string) => void;
  onAttachClip: (id: string) => void;
  onPlayClip: (entry: GlossaryEntry) => void;
  onRecordClip: (entry: GlossaryEntry) => void;
}) {
  const undecided = glossary.filter((entry) => !entry.respell?.trim()).length;
  return (
    <section className="phase-panel glossary-panel" aria-labelledby="glossary-panel-title">
      <header className="panel-heading">
        <div>
          <p className="card-kicker">Pronunciation</p>
          <h3 id="glossary-panel-title">Pronunciation guide</h3>
        </div>
        <div className="panel-heading-actions">
          {undecided > 0 ? (
            <button
              type="button"
              className="action-button primary"
              disabled={busyAction !== null}
              onClick={onSuggestRespells}
            >
              {busyAction === "glossary-respells"
                ? "Looking them up…"
                : `Fill ${undecided} from the dictionary`}
            </button>
          ) : null}
          <button
            type="button"
            className="action-button"
            disabled={busyAction !== null || glossary.length === 0}
            onClick={onExportGuide}
          >
            Export voice guide
          </button>
          <details className="pickup-more">
            <summary>More</summary>
            <div className="pickup-more-menu">
              <button type="button" className="action-button small plain" disabled={busyAction !== null} onClick={onRefresh}>
                Look for new names in the manuscript
              </button>
            </div>
          </details>
        </div>
      </header>
      <p className="panel-honesty">
        Add names and tricky words so everyone says them the same way. The voice note is for
        how a name should sound — accent, age, attitude — and rides along to the narrator.
      </p>
      {glossary.length > 0 ? (
        <div className="book-tally">
          <span><strong>{glossary.length}</strong> {glossary.length === 1 ? "word" : "words"}</span>
          {undecided > 0 ? (
            <span className="quiet"><strong>{undecided}</strong> still without a respelling</span>
          ) : (
            <span><strong>Every word</strong> has a respelling</span>
          )}
        </div>
      ) : null}

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
              <tr><th>Spelling</th><th>Respell</th><th>Voice</th><th>Count</th><th>Source</th><th /></tr>
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
  onRename: (id: string, spelling: string, respell: string, voiceNote: string) => void;
  onDelete: (id: string) => void;
  onAttachClip: (id: string) => void;
  onPlayClip: (entry: GlossaryEntry) => void;
  onRecordClip: (entry: GlossaryEntry) => void;
}) {
  const [spelling, setSpelling] = useState(entry.spelling);
  const [respell, setRespell] = useState(entry.respell ?? "");
  const [voiceNote, setVoiceNote] = useState(entry.voice_note ?? "");

  useEffect(() => {
    setSpelling(entry.spelling);
    setRespell(entry.respell ?? "");
    setVoiceNote(entry.voice_note ?? "");
  }, [entry.spelling, entry.respell, entry.voice_note]);

  const edited = spelling !== entry.spelling
    || respell !== (entry.respell ?? "")
    || voiceNote !== (entry.voice_note ?? "");
  const save = () => {
    if (edited && spelling.trim().length > 0) {
      onRename(entry.id, spelling, respell, voiceNote);
    }
  };
  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
  };

  return (
    <tr className={edited ? "edited" : ""}>
      <td>
        <input
          value={spelling}
          aria-label="Spelling"
          onChange={(event) => setSpelling(event.target.value)}
          onKeyDown={onEnter}
        />
      </td>
      <td>
        <input
          value={respell}
          aria-label="Respelling"
          onChange={(event) => setRespell(event.target.value)}
          onKeyDown={onEnter}
        />
        {respell.trim() === "" ? <span className="glossary-needed">needs one</span> : null}
      </td>
      <td>
        <input
          value={voiceNote}
          aria-label="Voice note"
          onChange={(event) => setVoiceNote(event.target.value)}
          onKeyDown={onEnter}
        />
      </td>
      <td>{entry.frequency}</td>
      <td>{entry.source === "auto" ? "from the book" : "added by hand"}</td>
      <td className="glossary-actions">
        {/* Nothing to save, nothing to show: the button appears with the edit. */}
        {edited ? (
          <button
            type="button"
            className="action-button small accent"
            disabled={busy || spelling.trim().length === 0}
            onClick={save}
          >
            Save
          </button>
        ) : null}
        {entry.clip_path ? (
          <button className="action-button small" type="button" disabled={busy} onClick={() => onPlayClip(entry)}>
            Play
          </button>
        ) : null}
        <details className="pickup-more">
          <summary aria-label={`More for ${entry.spelling}`}>More</summary>
          <div className="pickup-more-menu">
            <button className="action-button small plain" type="button" disabled={busy} onClick={() => onRecordClip(entry)}>
              Record how it sounds
            </button>
            <button className="action-button small plain" type="button" disabled={busy} onClick={() => onAttachClip(entry.id)}>
              {entry.clip_path ? "Replace the clip from a file" : "Add a clip from a file"}
            </button>
            <button className="action-button small danger" type="button" disabled={busy} onClick={() => onDelete(entry.id)}>
              Remove “{entry.spelling}”
            </button>
          </div>
        </details>
      </td>
    </tr>
  );
}

const CONFIDENCE_CHOICES: Record<string, number> = { every: 0, balanced: 0.35, strict: 0.6 };
type ConfidenceChoice = "every" | "balanced" | "strict" | "custom";

function confidenceChoice(value: number): ConfidenceChoice {
  for (const [name, floor] of Object.entries(CONFIDENCE_CHOICES)) {
    if (Math.abs(value - floor) < 0.001) {
      return name as ConfidenceChoice;
    }
  }
  return "custom";
}

export function SettingsPanel({
  settings,
  busyAction,
  updateStatus = null,
  onChange,
}: {
  settings: ProjectSettings;
  busyAction: string | null;
  updateStatus?: AppUpdateStatus | null;
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
        <span className={`status-pill ${dirty ? "" : "attached"}`}>
          {dirty ? "Not saved yet" : "Saved"}
        </span>
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
          When the recogniser is unsure
          {/* A raw 0–0.9 threshold means nothing to a narrator; the three
            * choices people actually want do. Anything else stays as typed. */}
          <select
            value={confidenceChoice(draft.proof_confidence_floor)}
            onChange={(event) => setDraft({
              ...draft,
              proof_confidence_floor: CONFIDENCE_CHOICES[event.target.value]
                ?? draft.proof_confidence_floor,
            })}
          >
            <option value="every">Show me every alert</option>
            <option value="balanced">Skip the shakiest alerts · recommended</option>
            <option value="strict">Only alerts it is confident about</option>
            {confidenceChoice(draft.proof_confidence_floor) === "custom" ? (
              <option value="custom">Custom · {draft.proof_confidence_floor.toFixed(2)}</option>
            ) : null}
          </select>
          <small>
            A shaky alert usually means the recogniser misheard, not that you misread. Alerts are
            always kept when the engine reports no confidence at all.
          </small>
        </label>
        <label>
          ACX target RMS (dBFS)
          <input type="number" min="-23" max="-18" step="0.5" value={draft.acx_target_rms_dbfs} onChange={(event) => setDraft({ ...draft, acx_target_rms_dbfs: Number(event.target.value) })} />
          <small>Default −20 dBFS; the measured pass window remains −23 to −18.</small>
        </label>
        <div className="settings-word-filter">
          <span className="settings-word-filter-label">Words this book never flags</span>
          {draft.suppressed_words.length === 0 ? (
            <small>None yet. A pickup’s “Never flag this word” adds one.</small>
          ) : (
            <ul>
              {draft.suppressed_words.map((word) => (
                <li key={word}>
                  <span>{word}</span>
                  <button
                    type="button"
                    title={`Flag ${word} again`}
                    aria-label={`Flag ${word} again`}
                    onClick={() => setDraft({
                      ...draft,
                      suppressed_words: draft.suppressed_words.filter((candidate) => candidate !== word),
                    })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <small>Skipped when a chapter is checked. Re-check a chapter to apply a change there.</small>
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
        <label>
          Highlight as you read
          <select value={draft.teleprompter_highlight} onChange={(event) => setDraft({ ...draft, teleprompter_highlight: event.target.value as ProjectSettings["teleprompter_highlight"] })}>
            <option value="word">Word by word</option>
            <option value="line">Line by line</option>
            <option value="paragraph">Paragraph by paragraph</option>
          </select>
          <small>
            Word by word is the most precise. The wider choices are easier to follow and never
            move ahead of what you have read.
          </small>
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
        <button className="action-button primary" type="button" disabled={!dirty || busyAction !== null} onClick={() => onChange(draft)}>
          {busyAction === "settings" ? "Saving…" : "Save settings"}
        </button>
        <button className="action-button" type="button" disabled={!dirty || busyAction !== null} onClick={() => setDraft(settings)}>
          Discard changes
        </button>
      </div>
      <div className="settings-readonly update-settings">
        <span>Kosmos version</span>
        <strong>{updateStatus?.currentVersion ?? "This copy"}</strong>
        <small>{settingsUpdateCopy(updateStatus)}</small>
        <div className="settings-update-actions">
          <button
            className="action-button"
            type="button"
            disabled={!window.boothDesk?.checkAppUpdate}
            onClick={() => void window.boothDesk?.checkAppUpdate()}
          >
            Check for updates
          </button>
          {updateStatus?.canInstall ? (
            <button
              className="action-button primary"
              type="button"
              onClick={() => void window.boothDesk?.installAppUpdate()}
            >
              Restart to update
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function CollaborationPanel({
  project,
  identity,
  identityLoaded,
  identityName,
  identityRole,
  identitySeat,
  chapterNote,
  selectedChapterId,
  busyAction,
  onIdentityName,
  onIdentityRole,
  onIdentitySeat,
  onChapterNote,
  onSaveIdentity,
  collabPhase,
  collabInvite,
  collabWords,
  collabReply,
  collabPaste,
  collabPeer,
  collabConflicts,
  onCollabPaste,
  onCreateInvite,
  onJoinInvite,
  onAcceptReply,
  onHangUp,
  onSaveNote,
  onStatus,
  onSelectChapter,
  onMode,
}: {
  project: ProjectFile;
  identity: LocalIdentity | null;
  identityLoaded: boolean;
  identityName: string;
  identityRole: "author" | "narrator";
  identitySeat: "N1" | "N2";
  chapterNote: string;
  selectedChapterId: string | null;
  busyAction: string | null;
  onIdentityName: (value: string) => void;
  onIdentityRole: (value: "author" | "narrator") => void;
  onIdentitySeat: (value: "N1" | "N2") => void;
  onChapterNote: (value: string) => void;
  onSaveIdentity: () => void;
  collabPhase: string;
  collabInvite: string | null;
  collabWords: string | null;
  collabReply: string | null;
  collabPaste: string;
  collabPeer: { name: string; role: string } | null;
  collabConflicts: MergeConflict[];
  onCollabPaste: (value: string) => void;
  onCreateInvite: () => void;
  onJoinInvite: () => void;
  onAcceptReply: () => void;
  onHangUp: () => void;
  onSaveNote: () => void;
  onStatus: (status: AuthorStatus) => void;
  onSelectChapter: (id: string) => void;
  onMode: (mode: "solo" | "duet") => void;
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
        <span className={`status-pill ${collabPhase === "connected" ? "attached" : ""}`}>
          {collabPhase === "connected" && collabPeer
            ? `${collabPeer.name} is here`
            : identity ? `${identity.personName} · ${identity.role}` : "Role not set"}
        </span>
      </header>
      <p className="panel-honesty">
        Add your role, then invite the other desk. Flags and takes stay on this machine.
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

        <div className="collaboration-card live-collab-card wide">
          <h4>Live together</h4>
          <p>
            Send an invite. They paste it. You both say the three words. Flags, notes, and
            new takes appear on each desk while Kosmos is open. Nothing is uploaded.
          </p>
          <label>
            Voice mode
            <select value={project.mode} onChange={(event) => onMode(event.target.value as "solo" | "duet")}>
              <option value="solo">Solo narration</option>
              <option value="duet">Duet · characters keep their narrator</option>
            </select>
          </label>
          <div className="live-collab-status">
            <span className={`status-pill ${collabPhase === "connected" ? "attached" : ""}`}>
              {collabPhase === "connected" && collabPeer
                ? `${collabPeer.name} is here`
                : collabPhase === "inviting"
                  ? "Waiting for their reply"
                  : collabPhase === "joining"
                    ? "Send the reply back"
                    : "Not connected"}
            </span>
            {collabWords ? <span className="live-collab-words">{collabWords}</span> : null}
          </div>
          <div className="live-collab-actions">
            <button
              className="action-button primary"
              type="button"
              disabled={busyAction !== null || !identity}
              onClick={onCreateInvite}
            >
              {busyAction === "collab-invite" ? "Preparing invite…" : "Create invite"}
            </button>
            <button
              className="action-button"
              type="button"
              disabled={busyAction !== null || !identity || collabPaste.trim().length === 0}
              onClick={collabPaste.trim().startsWith("KOSMOS1R") ? onAcceptReply : onJoinInvite}
            >
              {busyAction === "collab-join" || busyAction === "collab-reply"
                ? "Connecting…"
                : collabPaste.trim().startsWith("KOSMOS1R")
                  ? "Paste their reply"
                  : "Join with a code"}
            </button>
            {collabPhase !== "idle" ? (
              <button className="action-button" type="button" onClick={onHangUp}>Leave</button>
            ) : null}
          </div>
          <label>
            Paste a code
            <textarea
              rows={3}
              value={collabPaste}
              onChange={(event) => onCollabPaste(event.target.value)}
              placeholder="KOSMOS1-…"
            />
          </label>
          {collabInvite ? (
            <div className="live-collab-code">
              <p>Send this invite</p>
              <textarea readOnly rows={4} value={collabInvite} />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(collabInvite)}
              >
                Copy invite
              </button>
            </div>
          ) : null}
          {collabReply ? (
            <div className="live-collab-code">
              <p>Send this reply back</p>
              <textarea readOnly rows={4} value={collabReply} />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(collabReply)}
              >
                Copy reply
              </button>
            </div>
          ) : null}
          {collabConflicts.length > 0 ? (
            <div className="pack-conflicts">
              <h5>
                {collabConflicts.length}
                {collabConflicts.length === 1 ? " disagreement" : " disagreements"}
                {" · your copy kept"}
              </h5>
              <ul className="pack-review-list conflicts">
                {collabConflicts.map((conflict, index) => (
                  <li key={`${conflict.kind}-${conflict.chapterId}-${index}`}>
                    {conflictLabel(conflict)}
                  </li>
                ))}
              </ul>
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
              {/* A chapter is in one state, so show which one it is in. */}
              <div className="segmented" role="group" aria-label="Chapter status">
                {(["needs_pickup", "approved", "ignore_this_flag"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={selected?.author_status === status ? "selected" : ""}
                    aria-pressed={selected?.author_status === status}
                    disabled={!authorCanApprove || busyAction !== null}
                    onClick={() => onStatus(status)}
                  >
                    {status === "needs_pickup" ? "Needs a pickup" : status === "approved" ? "Approved" : "Leave as is"}
                  </button>
                ))}
              </div>
              {selected && selected.author_status === "draft" ? (
                <p className="segmented-note">Not marked yet.</p>
              ) : null}
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
      <div className="record-main">
        <article className="surface-card record-teleprompter-entry">
          <p className="card-kicker">Read with the manuscript</p>
          <h3>Teleprompter</h3>
          <p className="panel-honesty">Read naturally while Kosmos follows the highlighted line. Stop, listen, name the recording, then save it for Continue or Review.</p>
          <div className="desk-actions">
            <button
              className="primary-button"
              type="button"
              disabled={chapterText.trim().length === 0 || busyAction !== null}
              onClick={onOpenTeleprompter}
            >
              Open teleprompter
            </button>
          </div>
        </article>

        <article className="surface-card">
          <header className="chapter-desk-heading">
            <div>
              <p className="card-kicker">Now reading</p>
              <h3>{chapter.title}</h3>
            </div>
          </header>
          <p className="manuscript-body">{chapterText || "Loading manuscript…"}</p>
        </article>

        <article className="surface-card">
          <header className="chapter-desk-heading">
            <div>
              <p className="card-kicker">Brought in</p>
              <h3>Chapter take</h3>
            </div>
            <span className={chapter.audio_path ? "status-pill attached" : "status-pill"}>
              {chapter.audio_path ? "File ready" : "No file yet"}
            </span>
          </header>
          <p className="panel-honesty">Add a file you already recorded, or capture one here. This is the take Review can splice into.</p>
          {chapter.audio_path && audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
          <div className="desk-actions">
            <button className="action-button" type="button" disabled={busyAction !== null} onClick={() => onAttach(chapter)}>
              {chapter.audio_path ? "Replace file" : "Add a file"}
            </button>
          </div>
          <RecorderPanel
            label="Record a take"
            disabled={!window.boothDesk || busyAction !== null}
            onSave={onSaveRecording}
          />
        </article>
      </div>

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
  pronunciationEntries,
  busyAction,
  audioUrl,
  audioRef,
  proof,
  modelAvailable,
  modelProgress,
  onDownloadModel,
  onProof,
  onFinalProof,
  reviewSourceKind,
  checkedSourceKind,
  onReviewSourceKind,
  onAttach,
  onOpenBooth,
  onPlayPickup,
  listenDisabledReason,
  punchDisabledReason,
  onPlayRange,
  onPlaySelection,
  onExportMarkers,
  onExportReport,
  onExportPacket,
  onPunchPickup,
  onStartPickupSession,
  onUpdatePickup,
  onSuppressPickup,
  pickupSeatFilter,
  onPickupSeatFilter,
  comparisonFolder,
  comparisons,
  onVerifyComparison,
  onUndoLatestPickup,
  selectionOverlayOpen,
}: {
  chapter: ChapterFile;
  chapterText: string;
  pronunciationEntries: GlossaryEntry[];
  busyAction: string | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  proof: ProofResult | null;
  modelAvailable: boolean | null;
  modelProgress: number;
  onDownloadModel: () => void;
  onProof: () => void;
  onFinalProof: () => void;
  reviewSourceKind: ProofSourceKind | null;
  checkedSourceKind: ProofSourceKind | null;
  onReviewSourceKind: (kind: ProofSourceKind) => void;
  onAttach: () => void;
  onOpenBooth: () => void;
  onPlayPickup: (pickup: Pickup) => void;
  listenDisabledReason?: (pickup: Pickup) => string | null;
  punchDisabledReason?: (pickup: Pickup) => string | null;
  onPlayRange: (start: number, end?: number) => void;
  onPlaySelection: (start: number, end: number) => void;
  onExportMarkers: () => void;
  onExportReport: () => void;
  onExportPacket: () => void;
  onPunchPickup: (pickup: Pickup) => void;
  onStartPickupSession: (pickups: Pickup[]) => void;
  onUpdatePickup: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void;
  onSuppressPickup: (pickup: Pickup) => void;
  pickupSeatFilter: "all" | "narration" | "N1" | "N2";
  onPickupSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void;
  comparisonFolder: string;
  comparisons: PickupComparison[];
  onVerifyComparison: (id: string) => void;
  onUndoLatestPickup: () => void;
  selectionOverlayOpen: boolean;
}) {
  const [redoSelection, setRedoSelection] = useState<{
    ranges: NarrationRedoRanges;
    scope: NarrationRedoScope;
  } | null>(null);
  const [redoReason, setRedoReason] = useState("");
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [quickRecordPosition, dispatchSelectionAction] = useReducer(selectionActionReducer, null);
  const quickRecordPopoverRef = useRef<HTMLDivElement>(null);
  const sources = availableProofSources(chapter);
  const selectedKind = reviewSourceKind ?? proofAudioSource(chapter)?.kind ?? null;
  const alignedTokens = useMemo(
    () => proof ? alignedManuscriptTokens(chapterText, proof.transcript) : [],
    [chapterText, proof?.transcript],
  );
  const manuscriptAnnotations = useMemo<ManuscriptProofAnnotation[]>(() => {
    if (!proof) {
      return [];
    }
    return proof.pickups.filter((pickup) => pickup.status === "open").flatMap((pickup) => {
      const midpoint = (pickup.t_start + pickup.t_end) / 2;
      const expectedWords = tokenizeManuscript(pickup.expected).map((token) => normalizeToken(token.text));
      const lineWords = tokenizeManuscript(pickup.line_text ?? "").map((token) => normalizeToken(token.text));
      const lineStart = lineWords.length > 0
        ? alignedTokens.find((token) => lineWords.every((written, offset) => (
            normalizeToken(alignedTokens[token.tokenIndex + offset]?.written ?? "") === written
          )))?.tokenIndex
        : undefined;
      const lineEnd = lineStart !== undefined ? lineStart + lineWords.length - 1 : undefined;
      const inPickupLine = (tokenIndex: number) => (
        lineStart === undefined
        || lineEnd === undefined
        || (tokenIndex >= lineStart && tokenIndex <= lineEnd)
      );
      const writtenMatch = expectedWords.length > 0
        ? alignedTokens
            .filter((token) => normalizeToken(token.written) === expectedWords[0])
            .filter((token) => expectedWords.every((expected, offset) => (
              normalizeToken(alignedTokens[token.tokenIndex + offset]?.written ?? "") === expected
            )))
            .filter((token) => inPickupLine(token.tokenIndex))
            .sort((left, right) => {
              const leftMidpoint = left.start !== undefined && left.end !== undefined
                ? (left.start + left.end) / 2
                : Number.POSITIVE_INFINITY;
              const rightMidpoint = right.start !== undefined && right.end !== undefined
                ? (right.start + right.end) / 2
                : Number.POSITIVE_INFINITY;
              return Math.abs(leftMidpoint - midpoint) - Math.abs(rightMidpoint - midpoint);
            })[0]
        : undefined;
      const nearest = alignedTokens
        .filter((token) => inPickupLine(token.tokenIndex))
        .filter((token) => token.start !== undefined && token.end !== undefined)
        .sort((left, right) => {
          const leftMidpoint = ((left.start as number) + (left.end as number)) / 2;
          const rightMidpoint = ((right.start as number) + (right.end as number)) / 2;
          return Math.abs(leftMidpoint - midpoint) - Math.abs(rightMidpoint - midpoint);
        })[0];
      const indexed = Number.isFinite(pickup.manuscript_index)
        ? alignedTokens.find((token) => token.tokenIndex === pickup.manuscript_index)
        : undefined;
      const indexedMatchesExpected = indexed && expectedWords.length > 0
        ? expectedWords.every((expected, offset) => (
            normalizeToken(alignedTokens[indexed.tokenIndex + offset]?.written ?? "") === expected
          ))
        : false;
      // Old projects can contain indexes saved against an earlier manuscript.
      // Prefer a verified phrase match; only trust an index when the written
      // words still agree, then use audio timing as the final fallback.
      const tokenIndex = writtenMatch?.tokenIndex
        ?? nearest?.tokenIndex
        ?? lineStart
        ?? (indexedMatchesExpected ? indexed?.tokenIndex : undefined)
        ?? indexed?.tokenIndex;
      if (tokenIndex === undefined) {
        return [];
      }
      const kind: ManuscriptProofAnnotation["kind"] = pickup.intent === "performance"
        ? "performance"
        : pickup.kind;
      const expectedLabel = pickup.expected.length > 96
        ? `${pickup.expected.slice(0, 93).trimEnd()}…`
        : pickup.expected;
      const heardLabel = pickup.heard.length > 72
        ? `${pickup.heard.slice(0, 69).trimEnd()}…`
        : pickup.heard;
      const label = pickup.intent === "performance"
        ? (pickup.note || "Narrator performance redo")
        : pickup.kind === "skip"
          ? `Missed: ${expectedLabel}`
          : pickup.kind === "insert"
            ? `Added: ${heardLabel}`
            : pickup.kind === "pause"
              ? "Long pause"
              : `Misread: ${expectedLabel} → ${heardLabel}`;
      return [{ id: pickup.id, tokenIndex, kind, label, status: pickup.status }];
    });
  }, [alignedTokens, proof?.pickups]);
  const selectedRedoRange = redoSelection?.ranges[redoSelection.scope] ?? null;
  const quickRecordRange = redoSelection?.ranges.selection ?? null;
  const startRedoRecording = (range: NarrationRedoRange, reason = "") => {
    if (!selectedKind || range.timing === "unavailable") {
      return;
    }
    const pickup = createNarratorRedoPickup({
      chapterId: chapter.id,
      range,
      sourceKind: selectedKind,
      reason,
    });
    window.getSelection()?.removeAllRanges();
    dispatchSelectionAction({ type: "dismiss", reason: "overlay-open" });
    onPunchPickup(pickup);
  };

  useEffect(() => {
    if (!quickRecordPosition) {
      return undefined;
    }
    const dismissQuickAction = () => dispatchSelectionAction({ type: "dismiss", reason: "viewport-change" });
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && quickRecordPopoverRef.current?.contains(target)) {
        return;
      }
      dispatchSelectionAction({ type: "dismiss", reason: "outside-pointer" });
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    window.addEventListener("scroll", dismissQuickAction, true);
    window.addEventListener("resize", dismissQuickAction);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer, true);
      window.removeEventListener("scroll", dismissQuickAction, true);
      window.removeEventListener("resize", dismissQuickAction);
    };
  }, [quickRecordPosition]);

  useEffect(() => {
    if (!selectionOverlayOpen) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    dispatchSelectionAction({ type: "dismiss", reason: "overlay-open" });
  }, [selectionOverlayOpen]);
  const showPickupOnPage = (pickup: Pickup) => {
    setFocusedAnnotationId(pickup.id);
    window.requestAnimationFrame(() => {
      const mark = [...document.querySelectorAll<HTMLElement>("[data-annotation-ids]")]
        .find((element) => (element.dataset.annotationIds ?? "").split(" ").includes(pickup.id));
      mark?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
  };
  const staleFlags = Boolean(
    proof
    && checkedSourceKind
    && selectedKind
    && checkedSourceKind !== selectedKind,
  );
  const manuscriptCoverage = proof && checkedSourceKind === selectedKind
    ? recordedManuscriptCoverage(chapterText, proof.transcript)
    : 0;
  const reviewPronunciationChecks = useMemo(() => proof ? checkChapterPronunciations({
    chapterId: chapter.id,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    manuscript: chapterText,
    transcript: proof.transcript,
    entries: pronunciationEntries,
  }) : [], [chapter.id, chapter.index, chapter.title, chapterText, proof, pronunciationEntries]);
  const reviewPronunciationAttention = reviewPronunciationChecks.filter((check) => check.status !== "matches").length;
  return (
    <div className="review-page">
      <article className="surface-card review-listen-card">
        <header className="chapter-desk-heading">
          <div>
            <p className="card-kicker">Listen against the page</p>
            <h3>{chapter.title}</h3>
            <p className="panel-honesty">Pick the recording to check against the page.</p>
          </div>
        </header>
        <div className="review-source-split">
          <section className={selectedKind === "live" ? "review-source selected" : "review-source"}>
            <p className="paper-kicker">Recorded here</p>
            <strong>{sources.live ? (chapter.live_audio_name ?? "Booth read") : "No booth read yet"}</strong>
            <p>The read from Open the page.</p>
            {sources.live ? (
              <button
                className="action-button small"
                type="button"
                disabled={busyAction !== null || selectedKind === "live"}
                onClick={() => onReviewSourceKind("live")}
              >
                {selectedKind === "live" ? "Using this" : "Use this"}
              </button>
            ) : (
              <button className="action-button small" type="button" disabled={busyAction !== null} onClick={onOpenBooth}>
                Open the page
              </button>
            )}
          </section>
          <section className={selectedKind === "take" ? "review-source selected" : "review-source"}>
            <p className="paper-kicker">Brought in</p>
            <strong>{sources.take ? "Uploaded take" : "No file yet"}</strong>
            <p>A recording from Reaper, your phone, or another booth.</p>
            <div className="review-source-actions">
              {sources.take ? (
                <button
                  className="action-button small"
                  type="button"
                  disabled={busyAction !== null || selectedKind === "take"}
                  onClick={() => onReviewSourceKind("take")}
                >
                  {selectedKind === "take" ? "Using this" : "Use this"}
                </button>
              ) : null}
              <button className="action-button small" type="button" disabled={busyAction !== null} onClick={onAttach}>
                {sources.take ? "Replace file" : "Add a file"}
              </button>
            </div>
          </section>
        </div>
        {staleFlags ? (
          <p className="panel-honesty">These flags are from the other recording. Check this one to refresh them.</p>
        ) : null}
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
        {reviewPronunciationChecks.length > 0 ? (
          <details className="review-pronunciation-summary">
            <summary>
              <span><strong>Pronunciation</strong><small>Compare the selected recording with the guide</small></span>
              <em>{reviewPronunciationAttention === 0 ? "All matched" : `${reviewPronunciationAttention} need a listen`}</em>
            </summary>
            <ul>
              {reviewPronunciationChecks.map((check) => (
                <li key={check.entryId}>
                  <span><strong>{check.spelling}</strong><small>{check.respell ? `Guide: ${check.respell}` : "No agreed pronunciation"}</small></span>
                  <em>{pronunciationCheckLabel(check.status)}</em>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className={proof ? "proofreading-workspace ready" : "proofreading-workspace"}>
          <aside className="proofing-issue-rail" aria-label="Proofreading annotations">
            {proof ? (
              <PickupList
                variant="rail"
                pickups={proof.pickups}
                busyAction={busyAction}
                onPlay={onPlayPickup}
                onShow={showPickupOnPage}
                listenDisabledReason={listenDisabledReason}
                punchDisabledReason={punchDisabledReason}
                onExportMarkers={onExportMarkers}
                onExportReport={onExportReport}
                onExportPacket={onExportPacket}
                onPunch={onPunchPickup}
                onStartSession={onStartPickupSession}
                onUpdate={onUpdatePickup}
                onSuppress={onSuppressPickup}
                seatFilter={pickupSeatFilter}
                onSeatFilter={onPickupSeatFilter}
              />
            ) : (
              <div className="proofing-rail-empty">
                <p className="card-kicker">Annotations</p>
                <strong>Issues will appear here</strong>
                <p>Misreads, added words, missed words, pauses, and your own performance notes stay beside the manuscript.</p>
              </div>
            )}
          </aside>
          <div className="proofreading-document">
        <section className="paper-sheet selectable-proof-sheet" aria-label="Selectable manuscript">
          <div className="paper-sheet-heading">
            <div>
              <p className="paper-kicker">The page</p>
              <p className="paper-selection-hint">Highlight any word, line, sentence, or paragraph to perform it again.</p>
            </div>
            {proof ? (
              <span
                className="alignment-ready-badge"
                title={proof.timingEngine === "whisperx"
                  ? "Imported audio received forced word alignment"
                  : proof.timingEngine === "manuscript-clock"
                    ? "Timing was captured while narrating in Kosmos"
                    : "Timing comes from the available speech transcript"}
              >
                {manuscriptAnnotations.length} marked · {proof.timingEngine === "whisperx"
                  ? "precise word timing"
                  : proof.timingEngine === "manuscript-clock"
                    ? "manuscript timing"
                    : "word timing"}
              </span>
            ) : null}
          </div>
          {proof && checkedSourceKind === selectedKind ? (
            <div className="review-manuscript-coverage">
              <div>
                <strong>{Math.round(manuscriptCoverage * 100)}% recorded</strong>
                <span>{selectedKind === "live" ? (chapter.live_audio_name ?? "Booth read") : "Attached chapter take"} mapped to this manuscript</span>
              </div>
              <div className="recorded-coverage-track" role="progressbar" aria-label="Selected recording manuscript coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(manuscriptCoverage * 100)}>
                <i style={{ width: `${Math.round(manuscriptCoverage * 100)}%` }} />
              </div>
              {manuscriptCoverage < 0.98 ? (
                <p>This recording does not cover the whole manuscript. Return to the teleprompter and continue when you are ready.</p>
              ) : null}
            </div>
          ) : null}
          <div className="paper-prose manuscript-edit-surface">
            <ManuscriptProofProse
              text={chapterText}
              alignedTokens={alignedTokens}
              annotations={manuscriptAnnotations}
              focusedAnnotationId={focusedAnnotationId}
              selectable
              onTokenSelection={({ fromToken, toToken, actionPosition }) => {
                if (selectionOverlayOpen) {
                  return;
                }
                setRedoSelection({
                  ranges: buildNarrationRedoRanges({
                    manuscript: chapterText,
                    transcript: proof?.transcript ?? [],
                    fromToken,
                    toToken,
                  }),
                  scope: "selection",
                });
                dispatchSelectionAction({ type: "show", position: actionPosition });
                setRedoReason("");
              }}
            />
          </div>
          {!selectionOverlayOpen && quickRecordRange && quickRecordPosition ? (
            <div
              ref={quickRecordPopoverRef}
              className={`selection-record-popover ${quickRecordPosition.placement}`}
              style={{ left: quickRecordPosition.left, top: quickRecordPosition.top }}
              role="toolbar"
              aria-label="Selected passage actions"
            >
              <button
                type="button"
                disabled={busyAction !== null || !selectedKind || quickRecordRange.timing === "unavailable"}
                title={quickRecordRange.timing === "unavailable"
                  ? "Check this recording first so Kosmos can find the selected audio"
                  : "Record this highlighted passage again"}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => startRedoRecording(quickRecordRange)}
              >
                <MicrophoneGlyph />
                <span>Record again</span>
              </button>
            </div>
          ) : null}
          {redoSelection && selectedRedoRange ? (
            <section className="redo-selection-card" aria-live="polite" aria-label="Redo selected passage">
              <header>
                <div>
                  <p className="card-kicker">Selected passage</p>
                  <strong>
                    {selectedRedoRange.wordCount} {selectedRedoRange.wordCount === 1 ? "word" : "words"}
                    {selectedRedoRange.start !== undefined && selectedRedoRange.end !== undefined
                      ? ` · ${formatTime(selectedRedoRange.start)}–${formatTime(selectedRedoRange.end)}`
                      : " · not mapped to audio yet"}
                  </strong>
                </div>
                <button
                  className="redo-clear-button"
                  type="button"
                  onClick={() => {
                    window.getSelection()?.removeAllRanges();
                    setRedoSelection(null);
                    dispatchSelectionAction({ type: "dismiss", reason: "selection-cleared" });
                  }}
                >
                  Clear
                </button>
              </header>
              <blockquote>{selectedRedoRange.text}</blockquote>
              <div className="redo-scope-options" role="group" aria-label="Replacement scope">
                {([
                  ["selection", redoSelection.ranges.selection.wordCount === 1 ? "Word" : "Selection / line"],
                  ["sentence", "Sentence"],
                  ["paragraph", "Paragraph"],
                ] as Array<[NarrationRedoScope, string]>).map(([scope, label]) => (
                  <button
                    key={scope}
                    className={redoSelection.scope === scope ? "selected" : ""}
                    type="button"
                    onClick={() => setRedoSelection((current) => current ? { ...current, scope } : current)}
                  >
                    {label}{scope === "sentence" ? <small>Recommended</small> : null}
                  </button>
                ))}
              </div>
              {selectedRedoRange.timing === "partial" ? (
                <p className="redo-warning">Some boundary words were not confidently aligned. Listen to the range before recording; the in-context preview is required before Apply.</p>
              ) : selectedRedoRange.timing === "unavailable" ? (
                <p className="redo-warning">This selection has no audio timing yet. Check the chapter first, or select nearby spoken text.</p>
              ) : selectedRedoRange.wordCount === 1 ? (
                <p className="redo-warning subtle">A single-word edit can expose a seam. Sentence is safer, but the choice is yours.</p>
              ) : null}
              <div className="redo-selection-actions">
                {selectedRedoRange.timing === "unavailable" ? (
                  <button className="primary-button" type="button" disabled={busyAction !== null || !selectedKind} onClick={onProof}>
                    Check chapter first
                  </button>
                ) : (
                  <>
                    <label className="redo-reason-field">
                      <span>Intent <small>optional</small></span>
                      <select value={redoReason} onChange={(event) => setRedoReason(event.target.value)}>
                        <option value="">Performance choice</option>
                        <option value="More emotion">More emotion</option>
                        <option value="Less emotion">Less emotion</option>
                        <option value="Pacing">Pacing</option>
                        <option value="Character voice">Character voice</option>
                        <option value="Pronunciation">Pronunciation</option>
                        <option value="Mistake">Mistake</option>
                      </select>
                    </label>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onPlaySelection(selectedRedoRange.start as number, selectedRedoRange.end as number)}
                    >
                      Play selected words
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={busyAction !== null || !selectedKind}
                      onClick={() => startRedoRecording(selectedRedoRange, redoReason)}
                    >
                      Record this passage
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : null}
        </section>
        <p className="manuscript-timing-note">
          {selectedKind === "live"
            ? "Recorded here: Kosmos reuses the manuscript timing and issues captured while you narrated."
            : "Brought in: Kosmos uses local speech alignment behind the scenes, then places every issue on this manuscript."}
        </p>
        {selectedKind === "take" && modelAvailable === false ? (
          <div className="model-note">
            <span>The local speech model is needed only for brought-in audio.</span>
            <button type="button" onClick={onDownloadModel} disabled={busyAction !== null}>
              {busyAction === "model"
                ? `Downloading ${Math.round(modelProgress * 100)}%…`
                : "Download speech model"}
            </button>
          </div>
        ) : null}
        <div className="desk-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!proofAudioSource(chapter) || busyAction !== null}
            onClick={onProof}
          >
            {busyAction === `proof-${chapter.id}`
              ? "Preparing…"
              : selectedKind === "live"
                ? "Review this recording"
                : "Check imported audio"}
          </button>
        </div>
          </div>
        </div>
      </article>

      {proof ? (
        <OccurrenceScanner transcript={proof.transcript} busy={busyAction !== null} onPlay={onPlayRange} />
      ) : null}
      {comparisons.length > 0 ? (
        <PickupComparisonPanel
          folder={comparisonFolder}
          comparisons={comparisons}
          busyAction={busyAction}
          onVerify={onVerifyComparison}
          onUndoLatest={onUndoLatestPickup}
          onFinalProof={onFinalProof}
        />
      ) : null}
    </div>
  );
}

export function FinishPage({
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
  onShowPack,
  onShare,
  onPlayNoiseFloor,
}: {
  chapter: ChapterFile;
  exportReadiness: ExportReadiness;
  busyAction: string | null;
  acxReport: AcxReport | null;
  exportResult: DeliveryExportResult | null;
  audioUrl: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onMeasure: (presetId?: string) => void;
  specPresetId: string;
  onExport: () => void;
  onShowPack: () => void;
  onShare: () => void;
  onPlayNoiseFloor: () => void;
}) {
  const target = resolvePreset(specPresetId);
  const profile = deliveryProfile(target);
  const currentExport = exportResult?.targetId === target.id ? exportResult : null;
  const delivered = useMemo(
    () => (currentExport ? summarizeExportFixes(currentExport.entries, currentExport.profile) : null),
    [currentExport],
  );

  return (
    <div className="finish-page">
      {delivered && currentExport ? (
        <ExportReceipt
          summary={delivered}
          fileCount={currentExport.files.length}
          result={currentExport}
          busyAction={busyAction}
          onShowPack={onShowPack}
        />
      ) : null}

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
        <p className="panel-honesty">Measurable specs only. Listen once for clicks, echo, and a wrong read.</p>
        <div className="desk-actions">
          <button className="primary-button" type="button" disabled={!chapter.audio_path || busyAction !== null} onClick={() => onMeasure()}>
            {busyAction === `meter-${chapter.id}` ? "Measuring…" : "Check audio"}
          </button>
        </div>
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" /> : null}
        {acxReport ? (
          <AcxMeter
            report={acxReport}
            onPlayNoiseFloor={chapter.audio_path ? onPlayNoiseFloor : undefined}
            presetId={specPresetId}
            onPresetChange={(presetId) => onMeasure(presetId)}
            masteringPlan
          />
        ) : null}
      </article>

      <article className="surface-card">
        <p className="card-kicker">The pack</p>
        <h3>{currentExport ? "Export again" : "Export and share"}</h3>
        <p className="panel-honesty">
          {currentExport
            ? "Re-run the master after a pickup, or invite the other seat on People."
            : `Write the ${target.label} delivery folder, or invite the other seat on People.`}
        </p>
        <div className={`export-readiness ${exportReadiness.ready ? "ready" : "blocked"}`} role="status">
          <strong>{exportReadiness.ready ? "Ready to prepare" : "Audio still needed"}</strong>
          <span>{exportReadiness.attachedChapters} of {exportReadiness.totalChapters} chapters have audio</span>
          {!exportReadiness.ready ? (
            <p>
              Record or import: {exportReadiness.missingAudio.slice(0, 3).map((missing) => missing.title).join(", ")}
              {exportReadiness.missingAudio.length > 3 ? ` and ${exportReadiness.missingAudio.length - 3} more` : ""}.
              {currentExport ? " The pack on disk is behind the book until you export again." : ""}
            </p>
          ) : (
            <p>
              {currentExport
                ? `Every chapter is mastered and measured again from the delivered ${profile.container.toUpperCase()}. The checklist above confirms what happened.`
                : `Every chapter will be mastered for ${target.label}, then measured again from the delivered ${profile.container.toUpperCase()}.`}
            </p>
          )}
        </div>
        <div className="desk-actions">
          <button className="primary-button" type="button" disabled={!exportReadiness.ready || busyAction !== null} onClick={onExport}>
            {busyAction === "export" ? "Exporting…" : currentExport ? "Export again" : `Export ${target.label} pack`}
          </button>
          <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onShare}>
            {busyAction === "share" ? "Preparing…" : "Invite on People"}
          </button>
        </div>
      </article>
    </div>
  );
}

/**
 * The receipt for a pack that has already been written.
 *
 * Export masters every chapter, so the numbers the narrator read before pressing
 * the button describe a file that no longer exists. This says what changed on the
 * way to delivery, in the order mastering did it, with the reading before and
 * after each fix — and keeps the things mastering cannot settle at the top, where
 * a claim of "ready" would otherwise bury them.
 */
export function ExportReceipt({
  summary,
  fileCount,
  result,
  busyAction,
  onShowPack,
}: {
  summary: ExportFixSummary;
  fileCount: number;
  result: DeliveryExportResult;
  busyAction: string | null;
  onShowPack: () => void;
}) {
  const completed = summary.completed;
  const outstanding = summary.outstanding;

  return (
    <article className={`surface-card export-receipt ${summary.ready ? "ready" : "review"}`} aria-labelledby="receipt-title">
      <header className="receipt-heading">
        <div>
          <p className="card-kicker">Mastered pack</p>
          <h3 id="receipt-title">
            {outstanding.length > 0
              ? `Delivered, with ${countOf(outstanding.length, "check")} to settle by hand.`
              : "Delivery complete. Every applicable check is confirmed."}
          </h3>
          <p className="receipt-sub">
            {countOf(fileCount, `${result.container.toUpperCase()} file`)} written to export/{result.profile.folderName}.
            {" "}{result.profileDescription}
          </p>
        </div>
        <div className="receipt-actions">
          <button className="primary-button" type="button" disabled={busyAction !== null} onClick={onShowPack}>
            Show pack
          </button>
        </div>
      </header>

      {outstanding.length > 0 ? (
        <section className="receipt-block outstanding">
          <h4>Only you can settle these</h4>
          <ul className="fix-list">
            {outstanding.map((row) => <FixRow key={row.key} row={row} />)}
          </ul>
        </section>
      ) : null}

      <section className="receipt-block">
        <h4>Delivery checklist</h4>
        {completed.length > 0 ? (
          <ul className="fix-list">
            {completed.map((row) => <FixRow key={row.key} row={row} />)}
          </ul>
        ) : (
          <p className="receipt-note">No processing changes were needed. The takes already met this delivery target.</p>
        )}
      </section>

      {summary.held.length > 0 || summary.unjudged.length > 0 ? (
        <p className="receipt-note">
          {summary.held.length > 0 ? `Left alone, already inside the target: ${sentenceList(summary.held)}. ` : ""}
          {summary.unjudged.length > 0
            ? `Measured but not judged, because the delivery target sets no limit: ${sentenceList(summary.unjudged)}.`
            : ""}
        </p>
      ) : null}

      {summary.notes.length > 0 ? (
        <section className="receipt-block">
          <h4>Notes on the pack</h4>
          <ul className="receipt-notes">
            {summary.notes.map((note) => (
              <li key={note.fileName}><strong>{note.fileName}</strong> — {note.note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="meter-details receipt-files">
        <summary>Every measurement, file by file ({summary.files.length})</summary>
        {summary.files.map((file) => (
          <section className="receipt-file" key={file.fileName}>
            <header>
              <strong>{file.fileName}</strong>
              <span className={file.trafficLight ? `traffic-light compact ${file.trafficLight}` : "status-pill"}>
                {file.trafficLight ? checkStatusLabel(file.trafficLight) : "Not measured"}
              </span>
            </header>
            {file.measured ? (
              <table className="meter-table">
                <thead>
                  <tr><th>Check</th><th>Take</th><th>Delivered</th><th>Verdict</th></tr>
                </thead>
                <tbody>
                  {file.changes.map((change) => (
                    <tr key={change.key}>
                      <td>{change.label}</td>
                      <td>{change.before ?? "Not measured"}</td>
                      <td>{change.after}</td>
                      <td><span className={`check-dot ${change.afterStatus}`}>{checkStatusLabel(change.afterStatus)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ))}
        <p className="meter-honesty">
          The delivered column is measured from the final {result.container.toUpperCase()}, so it is what the file contains rather than what mastering
          intended. The same numbers are in REPORT.txt beside the audio.
        </p>
      </details>
    </article>
  );
}

function FixRow({ row }: { row: AggregateChange }) {
  const settled = row.outcome !== "outstanding";
  return (
    <li className={`fix-row ${row.outcome}`}>
      <span className="fix-mark" role="img" aria-label={settled ? "Confirmed" : "Still outside the target"}>
        {settled ? <CheckGlyph /> : "!"}
      </span>
      <span className="fix-body">
        <strong>{row.label}</strong>
        <span className="fix-detail">
          {row.detail}
          {row.fileCount < row.ofFiles ? ` In ${row.fileCount} of ${row.ofFiles} files.` : ""}
        </span>
      </span>
      <span className="fix-delta" aria-label={row.before ? `${row.before} became ${row.after}` : row.after}>
        {row.before ? (
          <>
            <span className="fix-before" aria-hidden="true">{row.before}</span>
            <span className="fix-arrow" aria-hidden="true">→</span>
          </>
        ) : null}
        <span className="fix-after" aria-hidden="true">{row.after}</span>
      </span>
    </li>
  );
}

function CheckGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.2 6.4 4.6 8.8 9.8 3.4" />
    </svg>
  );
}

function MicrophoneGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
    </svg>
  );
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sentenceList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function conflictLabel(conflict: MergeConflict): string {
  switch (conflict.kind) {
    case "audio":
      return `${conflict.chapterTitle}: both sides have a recording. Yours was kept.`;
    case "script":
      return `${conflict.chapterTitle}: their script differs from yours, so their timings may not line up.`;
    case "status":
      return `${conflict.chapterTitle}: they set ${authorStatusLabel(conflict.theirs)}, you have ${authorStatusLabel(conflict.mine)}. Yours was kept.`;
    default:
      return `${conflict.chapterTitle}: “${conflict.expected}” — they marked it ${conflict.theirs}, you marked it ${conflict.mine}. Yours was kept.`;
  }
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

function PickupComparisonPanel({
  folder,
  comparisons,
  busyAction,
  onVerify,
  onUndoLatest,
  onFinalProof,
}: {
  folder: string;
  comparisons: PickupComparison[];
  busyAction: string | null;
  onVerify: (id: string) => void;
  onUndoLatest: () => void;
  onFinalProof: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<{ comparison: PickupComparison; side: "original" | "replacement" | "edited" } | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const needsVerification = comparisons.filter((comparison) =>
    comparison.editStatus === "applied" && comparison.verificationStatus === "needs_verification")
    .sort((left, right) => left.start - right.start);
  const latestApplied = comparisons.find((comparison) => comparison.editStatus === "applied");
  const finalProof = finalPickupProofReadiness(comparisons);

  useEffect(() => {
    if (active?.side !== "edited") {
      return;
    }
    const refreshed = comparisons.find((comparison) => comparison.id === active.comparison.id);
    const next = comparisons
      .filter((comparison) =>
        comparison.id !== active.comparison.id
        && comparison.editStatus === "applied"
        && comparison.verificationStatus === "needs_verification"
        && comparison.editedPath)
      .sort((left, right) => left.start - right.start)[0];
    if (refreshed?.verificationStatus === "verified" && next) {
      setActive({ comparison: next, side: "edited" });
    }
  }, [comparisons]);

  useEffect(() => {
    let disposed = false;
    setSourceUrl(null);
    setLoadError(null);
    if (!active || !window.boothDesk || folder === "(browser preview)") {
      return;
    }
    const relativePath = active.side === "original"
      ? active.comparison.originalPath
      : active.side === "edited"
        ? active.comparison.editedPath
        : active.comparison.replacementPath;
    if (!relativePath) {
      setLoadError("The edited chapter is not available for this older pickup.");
      return;
    }
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
    element.currentTime = active.side === "replacement" ? 0 : Math.max(0, active.comparison.start - 0.5);
    void element.play();
  }

  function stopOriginalInContext() {
    if (active && active.side !== "replacement" && audio.current && audio.current.currentTime >= active.comparison.end + 0.5) {
      audio.current.pause();
    }
  }

  return (
    <section className="result-panel comparison-panel" aria-labelledby="comparison-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Pickup history</p>
          <h4 id="comparison-title">Applied pickups</h4>
        </div>
        <div className="result-heading-actions">
          {needsVerification.length > 0 ? (
            <button
              className="action-button small accent"
              type="button"
              disabled={busyAction !== null || !needsVerification[0].editedPath}
              onClick={() => setActive({ comparison: needsVerification[0], side: "edited" })}
            >
              Review next ({needsVerification.length})
            </button>
          ) : null}
          {latestApplied ? (
            <button className="action-button small" type="button" disabled={busyAction !== null} onClick={onUndoLatest}>
              {busyAction === "undo-punch" ? "Undoing…" : "Undo latest"}
            </button>
          ) : null}
          <button
            className="action-button small accent"
            type="button"
            disabled={!finalProof.ready || busyAction !== null}
            title={finalProof.ready ? "Check the complete edited chapter for remaining word differences" : finalProof.label}
            onClick={onFinalProof}
          >
            {busyAction?.startsWith("proof-") ? "Checking edited chapter…" : finalProof.label}
          </button>
          <span className="result-count">{needsVerification.length} to verify</span>
        </div>
      </div>
      <p className="panel-honesty">Listen to each edited join, mark it verified, then run one final word check on the complete edited chapter. The untouched original remains available.</p>
      <ol className="comparison-list">
        {comparisons.map((comparison, index) => (
          <li key={comparison.id}>
            <div>
              <strong>{comparison.expected ? `“${comparison.expected}”` : `Pickup ${index + 1}`}</strong>
              <time>{formatTime(comparison.start)}–{formatTime(comparison.end)}{comparison.heard ? ` · heard “${comparison.heard}”` : ""}</time>
              <span className={`pickup-state ${comparison.editStatus === "reverted" || comparison.verificationStatus === "verified" ? "done" : "open"}`}>
                {comparison.editStatus === "reverted"
                  ? "Undone"
                  : comparison.verificationStatus === "verified"
                    ? "Verified"
                    : "Applied · needs verification"}
              </span>
            </div>
            <button type="button" className={active?.comparison.id === comparison.id && active.side === "original" ? "active" : ""} onClick={() => setActive({ comparison, side: "original" })}>A · Original</button>
            <button type="button" className={active?.comparison.id === comparison.id && active.side === "edited" ? "active" : ""} disabled={!comparison.editedPath || comparison.editStatus === "reverted"} onClick={() => setActive({ comparison, side: "edited" })}>B · Edited in context</button>
            <button type="button" className={active?.comparison.id === comparison.id && active.side === "replacement" ? "active" : ""} onClick={() => setActive({ comparison, side: "replacement" })}>Pickup clip</button>
            {comparison.editStatus === "applied" && comparison.verificationStatus === "needs_verification" ? (
              <button
                type="button"
                disabled={busyAction !== null || active?.comparison.id !== comparison.id || active.side !== "edited"}
                title={active?.comparison.id === comparison.id && active.side === "edited" ? "" : "Listen to the edited join first"}
                onClick={() => onVerify(comparison.id)}
              >
                {busyAction === `verify-punch-${comparison.id}` ? "Saving…" : "Mark verified"}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {sourceUrl ? (
        <div className="comparison-player">
          <strong>{active?.side === "original" ? "A · Original in context" : active?.side === "edited" ? "B · Edited chapter in context" : "Pickup clip"}</strong>
          <audio ref={audio} controls src={sourceUrl} preload="metadata" onLoadedMetadata={beginPlayback} onTimeUpdate={stopOriginalInContext} />
        </div>
      ) : null}
      {loadError ? <p className="error-note">{loadError}</p> : null}
    </section>
  );
}

export function PickupList({ variant = "default", pickups, busyAction, onPlay, onShow, listenDisabledReason, punchDisabledReason, onExportMarkers, onExportReport, onExportPacket, onPunch, onStartSession, onUpdate, onSuppress, seatFilter, onSeatFilter }: { variant?: "default" | "rail"; pickups: Pickup[]; busyAction: string | null; onPlay: (pickup: Pickup) => void; onShow?: (pickup: Pickup) => void; listenDisabledReason?: (pickup: Pickup) => string | null; punchDisabledReason?: (pickup: Pickup) => string | null; onExportMarkers: () => void; onExportReport: () => void; onExportPacket: () => void; onPunch: (pickup: Pickup) => void; onStartSession: (pickups: Pickup[]) => void; onUpdate: (pickup: Pickup, changes: { status?: Pickup["status"]; note?: string }) => void; onSuppress: (pickup: Pickup) => void; seatFilter: "all" | "narration" | "N1" | "N2"; onSeatFilter: (value: "all" | "narration" | "N1" | "N2") => void }) {
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const seatPickups = seatFilter === "all" ? pickups : pickups.filter((pickup) => pickup.seat === seatFilter);
  const visiblePickups = statusFilter === "open" ? seatPickups.filter((pickup) => pickup.status === "open") : seatPickups;
  const openCount = seatPickups.filter((pickup) => pickup.status === "open").length;
  const recordablePickups = seatPickups.filter((pickup) => pickup.status === "open" && !punchDisabledReason?.(pickup));
  return (
    <section className="result-panel" aria-labelledby="pickup-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">{variant === "rail" ? "Script sync" : "Review points"}</p>
          <h4 id="pickup-title">{variant === "rail" ? "Annotations" : "Pickups"}</h4>
        </div>
        <div className="result-heading-actions">
          {openCount > 0 ? (
            <button
              className="action-button small accent"
              type="button"
              disabled={busyAction !== null || recordablePickups.length === 0}
              onClick={() => onStartSession(recordablePickups)}
            >
              Start pickup session
            </button>
          ) : null}
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
          <details className="export-menu">
            <summary className="action-button small">Send these…</summary>
            <div className="export-menu-list">
              <button className="export-menu-item" type="button" disabled={busyAction !== null} onClick={onExportPacket}>
                <strong>{busyAction === "pickup-packet" ? "Building the packet…" : "Packet for the author"}</strong>
                <span>A web page with a clip for every flag, plus a spreadsheet.</span>
              </button>
              <button className="export-menu-item" type="button" disabled={busyAction !== null} onClick={onExportMarkers}>
                <strong>Markers for a DAW</strong>
                <span>Drop them on the timeline in Reaper, Audition, or Audacity.</span>
              </button>
              <button className="export-menu-item" type="button" disabled={busyAction !== null} onClick={onExportReport}>
                <strong>{busyAction === "proof-report" ? "Exporting the list…" : "Plain list (CSV)"}</strong>
                <span>Every flag with its timecode, for a spreadsheet.</span>
              </button>
            </div>
          </details>
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
            <li
              key={pickup.id}
              className={`pickup-row kind-tone-${pickupKindPresentation(pickup.kind).tone} ${pickup.status}`}
              data-kind={pickup.kind}
            >
              <time>{formatTime(pickupLineBounds(pickup).start)}</time>
              <div className="pickup-reading">{pickupReading(pickup)}</div>
              <span className={`kind-badge kind-tone-${pickupKindPresentation(pickup.kind).tone}`}>
                {pickupKindPresentation(pickup.kind).label}
              </span>
              {pickup.status === "open" ? null : (
                <span className={`pickup-state ${pickup.status}`}>
                  {pickup.status === "done" ? "Fixed" : "Current take kept"}
                </span>
              )}
              <div className="pickup-actions">
                {onShow ? (
                  <button
                    className="action-button small"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onShow(pickup)}
                  >
                    Show on page
                  </button>
                ) : null}
                <button
                  className="action-button small"
                  type="button"
                  disabled={busyAction !== null || Boolean(listenDisabledReason?.(pickup))}
                  title={listenDisabledReason?.(pickup) ?? undefined}
                  onClick={() => onPlay(pickup)}
                >
                  Listen
                </button>
                {pickup.status === "open" ? (
                  <>
                    <button
                      className="action-button small accent"
                      type="button"
                      disabled={busyAction !== null || Boolean(punchDisabledReason?.(pickup))}
                      title={punchDisabledReason?.(pickup) ?? "Read the whole line again"}
                      onClick={() => onPunch(pickup)}
                    >
                      Record pickup…
                    </button>
                    <button
                      className="action-button small"
                      type="button"
                      title="The read was fine here"
                      disabled={busyAction !== null}
                      onClick={() => onUpdate(pickup, { status: "ignored" })}
                    >
                      Keep current take
                    </button>
                  </>
                ) : (
                  <button
                    className="action-button small"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onUpdate(pickup, { status: "open" })}
                  >
                    Reopen
                  </button>
                )}
                <details className="pickup-more">
                  <summary aria-label={`More for ${pickup.expected || "this flag"}`}>More</summary>
                  <div className="pickup-more-menu">
                    {pickup.status === "open" ? (
                      <button
                        className="action-button small plain"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onUpdate(pickup, { status: "done" })}
                      >
                        Mark fixed elsewhere
                      </button>
                    ) : null}
                    {pickup.status === "open" && pickup.kind !== "pause" && pickup.expected ? (
                      <button
                        className="action-button small danger"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onSuppress(pickup)}
                      >
                        Never flag “{pickup.expected}” in this book
                      </button>
                    ) : null}
                    <PickupNoteEditor
                      pickup={pickup}
                      busy={busyAction !== null}
                      onSave={(note) => onUpdate(pickup, { note })}
                    />
                  </div>
                </details>
              </div>
              {pickup.line_text ? (
                <p className="pickup-line-text" lang="en">{pickup.line_text}</p>
              ) : null}
              {pickup.note ? <p className="pickup-note-text">{pickup.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What a flag actually says, in words rather than arrows and em dashes. */
function pickupReading(pickup: Pickup) {
  if (pickup.kind === "pause") {
    const seconds = Math.max(0, pickup.t_end - pickup.t_start);
    return <span className="pickup-pause">{seconds.toFixed(1)} s of silence mid-sentence</span>;
  }
  if (pickup.kind === "skip") {
    return (
      <>
        <span className="expected">{pickup.expected || "a word"}</span>
        <span className="pickup-reading-note">on the page, not heard</span>
      </>
    );
  }
  if (pickup.kind === "insert") {
    return (
      <>
        <span className="heard">{pickup.heard || "a word"}</span>
        <span className="pickup-reading-note">heard, not on the page</span>
      </>
    );
  }
  return (
    <>
      <span className="expected">{pickup.expected || "—"}</span>
      <span className="arrow" aria-hidden="true">→</span>
      <span className="heard">{pickup.heard || "—"}</span>
    </>
  );
}

function PickupNoteEditor({ pickup, busy, onSave }: { pickup: Pickup; busy: boolean; onSave: (note: string) => void }) {
  const [note, setNote] = useState(pickup.note ?? "");
  useEffect(() => setNote(pickup.note ?? ""), [pickup.id, pickup.note]);
  return (
    <div className="pickup-note-editor">
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="A note for whoever fixes this" />
      <button type="button" disabled={busy || note.trim().length === 0} onClick={() => onSave(note)}>Save note</button>
    </div>
  );
}

interface MeterRow {
  id: string;
  key: CheckKey;
  label: string;
  target: string;
  measured: string;
  status: CheckStatus;
}

export function AcxMeter({
  report,
  onPlayNoiseFloor,
  presetId,
  onPresetChange,
  masteringPlan = false,
}: {
  report: AcxReport;
  onPlayNoiseFloor?: () => void;
  presetId?: string;
  onPresetChange?: (presetId: string) => void;
  /**
   * Set where export follows the check. A take measured before mastering fails
   * rows that export settles unasked, and calling those failures would send the
   * narrator back to the booth to fix something the button already fixes.
   */
  masteringPlan?: boolean;
}) {
  const preset = resolvePreset(report.preset_id);
  const profile = deliveryProfile(preset);
  const targets = presetTargets(preset);
  const rows: MeterRow[] = ([
    { id: "rms", key: "rms", label: "RMS", target: targets.rms, measured: formatDb(report.rms_dbfs) },
    { id: "loudness", key: "loudness", label: "Loudness", target: targets.loudness, measured: formatLufs(report.lufs_integrated) },
    { id: "true_peak", key: "true_peak", label: "True peak", target: targets.true_peak, measured: formatDb(report.true_peak_dbfs) },
    { id: "noise_floor", key: "noise_floor", label: "Noise floor", target: targets.noise_floor, measured: formatDb(report.noise_floor_dbfs) },
    { id: "sample_rate", key: "sample_rate", label: "Sample rate", target: targets.sample_rate, measured: formatSampleRate(report.sample_rate) },
    { id: "channels", key: "channels", label: "Channels", target: targets.channels, measured: formatChannels(report.channels) },
    { id: "format", key: "format", label: "Format", target: "Supported audio file", measured: report.format.toUpperCase() },
    {
      id: "bitrate",
      key: "format",
      label: "Bitrate",
      target: targets.format,
      measured: report.format === "mp3"
        ? `${report.bitrate_kbps?.toFixed(0) ?? "?"} kbps ${report.vbr === true ? "VBR" : report.vbr === false ? "CBR" : "mode unknown"}`
        : "Not applicable to source",
    },
    { id: "duration", key: "duration", label: "Duration", target: targets.duration, measured: formatLength(report.duration_seconds) },
    { id: "head_room_tone", key: "head_room_tone", label: "Head room tone", target: targets.head_room_tone, measured: formatRoomTone(report.head_room_tone_s) },
    { id: "tail_room_tone", key: "tail_room_tone", label: "Tail room tone", target: targets.tail_room_tone, measured: formatRoomTone(report.tail_room_tone_s) },
  ] satisfies Array<Omit<MeterRow, "status">>).map((row) => ({ ...row, status: report.checks[row.key] }));

  const trouble = rows.filter((row) => row.status === "fail" || row.status === "warn");
  const judged = rows.filter((row) => row.status !== "unspecified");
  // Format and bitrate read one status between them, so a single problem would
  // otherwise be listed twice in the verdict.
  const distinct = trouble.filter((row, index) => trouble.findIndex((other) => other.key === row.key) === index);
  const inHand = masteringPlan ? distinct.filter((row) => exportSettles(row.key, profile)) : [];
  const yours = distinct.filter((row) => !inHand.includes(row));
  const settledIds = new Set(masteringPlan
    ? trouble.filter((row) => exportSettles(row.key, profile)).map((row) => row.id)
    : []);

  return (
    <section className="result-panel" aria-labelledby="acx-title">
      <div className="result-heading">
        <div>
          <p className="card-kicker">Audio check</p>
          <h4 id="acx-title">{report.preset_label} check</h4>
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
      </div>

      {/* The verdict first. Eleven measurements are the evidence, not the answer. */}
      <div className={`meter-verdict ${yours.length === 0 && inHand.length > 0 ? "in-hand" : report.traffic_light}`}>
        <span className={`traffic-light ${yours.length === 0 && inHand.length > 0 ? "in-hand" : report.traffic_light}`}>
          {yours.length === 0 && inHand.length > 0 ? "Export handles" : checkStatusLabel(report.traffic_light)}
        </span>
        <div>
          <strong>
            {distinct.length === 0
              ? `This file meets every ${report.preset_label} level and format rule.`
              : yours.length === 0
                ? `Nothing here needs the booth. Export settles ${countOf(inHand.length, "thing")} while it masters.`
                : `${countOf(yours.length, "thing")} only you can settle before ${report.preset_label} will take this.`}
          </strong>
          {distinct.length === 0 ? (
            <span>
              {judged.length} checks measured and passed. Export still masters and re-measures the file.
            </span>
          ) : (
            <>
              {yours.length > 0 ? (
                <ul className="meter-trouble">
                  {yours.map((row) => (
                    <li key={row.id} className={row.status}>
                      <strong>{row.label}</strong> is {row.measured}; {report.preset_label} wants {row.target}.
                    </li>
                  ))}
                </ul>
              ) : null}
              {inHand.length > 0 ? (
                <ul className="meter-trouble in-hand">
                  {inHand.map((row) => (
                    <li key={row.id}>
                      <strong>{row.label}</strong> is {row.measured}. {checkDefinition(row.key, profile).promise}.
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>

      <details className="meter-details" open={distinct.length > 0}>
        <summary>
          {distinct.length > 0 ? "All measurements" : `Show all ${rows.length} measurements`}
        </summary>
        <table className="meter-table">
          <thead>
            <tr><th>Check</th><th>Target</th><th>Measured</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>{row.target}</td>
                <td>{row.measured}</td>
                <td>
                  {settledIds.has(row.id) ? (
                    <span className="check-dot in-hand">Export handles</span>
                  ) : (
                    <span className={`check-dot ${row.status}`}>{checkStatusLabel(row.status)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="meter-evidence">
          <div>
            <strong>Where the noise floor was measured</strong>
            <span>
              {report.noise_floor_start_seconds.toFixed(2)}–{(report.noise_floor_start_seconds + report.noise_floor_duration_seconds).toFixed(2)} s, the quietest sustained section found. Listen to confirm it is voice-free.
            </span>
          </div>
          {onPlayNoiseFloor ? (
            <button className="action-button small" type="button" onClick={onPlayNoiseFloor}>
              Listen to it
            </button>
          ) : null}
        </div>
        <p className="meter-honesty">
          Measured from this take, not from the delivered file. Listen once for clicks and room noise.
          {settledIds.size > 0
            ? " Rows marked “Export handles” are settled by one-click mastering and verified from the delivered file."
            : ""}
          {" "}Rows marked “Not judged” are measured but carry no verdict, because {report.preset_label} sets no limit for them.
        </p>
      </details>
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
  return { tab: "finish", label: "Export delivery pack", detail: "Chapters are recorded. Package the book." };
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

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
