# Live follow latency architecture

> **For Hermes:** Architecture plan only. Do not implement in this pass. Do not swap off whisper.cpp `small.en`. Do not add cloud ASR.

**Goal:** Cut perceived live-follow delay so the highlight lands with the narrator (target ~200–400 ms after a word ends), while Space/PageDown stay independent and live flags stay conservative.

**Architecture:** Keep the hot local `whisper-server` + `matchLiveWindow` path. Stop waiting for a full 2 s window, hop every ~400 ms over a ~2.8 s context, commit only a stable prefix, gate silence with renderer VAD, and paint the cursor without React/interval/smooth-scroll lag. Encoder time is the remaining floor; do not pretend WAV/IPC are the bottleneck.

**Tech stack:** Electron renderer (`App.tsx` ScriptProcessor capture) → IPC `proof:transcribe-buffer` → `PersistentWhisperServer` (`electron/asr-server.cjs`) → whisper.cpp `small.en` → `matchLiveWindow` → CSS `.teleprompter-word-live`.

---

## Current pipeline (measured from code, not theory)

```
mic → ScriptProcessor(4096) @ ~48 kHz (~85 ms)
    → accumulate until LIVE_WINDOW_SECONDS = 2.0
    → keep 0.8 s overlap (hop ≈ 1.2 s of new audio)
    → liveRequestRef single-flight (next flush waits)
    → resample 48k→16k → encodeWavPcm16 (forEach) → btoa
    → IPC string clone → decode base64
    → FormData Blob POST /inference (verbose_json, token_timestamps)
    → whisper-server (model hot; -bs 1 -bo 1 -sow; flash-attn already default true)
    → JSON words → matchLiveWindow
    → setInterval animateLiveCursor (80–140 ms × N words)
    → setState × 5 → re-render every manuscript word span
    → scrollIntoView({ block: "center", behavior: "smooth" })
```

| Stage | Typical cost | False-advance role |
|---|---|---|
| Wait for 2.0 s window / 1.2 s hop | **1200–2000 ms** (dominant perceived lag) | None by itself |
| ScriptProcessor 4096 + WebRTC AEC/NS/AGC | 20–85 ms | AGC can pump noise into Whisper |
| resample + WAV `forEach` + `btoa` + IPC | 5–20 ms | None |
| HTTP FormData to loopback | 5–15 ms | None |
| Whisper encoder (`audio_ctx=1500` ≈ 30 s pad) | **200–800+ ms** on Metal small.en | Silence pad → “thanks for watching” |
| Whisper decoder (greedy, ~2 s of speech) | 50–250 ms | Hallucinated tokens |
| `animateLiveCursor` interval | **80–140 ms × words in hop** | Makes a late result later |
| Full Teleprompter re-render + smooth scroll | 50–400 ms | Scroll fights Space/PageDown |

`liveLatencyMs` only times `transcribeLiveWindow` (encode → IPC → Whisper). It **hides** the 2 s buffer wait and the animation/scroll tail. First highlight cannot appear before ~2.3–3.5 s of speech.

Already done (do not redo): persistent server + warm on start; CLI live uses `-fa -bs 1`; WAV skips ffmpeg (`inputIsPcmWav`); highlight is last committed word (`liveHighlightWordIndex = cursor - 1`); flags need confidence ≥ 0.9.

Not done: hop clock, unstable tail, VAD, suppress-nst, committed-text prompt, paint without React, pipelining, session-long keep-alive (idle kill is 30 s).

**small.en window/hop (do not guess later):**

- Encoder cost is almost independent of clip length (30 s mel pad). A 2.8 s context is not meaningfully slower than 1.0 s.
- < ~2.0 s of context: hallucinations + bad word times. Do **not** ship a 500 ms window.
- > ~4 s: more decoder tokens, more de-dupe, slower first paint.
- **Ship: 2.8 s context, 400 ms hop, 320 ms unstable tail.** Prime once to 2.8 s, then decode on every hop. Do not wait for another full 2–3 s.

---

## Constraints (non-negotiable)

1. Stay on bundled whisper.cpp `small.en` + `whisper-server` / CLI fallback.
2. Space / PageDown remain live and independent (`App.tsx` ~2255). Do not bind them to ASR.
3. Flags stay conservative: threshold 0.9, no future-script prompt, no cursor move from speculative paint.
4. No Silero `--vad` until a VAD model is vendored (`vendor/models` has only the small.en README).
5. Do not loosen `LIVE_RESYNC_LOOKAHEAD` or “advance on high-conf mismatch” as a latency trick.

