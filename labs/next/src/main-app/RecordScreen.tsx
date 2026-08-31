import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { resamplePcmToMono } from "../../../../src/core/audio/resample";
import { encodeWavPcm16 } from "../../../../src/core/audio/wav";
import { boothShortcutAction } from "../../../../src/core/teleprompter/booth-controls";
import {
  createLeadState,
  leadAdvance,
  leadOnConfirm,
  type LeadState,
} from "../../../../src/core/teleprompter/lead";
import {
  LIVE_HALT_RUN_WORDS,
  LIVE_STREAM_HOP_SECONDS,
  liveBackFlag,
  liveHaltCopy,
  matchLiveWindow,
  manualLivePickup,
  mergeLivePickup,
  pickupFromLiveFlag,
  type LiveExpectedWord,
  type LiveMatchState,
  type LiveMismatch,
  type LiveTranscriptWord,
  type LiveVoiceStatus,
  type LiveWordConfirmation,
} from "../../../../src/core/teleprompter/live";
import { PICKUP_PREROLL_SECONDS } from "../../../../src/core/teleprompter/pickup-line";
import {
  buildLivePunchCue,
  planLivePunchRoll,
  truncateLiveTape,
} from "../../../../src/core/teleprompter/session-tape";
import { teleprompterWorkflow } from "../../../../src/core/teleprompter/workflow";
import type { GlossaryEntry } from "../../../../src/core/project/types";
import { BoothReadingPanel } from "./BoothReadingPanel";
import { BoothSheet } from "./BoothSheet";
import { TapePlayer } from "./TapePlayer";
import {
  applyChapterPickup,
  applyOriginalTape,
  clearOriginalTape,
  readChapterAudioBytes,
  readChapterAudioUrl,
  readChapterContent,
  writeChapterAudio,
  type BookProject,
  type ChapterPickup,
  type PromptHighlightMode,
  type RecordedWord,
} from "./store";
import { readPromptTheme, readReadingFont, writePromptTheme, readBoothFontPx, writeBoothFontPx } from "./reading-prefs";
import { pickupIsSuppressed } from "./suppress";
import { DebugFinishTakeButton } from "./DebugFinishTakeButton";
import {
  buildBoothScriptFromHtml,
  concatWav,
  coverageOf,
  encodePcmWav,
  float32ToBase64,
  highlightBand,
  isSpokenChapterHeading,
  measureRows,
  mergeRecordedWords,
  resumeSecondsOf,
} from "./booth";

const HIGHLIGHT_KEY = "kosmos-booth-highlight";
const SPACING_KEY = "kosmos-booth-spacing";
const CHECK_KEY = "kosmos-booth-check";
const HALT_KEY = "kosmos-booth-halt";
const MIC_KEY = "kosmos-booth-mic";
const TARGET_RATE = 16_000;
const WHISPER_WINDOW_SECONDS = 1.6;

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
  } catch {
    // Keep the original default.
  }
  return fallback;
}

function readHighlight(): PromptHighlightMode {
  return readStored(HIGHLIGHT_KEY, ["word", "line", "paragraph"] as const, "line");
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
  } catch {
    // Keep the original default.
  }
  return fallback;
}

function readSpacing(): number {
  try {
    const value = Number(window.localStorage.getItem(SPACING_KEY));
    if (value === 1.35 || value === 1.55 || value === 1.8) {
      return value;
    }
  } catch {
    // Keep the original default.
  }
  return 1.55;
}