---

## Ranked changes

Rank = perceived latency win vs risk of false advance. Implement in this order. Stop after 6 if follow already feels on-voice; 7+ are spikes.

### 1. Hop clock + unstable-tail commit — ~1.2–1.8 s win / low risk if tail is hard

**Why:** The 2.0 s wait is most of what they feel. Incremental decode is “don’t wait for a full window,” not “shrink Whisper’s clip to 400 ms.”

**Files:**
- Extract from `src/app/App.tsx` (~1803, 2020–2182): create `src/core/teleprompter/live-window.ts`
- Modify `src/core/teleprompter/live.ts` (`matchLiveWindow`)
- Test: `src/core/teleprompter/live-window.test.ts`, extend `live.test.ts`

**What:**
- Constants: `LIVE_CONTEXT_SECONDS = 2.8`, `LIVE_HOP_SECONDS = 0.4`, `LIVE_TAIL_SECONDS = 0.32`.
- After prime, `flushLiveWindow` fires every hop, sending the last 2.8 s (not 2.0).
- Overlap = context − hop (2.4 s). Keep `lastHeardEnd` de-dupe (already +50 ms).
- Before matching, drop transcript words with `end > windowStart + windowDuration - LIVE_TAIL_SECONDS`. Those are the unstable tail.
- Still never move cursor backwards.
- First paint: as soon as the first hop after prime returns (≈ 2.8 s + encode), then every ~400 ms.

**Do not:** set window to 0.5–1.0 s to “feel faster.” That is how small.en invents words and skips ahead.

**Verify:** unit-test that a word ending 100 ms before window end does not advance cursor until a later hop; a word ending 500 ms before window end does.

---

### 2. Renderer energy VAD — skip silence — 0–800 ms + the main false-advance kill / very low risk

**Why:** Silence still enters Whisper. Padded encoder + decoder hallucinations (`thanks`, `you`, `the`) plus `LIVE_RESYNC_LOOKAHEAD = 8` can jump the highlight. RMS is already computed in `processor.onaudioprocess`.

**Files:**
- Create `src/core/teleprompter/live-vad.ts` + `live-vad.test.ts`
- Modify `src/app/App.tsx` `flushLiveWindow` / hop scheduler

**What:**
- Frame RMS (reuse the 4096 callback). Speech if RMS ≥ ~0.01 (tune against the existing meter, which displays `rms * 8`).
- Send a hop only if the **new** 400 ms contains ≥ 120 ms of speech, **or** the 2.8 s context has ≥ 250 ms of speech.
- On silence hops: do not IPC, do not touch cursor, do not emit flags, do not bump `lastHeardEnd`.
- Optional: trim leading/trailing silence from the WAV with 80 ms pad so Whisper sees less zero-pad (helps hallucinations; tiny latency win).

**Do not:** enable `whisper-server --vad` without vendoring `ggml-silero-v5.1.2.bin` (not in `vendor/models`).

**Verify:** all-quiet 2.8 s fixture → no `transcribeBuffer` call; speech+pause+speech still advances only on spoken words.

---

### 3. Kill `animateLiveCursor` interval — 200–500 ms after each ASR result / very low risk

**Why:** After Whisper already paid 300–800 ms, the UI still walks the cursor at 80–140 ms/word. Three words = +240–420 ms. CSS already has `transition: background 120ms`.

**Files:**
- `src/app/App.tsx` `animateLiveCursor` (~1946–1970)
- Keep `src/core/teleprompter/model.ts` `liveHighlightWordIndex` (last committed word only)

**What:**
- Jump `liveVisualCursorRef` / paint to the new committed cursor in one shot.
- No `setInterval`. If a 2–3 word jump feels harsh, one rAF ease ≤ 120 ms **total**, not per word.
- Do not change matcher semantics.

**Verify:** existing `live.test.ts` unchanged; a 4-word hop paints the last committed word on the next frame.

---

### 4. Paint + scroll without re-rendering the chapter — 50–400 ms jank / very low risk

**Why:** `setLiveCursor` re-renders `Teleprompter` (~4750-line parent). Every word span re-runs `promptTextTokens`. Then `useEffect` (~1935) `scrollIntoView({ behavior: "smooth", block: "center" })` fights manual Space/PageDown.

**Files:**
- `src/app/App.tsx` highlight effect + word `className={isLiveWord ? ...}`
- `src/styles.css` `.teleprompter-word-live` / `.teleprompter-line-live`
- Optional extract: `src/core/teleprompter/live-paint.ts`

**What:**
- Keep `wordRefs`. Toggle `teleprompter-word-live` / `teleprompter-line-live` via `classList` (and a distinct `teleprompter-word-speculative` later).
- Throttle status chrome (`setLiveHeardText`, `setLiveLatencyMs`, `setLiveStatus`) to rAF / 250 ms. Do not set `"processing"` every hop (checkbox currently disables on processing — that will flicker).
- Scroll only when the live word leaves a center band (e.g. 30–70% of `scrollRef`). Use `behavior: "auto"`, never `"smooth"`.
- Space/PageDown keep their own `scrollBy`; do not cancel them.

**Verify:** toggling highlight does not remount glossary/line nodes; Space still pages while follow is on.

---

### 5. Pipeline: 1 in-flight + 1 latest-pending — 200–800 ms when encode > hop / low risk

**Why:** `liveRequestRef` drops the hop clock. If Metal encode is 600 ms and hop is 400 ms, follow falls behind by design. `finally` only flushes if the leftover buffer is already 2 s.

**Files:**
- `src/app/App.tsx` `transcribeLiveWindow` / `flushLiveWindow`
- Better: `src/core/teleprompter/live-window.ts` owns the queue

**What:**
- At most one Whisper HTTP at a time (server is not concurrent-safe to assume).
- If a hop is due while in-flight, replace a single pending snapshot (latest audio wins; do not queue a backlog).
- Apply results in start-time order. Ignore a result whose `sessionId` is stale.
- Keep `lastHeardEnd` so overlap cannot double-advance.

**Verify:** simulated 700 ms transcribe + 400 ms hops applies every latest window, never two at once, never backward cursor.

---

### 6. Server request hygiene (nst + no-speech + committed prompt) — 50–200 ms + fewer skips / medium if prompt is wrong

**Files:**
- `electron/asr-server.cjs` `request()`, `buildWhisperServerArgs`
- `electron/asr-server.test.cjs`
- `src/vite-env.d.ts` + `preload.cjs` + `App.tsx` if prompt is per-request
- CLI fallback: `electron/asr.cjs` `buildWhisperArgs({ live: true })`

**What:**
- Form fields already send `temperature=0`, `token_timestamps=true`. Add `suppress_nst=true` (or `--suppress-nst` on the process).
- Leave `--no-speech-thold` at default 0.6 until VAD is in; raising it drops quiet booth speech.
- Per request: `prompt` = last 6–10 **already committed expected words** (behind the cursor), not upcoming manuscript. This is context for short hops, not a grammar that hides misreads.
- Do **not** set `--carry-initial-prompt`.
- Flash-attn is already default `true` on this `whisper-server`. Do not add `-fa` noise; do not pass `-nfa`.
- Idle: `DEFAULT_IDLE_TIMEOUT_MS = 30_000` unloads 487 MB mid-sip. While a live session is open, do not idle-stop ( `stop()` already runs on `proof:stop-live` / quit).

**Verify:** server test asserts form keys; matcher tests prove a prompt of past words cannot advance past an unmatched next word.

---

### 7. Spike only: `-ac` / `--audio-ctx` — maybe 200–500 ms encoder / medium–high risk

**Files:** `electron/asr-server.cjs` only after a bench.

**What:** Whisper still encodes `audio_ctx=1500` (~30 s) even for a 2.8 s wav. `-ac 375` (~7.5 s) or `-ac 750` (~15 s) can cut encoder time. Word timestamps and first/last-word accuracy can degrade.

**How to decide:** bench 20× a 2.8 s booth WAV on the bundled `whisper-server` with `-ac 0/375/750`. Ship a reduced ctx only if (a) encode p50 drops ≥ 150 ms and (b) word times on a known sentence stay within 80 ms and no inserted words.

**Do not** put this in the same commit as the hop clock.

---

### 8. Capture path: drop AEC/NS/AGC; optional AudioWorklet — 20–80 ms / low risk in a booth

**Files:** `src/app/App.tsx` `getUserMedia` (~2133); optional `src/app/live-capture-worklet.js`