async function playPunchCue(samples: Float32Array, sampleRate: number): Promise<void> {
  if (samples.length === 0) {
    return;
  }
  const wav = encodeWavPcm16(samples, Math.round(sampleRate), 1);
  const bytes = new Uint8Array(wav.byteLength);
  bytes.set(wav);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  await new Promise<void>((resolve, reject) => {
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
    audio.onerror = () => finish(new Error("The restart cue could not play."));
    void audio.play().catch(finish);
  });
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function RecordScreen({
  project,
  chapterId,
  onBack,
  onChange,
  embedded,
  onContinueProof,
  importSlot,
  proofing,
  boothTools,
}: {
  project: BookProject;
  chapterId: string;
  onBack: () => void;
  onChange: (next: BookProject) => void;
  embedded?: boolean;
  onContinueProof?: () => void;
  importSlot?: ReactNode;
  proofing?: boolean;
  boothTools?: ReactNode;
}) {
  const chapter = useMemo(
    () => project.chapters.find((item) => item.id === chapterId) ?? null,
    [project, chapterId],
  );

  const [chapterHtml, setChapterHtml] = useState("");
  const script = useMemo(
    () => buildBoothScriptFromHtml(chapterHtml, project.glossary ?? []),
    [chapterHtml, project.glossary],
  );
  const [highlight, setHighlight] = useState<PromptHighlightMode>(readHighlight);
  const [readingFont] = useState(readReadingFont);
  const [theme, setTheme] = useState(readPromptTheme);
  const [boothFontPx, setBoothFontPx] = useState(readBoothFontPx);
  const [lineSpacing, setLineSpacing] = useState(readSpacing);
  const [checkReading] = useState(() => readFlag(CHECK_KEY, false));
  const [stopOnMismatch, setStopOnMismatch] = useState(() => readFlag(HALT_KEY, false));
  const [inputId, setInputId] = useState(() => {
    try {
      return window.localStorage.getItem(MIC_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [halt, setHalt] = useState<LiveMismatch | null>(null);
  const [punchStatus, setPunchStatus] = useState<"idle" | "cueing" | "counting" | "restarting">("idle");
  const [boothNotice, setBoothNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [cursor, setCursor] = useState(chapter?.resumeWordIndex ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [followHint, setFollowHint] = useState("Voice follow starts when you record.");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [workingUrl, setWorkingUrl] = useState<string | null>(null);
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);

  const promptRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcm16kRef = useRef<Float32Array[]>([]);
  const pcm16kCountRef = useRef(0);
  const hopQueueRef = useRef<Float32Array[]>([]);
  const hopCountRef = useRef(0);
  const whisperBufRef = useRef<Float32Array[]>([]);
  const whisperCountRef = useRef(0);
  const whisperBusyRef = useRef(false);
  const streamingRef = useRef(false);
  const recordingRef = useRef(false);
  const pausedRef = useRef(false);
  const matchRef = useRef<LiveMatchState>({ cursor: 0, lastHeardEnd: 0 });
  const leadRef = useRef<LeadState>(createLeadState(0, performance.now()));
  const expectedRef = useRef<LiveExpectedWord[]>([]);
  const confirmedRef = useRef<RecordedWord[]>([]);
  const resumeFromRef = useRef(0);
  const tapeBaseRef = useRef(0);
  const clockOffsetRef = useRef(0);
  const speechAtRef = useRef(0);
  const haltRef = useRef<LiveMismatch | null>(null);
  const haltResumeRef = useRef<number | undefined>(undefined);
  const checkReadingRef = useRef(false);
  const stopOnMismatchRef = useRef(true);
  const punchBusyRef = useRef(false);
  const pickupsRef = useRef<ChapterPickup[]>([]);
  const dismissedRef = useRef<string[]>([]);
  const timerRef = useRef<number | null>(null);
  const leadRafRef = useRef<number | null>(null);
  const cursorRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const chapterRef = useRef(chapter);
  const projectRef = useRef(project);
  chapterRef.current = chapter;
  projectRef.current = project;
  expectedRef.current = script.expected;
  checkReadingRef.current = checkReading;
  stopOnMismatchRef.current = stopOnMismatch;
  pickupsRef.current = chapter?.pickups ?? [];

  useEffect(() => {
    let alive = true;
    void readChapterContent(project, chapterId).then((html) => {
      if (alive) {
        setChapterHtml(html);
      }
    });
    return () => {
      alive = false;
    };
  }, [project, chapterId]);

  useEffect(() => {
    const start = chapter?.resumeWordIndex ?? 0;
    cursorRef.current = start;
    setCursor(start);
    matchRef.current = { cursor: start, lastHeardEnd: 0 };
    leadRef.current = createLeadState(start, performance.now());
    resumeFromRef.current = start;
    haltRef.current = null;
    haltResumeRef.current = undefined;
    setHalt(null);
    clockOffsetRef.current = 0;
  }, [chapter?.id, chapter?.resumeWordIndex, script.expected.length]);

  useEffect(() => {
    const file = chapter?.originalFile;
    if (!file) {
      setOriginalUrl(null);
      return;
    }
    let revoked: string | null = null;
    void readChapterAudioUrl(project, file).then((url) => {
      revoked = url;
      setOriginalUrl(url);
    });
    return () => {
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [project, chapter?.originalFile]);

  useEffect(() => {
    const file = chapter?.workingFile;
    if (!file) {
      setWorkingUrl(null);
      return;
    }
    let revoked: string | null = null;
    void readChapterAudioUrl(project, file).then((url) => {
      revoked = url;
      setWorkingUrl(url);
    });
    return () => {
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [project, chapter?.workingFile]);

  useEffect(() => {
    return () => {
      window.kosmosNext?.stopLiveFollow?.().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function listInputs() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) {
          setAudioInputs(devices.filter((device) => device.kind === "audioinput" && device.deviceId));
        }
      } catch {
        // Permission comes with the first record.
      }
    }
    void listInputs();
    navigator.mediaDevices.addEventListener?.("devicechange", listInputs);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", listInputs);
    };
  }, []);

  const scrollToCursor = useCallback((index: number) => {
    const root = promptRef.current;
    const el = wordRefs.current.get(index) ?? wordRefs.current.get(Math.max(0, index - 1));
    if (!root || !el) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const bandY = root.clientHeight * 0.42;
    root.scrollTop += elRect.top - rootRect.top - bandY + elRect.height / 2;
  }, []);

  const updateBand = useCallback(
    (wordIndex: number) => {
      const para = script.paragraphs.find(
        (item) => wordIndex >= item.firstWord && wordIndex < item.firstWord + item.wordCount,
      ) ?? script.paragraphs[script.paragraphs.length - 1];
      if (!para) {
        setBand(null);
        return;
      }
      const tops: Array<number | null> = [];
      for (let index = para.firstWord; index < para.firstWord + para.wordCount; index += 1) {
        tops.push(wordRefs.current.get(index)?.getBoundingClientRect().top ?? null);
      }
      setBand(highlightBand(highlight, wordIndex, para, measureRows(para, tops)));
    },
    [highlight, script.paragraphs],
  );

  useEffect(() => {
    updateBand(cursor);
    const frame = window.requestAnimationFrame(() => scrollToCursor(cursor));
    return () => window.cancelAnimationFrame(frame);
  }, [cursor, highlight, chapterHtml, recording, paused, scrollToCursor, updateBand]);

  const filePickup = useCallback(
    (pickup: ChapterPickup) => {
      if (pickupIsSuppressed(pickup, projectRef.current.suppressedWords)) {
        return;
      }
      pickupsRef.current = mergeLivePickup(pickupsRef.current, pickup);
      onChange(applyChapterPickup(projectRef.current, chapterId, pickup));
    },
    [chapterId, onChange],
  );

  const applyHeard = useCallback((words: LiveTranscriptWord[]) => {
    if (!words.length || pausedRef.current || punchBusyRef.current) {
      return;
    }
    const shifted = words.map((word) => ({
      ...word,
      start: word.start + clockOffsetRef.current,
      end: word.end + clockOffsetRef.current,
    }));
    const result = matchLiveWindow({
      chapterId,
      expected: expectedRef.current,
      transcript: shifted,
      state: matchRef.current,
      flagsEnabled: checkReadingRef.current,
      haltOnMismatch: stopOnMismatchRef.current,
      haltRunWords: LIVE_HALT_RUN_WORDS,
      haltResumeIndex: haltResumeRef.current,
      dismissedIds: dismissedRef.current,
    });
    matchRef.current = result.state;
    for (const confirmation of result.confirmed) {
      confirmedRef.current.push({
        index: confirmation.expectedIndex,
        start: tapeBaseRef.current + confirmation.start,
        end: tapeBaseRef.current + confirmation.end,
      });
      if (!haltRef.current) {
        leadRef.current = leadOnConfirm(leadRef.current, confirmation.expectedIndex + 1, performance.now());
      }
    }
    if (result.flag && checkReadingRef.current) {
      const pickup = pickupFromLiveFlag(result.flag, chapterId);
      filePickup({
        ...pickup,
        t_start: tapeBaseRef.current + pickup.t_start,
        t_end: tapeBaseRef.current + pickup.t_end,
        line_start: pickup.line_start != null ? tapeBaseRef.current + pickup.line_start : undefined,
        line_end: pickup.line_end != null ? tapeBaseRef.current + pickup.line_end : undefined,
      });
    }
    if (result.halt) {
      haltRef.current = result.halt;
      setHalt(result.halt);
      leadRef.current = createLeadState(result.halt.expectedIndex, performance.now());
      cursorRef.current = result.halt.expectedIndex;
      setCursor(result.halt.expectedIndex);
      setFollowHint(`Lost the page around “${result.halt.expected}”. Recording keeps going.`);
      return;
    }
    if (haltRef.current) {
      cursorRef.current = haltRef.current.expectedIndex;
      setCursor(haltRef.current.expectedIndex);
      return;
    }
    const next = Math.max(resumeFromRef.current, result.state.cursor);
    cursorRef.current = next;
    setCursor(next);
    const total = expectedRef.current.length;
    if (total > 0 && next / total >= 0.98) {
      setFollowHint("Chapter coverage is complete.");
    }
  }, [chapterId, filePickup]);

  useEffect(() => {
    const stop = window.kosmosNext?.onLiveWords?.((words) => {
      applyHeard(words);
    });
    return () => {
      stop?.();
    };
  }, [applyHeard]);

  const runLead = useCallback(() => {
    if (!recordingRef.current || pausedRef.current || haltRef.current || punchBusyRef.current) {
      return;
    }
    const advanced = leadAdvance(
      leadRef.current,
      performance.now(),
      expectedRef.current.length,
      highlight === "word",
      speechAtRef.current || null,
    );
    leadRef.current = advanced.state;
    if (advanced.cursor !== cursorRef.current) {
      cursorRef.current = advanced.cursor;
      setCursor(advanced.cursor);
    }
    leadRafRef.current = requestAnimationFrame(runLead);
  }, [highlight]);

  const cleanupCapture = useCallback(() => {
    recordingRef.current = false;
    pausedRef.current = false;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (leadRafRef.current) {
      cancelAnimationFrame(leadRafRef.current);
      leadRafRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    void window.kosmosNext?.stopLiveFollow?.().catch(() => undefined);
  }, []);

  useEffect(() => cleanupCapture, [cleanupCapture]);

  async function flushWhisperWindow() {
    if (whisperBusyRef.current || streamingRef.current || whisperCountRef.current < TARGET_RATE * 0.8) {
      return;
    }
    const count = whisperCountRef.current;
    const samples = new Float32Array(count);
    let offset = 0;
    while (whisperBufRef.current.length) {
      const head = whisperBufRef.current.shift();
      if (!head) {
        break;
      }
      samples.set(head, offset);
      offset += head.length;
    }
    whisperCountRef.current = 0;
    if (!window.kosmosNext?.transcribeHop) {
      return;
    }
    whisperBusyRef.current = true;
    try {
      const wav = encodePcmWav(samples, TARGET_RATE);
      const base64 = await blobToBase64(wav);
      const result = await window.kosmosNext.transcribeHop({ wavBase64: base64 });
      if (result.words?.length) {
        applyHeard(result.words);
        if (checkReadingRef.current) {
          const flag = liveBackFlag({
            chapterId,
            expected: expectedRef.current,
            transcript: result.words.map((word) => ({
              ...word,
              start: word.start + clockOffsetRef.current,
              end: word.end + clockOffsetRef.current,
            })),
            state: matchRef.current,
            flagsEnabled: true,
            goldCursor: cursorRef.current,
            dismissedIds: dismissedRef.current,
          });
          if (flag) {
            const pickup = pickupFromLiveFlag(flag, chapterId);
            filePickup({
              ...pickup,
              t_start: tapeBaseRef.current + pickup.t_start,
              t_end: tapeBaseRef.current + pickup.t_end,
              line_start: pickup.line_start != null ? tapeBaseRef.current + pickup.line_start : undefined,
              line_end: pickup.line_end != null ? tapeBaseRef.current + pickup.line_end : undefined,
            });
          }
        }
      }
    } catch {
      // Follow stays on the last confirmed word.
    } finally {
      whisperBusyRef.current = false;
    }
  }

  function handleBlock(input: Float32Array, rms: number) {
    if (!recordingRef.current || pausedRef.current || punchBusyRef.current) {
      return;
    }
    setLevel(Math.min(1, rms * 2.4));
    if (rms > 0.02) {
      speechAtRef.current = performance.now();
    }
    const mono = resamplePcmToMono(input, audioCtxRef.current?.sampleRate ?? TARGET_RATE, TARGET_RATE);
    pcm16kRef.current.push(mono);
    pcm16kCountRef.current += mono.length;

    if (streamingRef.current && window.kosmosNext?.sendLivePcm) {
      hopQueueRef.current.push(mono);
      hopCountRef.current += mono.length;
      const hop = Math.round(TARGET_RATE * LIVE_STREAM_HOP_SECONDS);
      while (hopCountRef.current >= hop) {
        const block = takeQueued(hopQueueRef, hopCountRef, hop);
        window.kosmosNext.sendLivePcm({ pcmBase64: float32ToBase64(block) });
      }
    } else {
      whisperBufRef.current.push(mono);
      whisperCountRef.current += mono.length;
      if (whisperCountRef.current >= TARGET_RATE * WHISPER_WINDOW_SECONDS) {
        void flushWhisperWindow();
      }
    }
  }

  async function startSession(fromBeginning: boolean) {
    setError(null);
    const current = chapterRef.current;
    const startIndex = fromBeginning ? 0 : current?.resumeWordIndex ?? 0;
    resumeFromRef.current = startIndex;
    matchRef.current = { cursor: startIndex, lastHeardEnd: 0 };
    leadRef.current = createLeadState(startIndex, performance.now());
    confirmedRef.current = [];
    pcm16kRef.current = [];
    pcm16kCountRef.current = 0;
    hopQueueRef.current = [];
    hopCountRef.current = 0;
    whisperBufRef.current = [];
    whisperCountRef.current = 0;
    tapeBaseRef.current = resumeSecondsOf(current?.recordedWords, startIndex);
    clockOffsetRef.current = 0;
    haltRef.current = null;
    haltResumeRef.current = undefined;
    punchBusyRef.current = false;
    setHalt(null);
    setPunchStatus("idle");
    setCursor(startIndex);
    scrollToCursor(startIndex);

    setFollowHint("Starting voice follow…");
    let streaming = false;
    if (window.kosmosNext?.startLiveFollow) {
      const warmed = await window.kosmosNext.startLiveFollow();
      streaming = Boolean(warmed.ok && warmed.streaming);
      streamingRef.current = streaming;
      setFollowHint(
        streaming
          ? "Listening. The highlight follows what you read."
          : "Using the speech model in short windows. Read naturally.",
      );
    } else {
      streamingRef.current = false;
      setFollowHint("Desktop follow is unavailable in this preview. Recording still saves.");
    }

    const audio: MediaTrackConstraints | boolean = inputId
      ? { deviceId: { exact: inputId }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    streamRef.current = stream;
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      setAudioInputs(devices.filter((device) => device.kind === "audioinput" && device.deviceId));
    });
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (const sample of input) {
        sum += sample * sample;
      }
      handleBlock(new Float32Array(input), input.length ? Math.sqrt(sum / input.length) : 0);
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);

    recordingRef.current = true;
    pausedRef.current = false;
    setRecording(true);
    setPaused(false);
    setElapsed(0);
    startedAtRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      if (!pausedRef.current) {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }
    }, 250);
    leadRafRef.current = requestAnimationFrame(runLead);
  }

  async function startRecording() {
    try {
      await startSession(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Microphone unavailable.");
      cleanupCapture();
    }
  }

  function resumeFromHalt() {
    const halted = haltRef.current;
    if (!halted) {
      return;
    }
    haltResumeRef.current = halted.expectedIndex;
    haltRef.current = null;
    setHalt(null);
    matchRef.current = {
      cursor: matchRef.current.cursor,
      lastHeardEnd: Math.max(matchRef.current.lastHeardEnd, clockOffsetRef.current),
      recentHeard: [],
    };
    leadRef.current = createLeadState(matchRef.current.cursor, performance.now());
    setFollowHint("Listening. The highlight follows what you read.");
    leadRafRef.current = requestAnimationFrame(runLead);
  }

  function currentConfirmations(): LiveWordConfirmation[] {
    return confirmedRef.current.map((word) => ({
      expectedIndex: word.index,
      start: word.start - tapeBaseRef.current,
      end: word.end - tapeBaseRef.current,
      confidence: 1,
    }));
  }

  function markForReview() {
    if (!recordingRef.current || pausedRef.current) {
      return;
    }
    const pickup = manualLivePickup({
      chapterId,
      expected: expectedRef.current,
      confirmations: currentConfirmations().map((word) => ({
        ...word,
        start: word.start + tapeBaseRef.current,
        end: word.end + tapeBaseRef.current,
      })),
      cursor: cursorRef.current,
    });
    if (!pickup) {
      setBoothNotice("Read a few words before placing a marker.");
      return;
    }
    filePickup(pickup);
    setBoothNotice(`Marked “${pickup.expected}” for Review.`);
  }

  async function restartSentence() {
    if (punchBusyRef.current || !recordingRef.current || pausedRef.current) {
      return;
    }
    const plan = planLivePunchRoll(
      expectedRef.current,
      currentConfirmations(),
      haltRef.current?.expectedIndex ?? matchRef.current.cursor,
      PICKUP_PREROLL_SECONDS,
    );
    if (!plan) {
      setError("Read a little farther before restarting so Kosmos has a clean recorded boundary.");
      return;
    }
    const cue = buildLivePunchCue(
      pcm16kRef.current,
      TARGET_RATE,
      Math.max(0, plan.cueFromSeconds),
      Math.max(0, plan.punchAtSeconds),
    );
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    punchBusyRef.current = true;
    pausedRef.current = true;
    setPaused(true);
    setPunchStatus(cue.kind === "recorded" ? "cueing" : "counting");
    tracks.forEach((track) => {
      track.enabled = false;
    });
    try {
      await audioCtxRef.current?.suspend();
      await playPunchCue(cue.samples, TARGET_RATE);
      setPunchStatus("restarting");
      const punchAt = plan.punchAtSeconds;
      if (window.kosmosNext?.restartLiveFollow) {
        const restarted = await window.kosmosNext.restartLiveFollow({ truncateToSeconds: punchAt });
        streamingRef.current = Boolean(restarted.ok && restarted.streaming);
      }
      pcm16kRef.current = truncateLiveTape(pcm16kRef.current, TARGET_RATE, punchAt);
      pcm16kCountRef.current = pcm16kRef.current.reduce((total, chunk) => total + chunk.length, 0);
      hopQueueRef.current = [];
      hopCountRef.current = 0;
      whisperBufRef.current = [];
      whisperCountRef.current = 0;
      clockOffsetRef.current = punchAt;
      confirmedRef.current = confirmedRef.current.filter((word) => word.start < tapeBaseRef.current + punchAt);
      matchRef.current = { cursor: plan.restartIndex, lastHeardEnd: punchAt, recentHeard: [] };
      haltRef.current = null;
      haltResumeRef.current = plan.restartIndex;
      setHalt(null);
      cursorRef.current = plan.restartIndex;
      setCursor(plan.restartIndex);
      leadRef.current = createLeadState(plan.restartIndex, performance.now());
      await audioCtxRef.current?.resume();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not restart the sentence.");
    } finally {
      tracks.forEach((track) => {
        track.enabled = true;
      });
      punchBusyRef.current = false;
      pausedRef.current = false;
      setPaused(false);
      setPunchStatus("idle");
      setFollowHint("Picked up at the sentence. Recording continues on the original tape.");
      leadRafRef.current = requestAnimationFrame(runLead);
    }
  }

  function pauseRecording() {
    pausedRef.current = true;
    setPaused(true);
    pausedAtRef.current = Date.now();
    setFollowHint("Paused. Your place is held. Resume adds to the same original tape.");
  }

  function resumeRecording() {
    if (pausedAtRef.current) {
      startedAtRef.current += Date.now() - pausedAtRef.current;
    }
    pausedRef.current = false;
    setPaused(false);
    setFollowHint("Listening. The highlight follows what you read.");
    leadRafRef.current = requestAnimationFrame(runLead);
  }

  async function stopAndSave() {
    setSaving(true);
    recordingRef.current = false;
    await flushWhisperWindow();
    const samples = joinQueued(pcm16kRef.current);
    pcm16kRef.current = [];
    pcm16kCountRef.current = 0;
    cleanupCapture();
    setRecording(false);
    setPaused(false);
    setLevel(0);

    const current = chapterRef.current;
    const fromIndex = resumeFromRef.current;
    const existing = current?.originalFile
      ? await readChapterAudioBytes(projectRef.current, current.originalFile)
      : null;
    const blob = concatWav(existing, samples, TARGET_RATE, tapeBaseRef.current);
    let file: string | null = current?.originalFile ?? null;
    if (blob.size > 0) {
      file = await writeChapterAudio(projectRef.current, chapterId, blob, { slot: "original" });
    }

    const recordedWords = mergeRecordedWords(current?.recordedWords, confirmedRef.current, fromIndex);
    const resumeWordIndex = Math.max(
      fromIndex,
      recordedWords.reduce((max, word) => Math.max(max, word.index + 1), fromIndex),
      cursor,
    );
    const recordedPct = coverageOf(resumeWordIndex, script.expected.length || 1);
    onChange(
      applyOriginalTape(projectRef.current, chapterId, {
        file,
        recordedPct: recordedPct >= 0.98 ? 1 : recordedPct,
        resumeWordIndex,
        recordedWords,
      }),
    );
    setSaving(false);
    setFollowHint(
      recordedPct >= 0.98
        ? "Original tape saved. Proofreading uses this file."
        : "Original tape saved. Continue recording picks up from this word.",
    );
  }

  async function startOver() {
    if (!window.confirm("Replace the original tape and start this chapter from the beginning?")) {
      return;
    }
    cleanupCapture();
    setRecording(false);
    setPaused(false);
    onChange(clearOriginalTape(projectRef.current, chapterId));
    setCursor(0);
    scrollToCursor(0);
    setFollowHint("Original tape cleared. Start recording from the first word.");
    try {
      await startSession(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Microphone unavailable.");
    }
  }

  function chooseResume(index: number) {
    if (recordingRef.current) {
      return;
    }
    setCursor(index);
    const current = chapterRef.current;
    if (current) {
      onChange(
        applyOriginalTape(projectRef.current, chapterId, {
          file: current.originalFile ?? null,
          recordedPct: current.recordedPct,
          resumeWordIndex: index,
          recordedWords: current.recordedWords,
        }),
      );
    }
    scrollToCursor(index);
    setFollowHint("Continue will record from this word onto the original tape.");
  }

  function setHighlightMode(mode: PromptHighlightMode) {
    setHighlight(mode);
    try {
      window.localStorage.setItem(HIGHLIGHT_KEY, mode);
    } catch {
      // Non-fatal.
    }
  }

  function persistChoice(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Non-fatal.
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const action = boothShortcutAction({
        key: event.key,
        recording: recordingRef.current,
        paused: pausedRef.current,
        halted: haltRef.current !== null,
        repeat: event.repeat,
        editing,
      });
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "continue") {
        resumeFromHalt();
      } else if (action === "restart") {
        void restartSentence();
      } else if (action === "mark") {
        markForReview();
      } else if (pausedRef.current) {
        resumeRecording();
      } else {
        pauseRecording();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!chapter) {
    return (
      <section className="ma-screen ma-record" aria-label="Record">
        <button type="button" className="ma-back" onClick={onBack}>
          <ChevronLeft />
          <span>{project.title}</span>
        </button>
        <p className="ma-chapter-empty">This chapter no longer exists.</p>
      </section>
    );
  }

  const voiceStatus: LiveVoiceStatus = saving
    ? "processing"
    : recording && paused
      ? "paused"
      : recording
        ? "listening"
        : "off";
  const workflow = teleprompterWorkflow({
    hasSavedTape: Boolean(chapter.originalFile),
    hasPendingDraft: false,
    recording,
    paused,
    status: voiceStatus,
  });
  const shownPct = Math.round(
    coverageOf(Math.max(chapter.resumeWordIndex, cursor), script.expected.length || 1) * 100,
  );
  const inBand = (index: number) => Boolean(band && index >= band.from && index <= band.to);

  function onPrimary() {
    if (workflow.primaryLabel === "Stop recording") {
      void stopAndSave();
      return;
    }
    if (workflow.primaryLabel === "Resume recording") {
      resumeRecording();
      return;
    }
    void startRecording();
  }

  return (
    <section className={embedded ? "ma-record-embed" : "ma-screen ma-record"} aria-label={`Record ${chapter.title}`}>
      {!embedded ? (
        <header className="ma-record-head">
          <button type="button" className="ma-back" onClick={onBack} aria-label="Back to chapter">
            <ChevronLeft />
            <span>{chapter.title}</span>
          </button>
        </header>
      ) : (
        <div className="booth-chrome">
          <button type="button" className="booth-tool" onClick={() => setReadingOpen(true)} title="Teleprompter">
            <TypeGlyph />
            <span>Page</span>
          </button>
        </div>
      )}

      <section className="ma-flow-block ma-flow-prompt" aria-label="Teleprompter">
        <div className={`ma-teleprompter is-${theme} font-${readingFont}`} style={{ fontSize: `${boothFontPx}px` }}>
          <div className="ma-teleprompter-scroll" ref={promptRef}>
            <div className="ma-teleprompter-inner" style={{ lineHeight: lineSpacing }}>
              {script.paragraphs.length ? (
                script.paragraphs.map((para, paraIndex) => {
                  let word = para.firstWord;
                  const paraCurrent = cursor >= para.firstWord && cursor < para.firstWord + para.wordCount;
                  const heading = isSpokenChapterHeading(
                    para.tokens.map((token) => token.text).join(""),
                    chapter.title,
                  );
                  return (
                    <p
                      key={paraIndex}
                      className={`ma-tp-line${heading ? " is-heading" : ""}${paraCurrent && highlight === "paragraph" ? " is-current" : ""}`}
                    >
                      {para.tokens.map((token, tokenIndex) => {
                        const glossary = token.glossaryId
                          ? glossaryEntry(project.glossary, token.glossaryId)
                          : undefined;
                        const markClass = tokenMarkClass(token);
                        if (!token.isWord) {
                          return (
                            <span
                              key={tokenIndex}
                              className={markClass.trim() || undefined}
                              style={tokenMarkStyle(token)}
                            >
                              {token.text}
                            </span>
                          );
                        }
                        const index = word;
                        word += 1;
                        const isNow = highlight === "word" && index === cursor;
                        const covered = highlight !== "word" && inBand(index);
                        const flagged = (chapter.pickups ?? []).some(
                          (pickup) => pickup.status === "open" && pickup.manuscript_index === index,
                        );
                        const haltedHere = halt?.expectedIndex === index;
                        return (
                          <span
                            key={tokenIndex}
                            ref={(node) => {
                              if (node) {
                                wordRefs.current.set(index, node);
                              } else {
                                wordRefs.current.delete(index);
                              }
                            }}
                            className={`ma-tp-word${markClass}${isNow ? " is-now" : ""}${covered ? " in-band" : ""}${flagged ? " is-flagged" : ""}${haltedHere ? " is-halt" : ""}`}
                            style={tokenMarkStyle(token)}
                            title={glossary?.respell ?? (glossary ? "Pronunciation" : undefined)}
                            onClick={() => chooseResume(index)}
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </p>
                  );
                })
              ) : (
                <p className="ma-teleprompter-empty">No text yet. Add chapter content to use the teleprompter.</p>
              )}
            </div>
          </div>
          <div className="ma-teleprompter-guide" aria-hidden="true">
            <span className="ma-teleprompter-caret" />
            <span className="ma-teleprompter-caret is-right" />
          </div>
        </div>
      </section>

      <section className="ma-flow-block ma-booth-mic" aria-label="Mic and control">
        {boothNotice ? <p className="ma-booth-notice" role="status">{boothNotice}</p> : null}
        {punchStatus !== "idle" ? (
          <div className="ma-booth-halt" role="status">
            <strong>
              {punchStatus === "cueing"
                ? "Rolling into the sentence"
                : punchStatus === "counting"
                  ? "Counting into the sentence"
                  : "Rewinding the clean take"}
            </strong>
          </div>
        ) : null}
        {halt && punchStatus === "idle" ? (
          <div className="ma-booth-halt" role="alert">
            <div>
              <strong>{liveHaltCopy(halt).title}</strong>
              <span>{liveHaltCopy(halt).detail}</span>
            </div>
            <div className="ma-booth-halt-actions">
              <button type="button" className="btn btn-sm" onClick={() => void restartSentence()}>
                Restart sentence
              </button>
              <button type="button" className="btn" onClick={resumeFromHalt}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        <div className="ma-booth-rail">
          <div className="ma-booth-panel ma-booth-session">
            <p className="ma-booth-kicker">Take</p>
            <div className="ma-level" aria-hidden="true">
              <span className="ma-level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <div className="ma-recorder-controls">
              {workflow.primaryLabel ? (
                <button
                  type="button"
                  className={recording && !paused ? "ma-rec-btn is-recording" : "ma-rec-btn"}
                  onClick={onPrimary}
                  disabled={saving}
                >
                  <span className={recording && !paused ? "ma-rec-dot is-stop" : "ma-rec-dot"} />
                  {saving ? "Saving…" : workflow.primaryLabel === "Resume recording" ? "Continue" : workflow.primaryLabel}
                </button>
              ) : (
                <span className="ma-rec-time">Saving…</span>
              )}
              {recording && !paused ? (
                <button type="button" className="ma-rec-btn is-pause" onClick={pauseRecording}>
                  <PauseGlyph />
                  Pause
                </button>
              ) : null}
              {!recording && (workflow.canStartOver || chapter.originalFile) ? (
                <div className="ma-rec-row">
                  {workflow.canStartOver ? (
                    <button type="button" className="booth-tool" onClick={() => void startOver()}>
                      <RestartGlyph />
                      Start over
                    </button>
                  ) : null}
                  {chapter.originalFile ? (
                    <button
                      type="button"
                      className="booth-tool is-danger"
                      onClick={() => {
                        if (window.confirm("Delete this chapter’s original recording? Proof flags on it will go too.")) {
                          onChange(clearOriginalTape(projectRef.current, chapterId));
                        }
                      }}
                    >
                      <TrashGlyph />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
              {embedded && onContinueProof && shownPct >= 100 ? (
                <button type="button" className="booth-tool is-primary" onClick={onContinueProof} disabled={proofing}>
                  <ProofGoGlyph />
                  <span>{proofing ? "Proofing…" : "Proofread"}</span>
                </button>
              ) : null}
            </div>
          </div>

          {(originalUrl || workingUrl) && !recording ? (
            <div className="ma-booth-panel ma-tape">
              <p className="ma-booth-kicker">Tape</p>
              {originalUrl ? <TapePlayer src={originalUrl} label="Original" /> : null}
              {workingUrl ? <TapePlayer src={workingUrl} label="Working" /> : null}
            </div>
          ) : null}

          <div className="ma-booth-panel ma-booth-place">
            <p className="ma-booth-kicker">Place</p>
            <div className="ma-booth-place-meter" aria-label={`${shownPct} percent of the page`}>
              <span className="ma-dash-meter-track">
                <i style={{ width: `${shownPct}%` }} />
              </span>
            </div>
            <p className="ma-booth-place-label">{shownPct}% of the page</p>
            <p className="ma-booth-place-copy">
              Word {Math.min(script.expected.length, cursor + 1)} of {script.expected.length || 0}
            </p>
            <p className="ma-booth-place-copy">
              {recording ? formatTime(elapsed) : chapter.originalFile ? "Original saved" : "Ready"}
            </p>
          </div>

          <div className="ma-booth-panel ma-booth-setup">
            <p className="ma-booth-kicker">Booth</p>
            <label className="ma-booth-input">
              <MicInputGlyph />
              <span className="ma-visually-hidden">Microphone</span>
              <select
                value={inputId}
                disabled={recording}
                onChange={(event) => {
                  setInputId(event.target.value);
                  persistChoice(MIC_KEY, event.target.value);
                }}
              >
                <option value="">System default</option>
                {audioInputs.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="booth-tool-row">
              {boothTools}
              {importSlot}
            </div>
          </div>
          {error ? <p className="ma-error">{error}</p> : null}
          <p className="ma-visually-hidden">{followHint}</p>
          <DebugFinishTakeButton project={project} chapterId={chapterId} onChange={onChange} />
        </div>
      </section>

      {readingOpen ? (
        <BoothSheet title="Teleprompter" wide onClose={() => setReadingOpen(false)}>
          <BoothReadingPanel
            highlight={highlight}
            lineSpacing={lineSpacing}
            onHighlight={setHighlightMode}
            onSpacing={(value) => {
              setLineSpacing(value);
              persistChoice(SPACING_KEY, String(value));
            }}
            theme={theme}
            onTheme={(value) => {
              setTheme(value);
              writePromptTheme(value);
            }}
            fontPx={boothFontPx}
            onFontPx={(value) => setBoothFontPx(writeBoothFontPx(value))}
          />
        </BoothSheet>
      ) : null}
    </section>
  );
}

function takeQueued(queue: { current: Float32Array[] }, countRef: { current: number }, hop: number): Float32Array {
  const out = new Float32Array(hop);
  let filled = 0;
  while (filled < hop && queue.current.length) {
    const head = queue.current[0];
    const need = hop - filled;
    if (head.length <= need) {
      out.set(head, filled);
      filled += head.length;
      queue.current.shift();
    } else {
      out.set(head.subarray(0, need), filled);
      queue.current[0] = head.subarray(need);
      filled += need;
    }
  }
  countRef.current = Math.max(0, countRef.current - filled);
  return out;
}

function joinQueued(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read audio."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TypeGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.2V3.2h9.6v1M8 3.2v9.6M5.8 12.8h4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MicInputGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.2" y="2.2" width="5.6" height="8" rx="2.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.6 8.2a4.4 4.4 0 0 0 8.8 0M8 12.6V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.4h1.8v9.2H5.2zM9 3.4h1.8v9.2H9z" fill="currentColor" />
    </svg>
  );
}

function RestartGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.4 8a4.6 4.6 0 1 0 1.2-3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.2 2.8v3.2h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.4h9.6M6.2 4.4V3.2h3.6v1.2M5.1 4.4l.5 8.2h4.8l.5-8.2" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function ProofGoGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 2.6h5.6L12.4 5.4v8H4.2V2.6Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9.6 2.8V5.4h2.6M6 8.2h4.2M6 10.6h3.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function glossaryEntry(glossary: GlossaryEntry[] | undefined, id: string): GlossaryEntry | undefined {
  return glossary?.find((entry) => entry.id === id);
}

function tokenMarkClass(token: { dialogue?: boolean; seat?: string; glossaryId?: string }): string {
  const classes: string[] = [];
  if (token.seat === "N1") {
    classes.push("is-n1");
  } else if (token.seat === "N2") {
    classes.push("is-n2");
  } else if (token.dialogue) {
    classes.push("is-dialogue");
  }
  if (token.glossaryId) {
    classes.push("is-glossary");
  }
  return classes.length ? ` ${classes.join(" ")}` : "";
}

function tokenMarkStyle(token: { style?: Array<"bold" | "italic" | "underline" | "highlight"> }): {
  fontWeight?: number;
  fontStyle?: string;
  textDecoration?: string;
  background?: string;
} | undefined {
  if (!token.style?.length) {
    return undefined;
  }
  return {
    fontWeight: token.style.includes("bold") ? 700 : undefined,
    fontStyle: token.style.includes("italic") ? "italic" : undefined,
    textDecoration: token.style.includes("underline") ? "underline" : undefined,
    background: token.style.includes("highlight") ? "rgba(255, 255, 255, 0.16)" : undefined,
  };
}