**What:**
- Follow is listen-only (`gain.gain.value = 0`). `echoCancellation` / `noiseSuppression` / `autoGainControl` add WebRTC delay and can pump room tone into Whisper. Set all three `false` for live follow (leave recorder settings alone).
- `createScriptProcessor(4096)` is ~85 ms and deprecated. AudioWorklet at 128 frames is ~3 ms and more stable. Do this after the hop clock; it is not the feel problem.

---

### 9. IPC: Int16 PCM, not base64 WAV — 5–15 ms / very low risk

**Files:** `src/app/App.tsx` `transcribeLiveWindow`; `electron/live-audio.cjs`; `electron/preload.cjs`; `electron/main.cjs` `transcribeAudioBuffer`; `src/vite-env.d.ts`; `electron/live-audio.test.cjs`

**What:**
- Renderer already has Float32 at 16 kHz after resample. Convert to Int16 once; `ipcRenderer.invoke` with a transferable `ArrayBuffer` (or `number[]` only if transfer is painful through the context bridge — measure).
- Main prepends a 44-byte WAV header for `whisper-server` (it wants a file). Skip `btoa` / base64 validation on the hot path.
- Keep the old base64 WAV decoder as fallback for one release.

This is real but below perceptual threshold. Do not start here.

---

### 10. Speculative next-word paint (display only) — ~200–400 ms “feel” / medium if it looks committed

**Files:** `src/core/teleprompter/live.ts` return `speculativeCursor?`; `src/app/App.tsx`; `src/styles.css`; `src/core/teleprompter/model.ts` / tests

**What:**
- If the unstable tail contains an exact match for `expected[cursor]`, paint `.teleprompter-word-speculative` on that word.
- Never increment `state.cursor`, never set `flag`, never `lastHeardEnd` from speculative words.
- Speculative style must be obviously lighter than `.teleprompter-word-live`.
- On the next hop, either promote (now outside the tail + exact) or clear.

Do this after 1–4 or it will look like the cursor is lying.

---

## Explicit non-changes

| Temptation | Why not |
|---|---|
| Cloud / Parakeet / tiny.en | Out of scope; tiny.en will false-advance more |
| 500 ms Whisper windows | Hallucinations + resync skips |
| Prompt the *upcoming* script | Hides misreads; flags must stay honest |
| Server `--vad` without a model file | Process will fail or no-op |
| Loosen confidence or lookahead | Latency is not a matcher problem |
| Faster `setInterval` walk | Still adds delay; jump instead |
| Measuring success by `liveLatencyMs` alone | It ignores buffer wait + paint |

---

## Suggested implementation slices (when executing)

Each slice is one PR-sized commit with tests first.

1. Extract `live-window.ts` (context/hop/tail math) + tests. Wire constants; behavior still 2.0 / 0.8 until slice 2.
2. Switch capture to 2.8 / 0.4 / 0.32 + tail filter in `matchLiveWindow`.
3. Energy VAD gate.
4. Jump paint + classList + band scroll; delete interval.
5. In-flight/pending queue.
6. Server nst + session-long keep-alive + committed-word prompt.
7. Bench `-ac`; ship only if it passes the bar.
8. Optional: AEC off, worklet, Int16 IPC, speculative CSS.

**Commands:** `npm test` (at least `live.test.ts`, `live-window.test.ts`, `live-vad.test.ts`, `asr-server.test.cjs`, `model.test.ts`) and `npx tsc --noEmit`.

**Booth check (not Vite-in-Chrome):** start voice follow, read 20 seconds, confirm highlight lands on the spoken word within ~1 hop after the word ends, silence does not walk the cursor, Space/PageDown still page, a deliberate misread still only flags at high confidence.

---

## Latency budget after 1–6 (honest)

| Stage | After |
|---|---|
| Time-to-first-highlight | ~2.8 s prime + one encode (unavoidable with small.en context) |
| Steady-state perceived lag | hop 400 ms + encode 200–600 ms + one frame ≈ **0.6–1.0 s** |
| True millisecond-scale (≤150 ms) | **Not available** from whisper.cpp small.en’s 30 s encoder. This plan gets “with the voice” as far as this model can. |

If after 1–6 + a successful `-ac` spike they still want <300 ms steady-state, that is a different engine (out of scope), not more IPC shaving.
