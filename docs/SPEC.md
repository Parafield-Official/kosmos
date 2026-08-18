# Kosmos — Agent Build Spec

> **For the implementing agent:** This is the source of truth. Build this product. Do not invent a store, a player, or an AI narrator. Do not phone home. Ship a free, offline, open-source desktop app that humans use to turn a manuscript + human recordings into ACX-ready files.
>
> **Product name:** Kosmos
> **License:** MIT  
> **Price:** $0. No accounts. No meters.  
> **Platforms:** macOS **and** Windows, both first-class. Linux optional if the same stack builds.  
> **How users get it:** GitHub Releases — one **.dmg** (Mac) and one **.exe** or **.msi** (Windows). Double-click. No terminal, no `pip`, no “clone the repo.”  
> **Repo shape:** one app, one project-folder format, tests next to the audio math.

If this spec and a “nice extra” conflict, follow this spec.

---

## 0. One-sentence job

A person (or two) reads a book into a microphone. Kosmos is the **booth engineer + export clerk**: it keeps the script, catches when the take does not match the page, lists pickups, and writes files Audible/ACX will accept.

It does **not** read the book. It does **not** replace Reaper for working narrators. It does **not** sell audiobooks. It is **not** “another Audacity mastering macro.”

**Duet is in the product.** Two humans, two seats (N1/N2), async bed + overdub. Build it after proof works (Phase 5), but the data model must support seats from day one.

**Author ↔ narrator collaboration is in the product.** Same project folder: author leaves notes and approves chapters; narrator proofs and punches. Not a cloud “invite a stranger” marketplace.

---

## 1. Why this exists (problem you are solving)

Today a first audiobook is five disconnected tools:

1. Word/Google Doc with yellow highlights for names
2. Reaper / Audacity (record + cut)
3. PromptVO (paid cloud teleprompter + live misread) **or** a PDF
4. Pozotron (paid cloud “does this WAV match the book?”) **or** listen twice
5. chapterpass / Auphonic / guesswork to hit ACX numbers

Then ACX rejects the upload (noise floor, true peak, VBR MP3, mixed mono/stereo). A DIY author can spend a month on support. A working narrator gets a 300-item pickup packet three weeks after they closed the book.

People already **pay** for slices:

| Paid slice | Who | What they open it for |
|---|---|---|
| PromptVO $29–$149/mo | Narrators | Script that follows the voice + live/proof |
| Pozotron ~$15/finished hour | Narrators / houses | Audio vs manuscript + pickup list |
| chapterpass ~$18–$36/finished hour | DIY + narrators | Last-mile ACX numbers, local in browser |
| Auphonic credits | Anyone | Generic loudness (not manuscript-aware) |

**We combine those four *jobs* into one local project.** We do **not** clone four companies (no Auphonic podcast suite, no Pozotron cloud OS, no PromptVO billing/mobile/studio SKUs). We add **true duet seats**, which none of them sell.

Hindenburg Narrator already does record + some ACX validate (it is a DAW). It does **not** do manuscript-vs-audio proof or duet. PromptVO does **not** do ACX export. Pozotron’s “Audio Analysis” is a **meter**, not a master. Nobody ships this combo offline as one folder.

Open source + free is the point: unpublished manuscripts never leave the machine; publishers often forbid cloud tools; first-time authors who earned $23 will not pay three subscriptions.

---

## 2. Hard rules (do not violate)

1. **No network required** for prep, proof, teleprompter, ACX check, ACX master, or export. If you add update-check later, it is opt-in and off by default.
2. **No accounts. No telemetry. No analytics. No crash-phone-home.** First-run screen: “This app does not upload your book or your voice.”
3. **No generative voice. No voice clone. No TTS “read the book.”** Whisper (or equivalent) is **ASR only** — speech to text — to compare against the manuscript.
4. **No store, no marketplace, no listener player, no Libby/Spotify/Audible client.**
5. **Do not claim you catch acting, character voices, mouth clicks, or echo.** UI copy must say: text mismatches only; a human still listens.
6. **Do not replace Reaper.** Working narrators record in their DAW. We sit beside it. DIY authors get an optional **dumb recorder** (record / stop / punch one line), not a DAW.
7. **Voice seats exist in v1 data model** even for solo books (`narration` only). Retrofitting seats later is a rewrite.
8. **Live misread flags default OFF.** Cry-wolf kills the product.
9. **ACX numbers live in one versioned file** (`acx_spec.json`). Do not hardcode magic numbers in ten places.
10. **Collaboration is a shared Kosmos project folder**, not a SaaS invite and not Voice123. Author + narrator (and N1 + N2) pass the folder via ZIP / AirDrop / USB / Dropbox / Syncthing. Roles live in `project.json`. No server. No accounts.

---

## 3. Who uses it

| Person | What they open the app for | Screens they live on |
|---|---|---|
| **DIY author-narrator** | “Give me files ACX will take.” | Book home, simple record, pickups, ACX pack |
| **Working narrator** | Script + “what did I miss today” without uploading the book | Teleprompter, pickup list, marker export |
| **Author who hired a narrator** | “Did they say my book? What’s left? Can we upload?” | Book home + pickup list + ACX lights. **Never the teleprompter.** |
| **Duet pair** | She is always her, he is always him, even inside the other POV | Seats, bed, overdub, split pickups |

If a feature only helps a fourth imaginary user (podcaster, YouTuber, studio billing admin), do not build it.

---

## 4. User journeys (build these, in this order)

### Journey A — first vertical slice (must work before anything else)

1. File → New Project (folder on disk).
2. Import one chapter as plain text (or paste).
3. Import one WAV/MP3 of that chapter.
4. Click **Proof**.
5. See a pickup list: timestamp, expected words, heard words, Play.
6. See an **ACX traffic light** for that file (pass/fail per spec, with measured values).
7. No account, no network.

**Done means:** a stranger can do this in 10 minutes with a sample chapter you ship in `/examples`.

### Journey B — DIY memoir (author is the narrator)

1. Import DOCX/EPUB/PDF of the whole book.
2. App splits chapters; author fixes bad splits.
3. Room test: 10 seconds of silence → “your noise floor is X; if you boost to ACX loudness you will fail.”
4. Record chapter 1 in-app **or** drop a WAV from Audacity.
5. Proof → punch the red lines (in-app one-line punch or external DAW).
6. **Export ACX pack** → folder of named MP3s + opening/closing credit slots + retail-sample helper.
7. All lights green or an honest “this chapter will fail because …”

### Journey C — working narrator + Reaper

1. Import publisher manuscript.
2. Open **Teleprompter** (flags off). Script follows voice (or manual scroll if ASR is weak).
3. They record in Reaper (we do not capture unless they want in-app).
4. They drop the chapter WAV (or we watch a folder).
5. Proof → export **Reaper / Audacity / Audition marker file**.
6. They punch in Reaper. Re-import or re-proof. Items check off.
7. Optional: run ACX check/master on the finished chapter.

### Journey D — duet (after A–C work)

1. Project mode `duet`. Assign characters / dialogue to seats `N1` and `N2`.
2. Export or show **N1-only script** and **N2-only script**.
3. N1 records a **bed** (full chapter timing, their lines performed, other lines silent or click-gap).
4. N2 imports the bed, hears it in headphones, records their lines.
5. App aligns both to the script timeline and mixes one chapter (plus optional stems).
6. Pickup list filtered by seat. Author sees both.

### Journey E — author hired a narrator (collaboration)

1. Author creates the project, imports the book, fills glossary + name clips, sets seats if duet.
2. **File → Share project folder** (ZIP the Kosmos project folder, or work in a shared Dropbox/Syncthing folder). Send it to the narrator. Not a cloud account we host.
3. Narrator opens the same folder. Role is `narrator` (or `N1` / `N2`). They see script, glossary clips, empty pickups.
4. Narrator records (Reaper or in-app), runs Proof. Pickups appear.
5. Author opens the updated folder. They play pickups, add notes (“village, not the cousin”), mark `approved` / `needs_pickup` / `ignore`.
6. Narrator sees those notes next open. Fixes, re-proofs. Author marks chapter **Approved**.
7. Either person runs **Export ACX pack**.

No chat app. No live cursors. The folder *is* the collaboration.

---

## 4a. You are not an Audacity macro (read this before building ACX)

A real `r/ACX` reply to chapterpass was:

> “What does your tool do that the audiobook mastering macro in Audacity doesn't?”
>
> Another narrator: this tool also does **top and tail length** and **noise floor**, via a **fast-attack, long-release gate**. They proved it by feeding a file with **−42 dB of white noise**. Useful if you are **baffled by ACX**. Not if you already live in Audacity.

**Implications:**

1. ACX master **must** include head/tail room-tone length, noise-floor gate, **true** peak (not sample peak), CBR not VBR, and a **named file pack**. Loudness-only = the macro already won.
2. **AudioBabble fixture:** clean speech + **−42 dBFS white noise** → after master, floor passes **without** metallic voice. If the *voice* is noisy, **abort** — do not “fix” a bathroom.
3. If we **only** ship this master, that Reddit question has no answer. People should use the free macro. Kosmos exists because the macro **does not know what the book said** and does not do pickups, author notes, or duet.
4. Never market “better than the Audacity macro.” Market: “the macro does not know the manuscript.”

Implement the gate on purpose: **fast attack, long release, non-speech only.** Document it so the next AudioBabble can see it.

---

## 5. Features to build (the product)

Priority: **P0** = first ship. **P1** = same v1, after P0. **P2** = only when P0+P1 work on real books.

### 5.1 Book home — P0

A project is a **folder**. The home screen is a table of chapters.

Columns: `#`, title, duration, proof status (n pickups open), **author status** (`draft` / `needs_pickup` / `approved`), ACX light, audio attached.

Actions: New project, Open project, Import manuscript, Import audio onto a chapter, Proof chapter, Export ACX pack.

Empty state: “Drop a manuscript or paste chapter 1.”

### 5.2 Manuscript import + chapter split — P0/P1

**P0:** paste text or import `.txt` / `.md` as a single chapter.  
**P1:** import `.docx`, `.epub`, `.pdf` (text layer; scanned PDFs can fail — say so).

Split rules (P1):

- Detect `Chapter N`, `CHAPTER`, `Prologue`, `Epilogue`, `Opening credits`, numbered headings.
- Always allow **manual split/merge/rename**.
- Each chapter becomes one ACX file later. Warn if estimated duration > 120 minutes (word count / 9300 × 60).

Preserve **bold, italic, underline, highlight** into the internal script model when the source has them (DOCX). Teleprompter must show them. PromptVO’s whole pitch is “we don’t drop your italics.”

### 5.3 Voice seats + dialogue colors — P0 model, P1 UI

Internal model from day one:

```
seat: "narration" | "N1" | "N2"
```

Solo projects: everything `narration`.

P1 UI:

- Color narration vs quoted dialogue (heuristic: `"` / `“ ”` / `‘ ’`).
- User can paint a span and assign N1/N2.
- Dual-POV helper: “Chapters titled from Character A → default seat N1” (optional, don’t over-smart).
- **Duet mode:** a character keeps their seat even inside the other POV. Document this in the UI: “Duet = she is always her. Dual = each POV narrator fakes the other voice. This app is for duet.”

### 5.4 Glossary / pronunciation bible — P1

This is **not** Pozotron’s “AI researched the name.” We build a **candidate list**; a human records how it sounds.

**How we pull candidates (offline, deterministic):**

1. Tokenize the manuscript.
2. **Skip** a word if it is in a bundled common-English list (`the`, `said`, `Chapter`, months, etc.). Ship a word list in the repo; do not call the internet.
3. **Keep** a word if any of these is true:
   - It is **Capitalized** and **not** only at the start of a sentence (so `Elena` stays, `The` at line start does not).
   - It appears **3+ times** capitalized (`Kael`, `Bistritz`).
   - It is **not** in the English list (`Worcester` is in some lists — also keep if it has unusual letter patterns or the user later adds it).
   - Optional cheap pattern: `said Elena` / `Elena said` → treat `Elena` as a name.
4. Merge case variants (`ELENA` / `Elena` → one entry).
5. Sort by frequency. Cap the auto-list (e.g. top 80) so a novel doesn’t dump 400 false hits.
6. **User is the editor:** add, delete, merge, rename. The auto-list is a draft. Empty glossary is valid.

**Each glossary row:**

| Field | Purpose |
|---|---|
| spelling | `Leominster` |
| respell (optional) | `LEM-ster` |
| clip | 3–10s WAV the author/narrator records in-app |
| seats | optional: this name is usually N1 |

**In the teleprompter:** those words are underlined. Click → play **the clip** if it exists, else show the respell. Never generate the audiobook with TTS. Optional dictionary beep for *common* English only, never for invented names.

**Honesty in the UI:** “We guessed names from capitals. Fix this list. Record a clip for anything a stranger would misread.”

Do **not** send the manuscript to a cloud LLM to “extract characters.” That violates local/no-upload. A later optional *on-device* model is fine only if it works offline and is off by default.

### 5.5 Proof: audio vs manuscript — P0 (core)

This is the Pozotron-shaped job. Local only.

**Input:** chapter text + audio file (WAV preferred; MP3/FLAC/M4A/AIFF accepted).  
**Output:** list of `Pickup` objects + word-level alignment stored in the project.

Each pickup:

| Field | Meaning |
|---|---|
| `id` | stable uuid |
| `chapter_id` | |
| `t_start`, `t_end` | seconds |
| `expected` | manuscript slice |
| `heard` | ASR slice |
| `kind` | `skip` \| `insert` \| `sub` \| `pause` |
| `seat` | narration/N1/N2 |
| `status` | `open` \| `done` \| `ignored` |
| `confidence` | 0–1 |
| `note` | optional human note |

**Play** seeks the chapter audio to `t_start` (500ms pre-roll).  
**Ignore** marks ignored (false positive).  
**Done** when user says they fixed it (or re-proof no longer finds it).

**Pause pickups:** silence longer than N seconds in the middle of a sentence/paragraph (default 4s, user setting). Do not flag normal breaths (~0.3–1s).

**Copy:** “We catch words that don’t match the page. We do not catch acting, accents, or mouth noise.”

### 5.6 Pickup list + DAW markers — P0/P1

**P0:** in-app list (Play / Ignore / Done / add human note).  
**P1:** export markers:

- Reaper: `.csv` or tab file Reaper can import as markers (`#`, `Name`, `Start`)
- Audacity: label track `.txt` (`start` `end` `label`)
- Adobe Audition: CSV if documented; otherwise Audacity format + README

Marker name = `expected → heard` truncated.

Author view: same list in plain language. Filter: open only / by seat.

### 5.7 Teleprompter — P1

Full-page reading view.

- Manuscript as written; italics/bold/highlight kept; font size slider; dark/sepia/cream themes (booth lighting).
- **Manual scroll** always works (space / mouse / foot-pedal key).
- **Voice follow (optional):** ASR in near-real-time highlights the current word and scrolls. If ASR lags, fall back to manual without fighting the user.
- **Live misread light: default OFF.** When ON: only high-precision mismatches. Dismiss remembers that line. **3 false alarms in one chapter → auto-dim** (“flags paused — too many false alarms”) with an undo.
- Two thresholds in code: `proof.recall` (batch) vs `live.precision` (prompter). Never one slider for both.
- Mic: use default input. Do **not** hog the device if the user is recording in Reaper — document “set Kosmos to listen-only / same input.” Prefer loopback-free: we listen to the mic for follow; Reaper also records the mic. On macOS this is allowed (two apps, one input).
- We are the **script window**, not a second DAW.

### 5.8 Simple in-app recorder (DIY only) — P1

Not Reaper.

- Record / pause / stop → WAV 44.1 kHz, 16- or 24-bit, mono, into the chapter folder.
- Level meter while recording. Peak warning if near 0 dBFS.
- **One-line punch:** from a pickup, record a replacement clip; user confirms; we splice into a copy of the chapter WAV (keep `chapter.wav` original + `chapter.edited.wav`).
- No EQ, no compressor UI, no multitrack mixer.

### 5.9 Room test — P1

10–20 seconds of intended silence in the booth.

Report:

- Noise floor dBFS RMS
- Gain budget: “ACX wants RMS about −20. You will need ~X dB of boost. After boost, predicted floor = Y. Pass needs ≤ −60.”
- If predicted fail: **hard warning before they record a book.** “Treat the room or you will fail ACX. No plugin will save a bathroom.”

### 5.10 ACX check (meter) — P0

Measure the file. Do **not** only copy Audacity ACX Check (sample peak, misses true peak). Do **not** copy ACX Audio Lab (it skips noise floor).

Implement **true peak** (oversampled), **RMS**, **noise floor**, format, rate, channels, duration, head/tail room tone.

Show a table: spec | required | measured | pass/fail.

Yellow = on the edge (within 0.5 dB of a limit).

### 5.11 ACX master + named export pack — P1

One-click (with a preview of what will change).

**Processing order (mandatory):**

1. Decode to PCM. Resample to **44.1 kHz**. Mix to **mono** (default; stereo only if user forces it — then **all** files in the pack must be stereo).
2. **Noise:** speech-aware gate on non-speech only. Do not butcher consonants. If floor still fails, **stop and tell the user**; do not melt the voice with brutal NR.
3. Compress lightly + normalize so integrated RMS ≈ **−20 dBFS** (middle of −23…−18).
4. **True-peak limiter**, ceiling **−3.2 dBFS** (margin under −3).
5. Head/tail: **1.5–2.0 s of room tone**, not digital zero, never > 5 s. Capture room tone from the file’s quietest speech-free region; if none, use the room-test clip; if none, generate very low-level noise shaped like the floor (−70 or actual floor), **not** `-inf`.
6. Encode **MP3 CBR 192 kbps** (or 256), 44.1 kHz, mono. **Never VBR.**
7. Encode **once**. Do not transcode MP3→MP3.

**Export folder layout:**

```
export/acx/
  00_opening_credits.mp3      # if user provided audio; else a README “record this”
  01_chapter_01.mp3
  02_chapter_02.mp3
  …
  98_closing_credits.mp3
  99_retail_sample.mp3        # 1–5 min, starts on narration, no credits
  REPORT.txt                  # per-file measurements
```

Credits: we do **not** generate spoken credits with TTS. We provide a **script template** (“{Title}, written by {Author}, narrated by {Narrator}”) and empty slots.

Retail sample: user picks a range, or we take 3:00 from chapter 1 after the chapter header.

**Honesty:** green lights mean **measurable specs**. Human QC (clicks, echo, manuscript) can still fail.

**Friend quote (must satisfy this person):**

> Using Audition, I find it a HUGE pain in the ass to make sure each chapter has the proper RMS (between −23 and −18) and true peak dB limit of −3. Is there any way for your product to automate that?
>
> Well, if you're able to implement those two parameters, then the third one would probably be easy: making sure the noise floor is −60 or lower.

**Yes — all three numbers, every chapter, one batch.** That is the ACX master. They should not ride Audition’s loudness, limiter, *or* noise floor by hand on 18 chapters.

| Spec | Target | How we hit it |
|---|---|---|
| RMS | −23 to −18 (we aim **−20**) | compress + normalize |
| True peak | ≤ −3 (limiter ceiling **−3.2**) | oversampled true-peak limiter, **not** Audition/Audacity sample peak |
| Noise floor | ≤ **−60** | fast-attack, long-release **gate on non-speech only** (AudioBabble / chapterpass method) |

**Noise floor is not the easy one.** Raising RMS to −20 *also raises the hiss*. If the raw floor is −65 and they need +10 dB of gain, they are already dead. Order is mandatory: **gate first, then loudness, then limiter.** If a chapter cannot hit RMS *and* −60, **stop on that file**, show the gain-budget math, do not melt the voice. Room test exists so they learn this *before* they record the book.

- **Batch:** one click → every attached chapter gets all three.
- **Report:** before/after RMS, TP, floor, pass/fail per chapter.
- **Audition users:** still *edit* there. Drop finished WAVs here instead of Match Loudness + Limiter + noise pass × 18.
- **AudioBabble fixture:** clean speech + −42 dBFS white noise → after master, floor ≤ −60, voice not metallic.

If this friend still opens Audition to check RMS, true peak, *or* floor after Export ACX pack, the master is not done.

### 5.12 Duet async bed + overdub — P2 (YES this is in the product)

**Duet is a required feature**, not a maybe. Build order: after proof + ACX work (Phase 5). Seats must exist in the data model from Phase 0.

This is true **duet**, not dual:

- **Duet:** FMC is always N1’s voice, MMC is always N2’s voice, including inside the other person’s chapter.
- **Dual:** each POV chapter is one narrator who also fakes the other gender. We do not optimize for dual.

What to build:

- Project `mode: solo | duet`.
- Per-span seat assignment (5.3).
- **Share:** “Export seat pack” = zip of project subset (script for that seat, bed WAV if any). Other person opens the zip. Same mechanism as author↔narrator collab. No cloud invite.
- N1 records bed. Gaps where N2 speaks: leave room tone + optional slate beep at N2 line starts (user toggle).
- N2 plays bed in phones, records N2 track.
- Mix: timeline from script alignment; N1 audio in N1 spans, N2 in N2 spans, crossfade 10–30 ms; narration spans assigned to a chosen seat (usually N1).
- Export one chapter mix + `stems/N1.wav`, `stems/N2.wav`.
- Pickup list filtered by seat. Author sees both.

**Do not build:** live low-latency remote studio, Graphic Audio SFX/music, narrator marketplace.

### 5.13 Author ↔ narrator collaboration — P1 (YES this is in the product)

Not a social network. Not ACX. Not “find me a narrator.”

Two (or three) people work in **one Kosmos project folder**.

**Roles** in `project.json`:

```json
"people": [
  { "name": "Alex Author", "role": "author" },
  { "name": "Nia Voice", "role": "narrator", "seat": "N1" },
  { "name": "Jon Voice", "role": "narrator", "seat": "N2" }
]
```

On first open of a project, pick **I am the author** / **I am the narrator** (remembered in a local, not-synced `me.json` next to the app, not inside the shared folder if you want — or a `local.me` that is gitignored). The shared folder stores the *work*; each machine stores *who I am*.

**Author can:**

- Import manuscript, glossary, name clips, seat colors
- See every chapter: recorded? pickups open? ACX light?
- Play any pickup
- Add a note on a pickup or a chapter (`"that's Leominster, Lem-ster"`)
- Set chapter to `needs_pickup` | `approved` | `ignore_this_flag`
- Export ACX pack when they are happy
- **File → Zip project for collaborator** (exclude huge unused raws if user checks “light pack”)

**Narrator can:**

- Open that folder, read script + glossary clips
- Teleprompter, proof, punch, marker export
- See author notes highlighted
- Cannot “approve” the book (author does that) unless they are also the author (DIY)

**Conflict rule (Dropbox):** last-write-wins on `alignment/01.json` is OK for v1. Show file mtime on the chapter row (“pickups updated 2 hours ago”). Do not build OT/CRDT.

**Do not build:** in-app chat, accounts, “invite by email,” live presence, a narrator marketplace, comments like Google Docs on every word.

### 5.14 Settings that matter

- Proof sensitivity (conservative / default / aggressive)
- Live flags on/off + auto-dim
- Pause threshold
- ACX target RMS (default −20)
- Default export mono/stereo
- Theme, font size
- **Never:** login, API keys for cloud LLM, “improve with cloud”

---

## 6. What you must not build

- Audible / Spotify / Libby clone  
- ElevenLabs / Virtual Voice / “generate the audiobook”  
- In-audio consumer captions (publishers sued Audible over this)  
- “We replace a human listen”  
- Cloud manuscript upload  
- Auphonic-style multi-platform LUFS / music / podcast presets  
- Pozotron Studio (hosted pickup recorder, house billing, pronunciation-AI they themselves get wrong)  
- PromptVO hour-meter, mobile app, studio SKUs  
- Marketplace to hire narrators  
- Royalty calculators as v1 (nice later, not the product)

---

## 7. On-disk project format

A project **is** a folder. This is the collaboration mechanism.

```
MyBook/
  project.json
  acx_spec.json          # copy of spec version used (pin on export)
  manuscript/
    book.docx            # original, if any
    chapters/
      01.md              # or .json spans
  audio/
    01_raw.wav
    01_edited.wav
    room_test.wav
    glossary/
      worcester.wav
  alignment/
    01.json              # word times + pickups
  export/                # last ACX pack (optional)
```

`project.json` sketch:

```json
{
  "schema": 1,
  "name": "My Book",
  "mode": "solo",
  "author": "",
  "narrator_n1": "",
  "narrator_n2": "",
  "seats": {
    "N1": { "label": "FMC", "color": "#c45c26" },
    "N2": { "label": "MMC", "color": "#2c4c7c" },
    "narration": { "label": "Narration", "color": "#888888" }
  },
  "chapters": [
    {
      "id": "ch01",
      "index": 1,
      "title": "Chapter 1",
      "text_path": "manuscript/chapters/01.json",
      "audio_path": "audio/01_edited.wav",
      "pickups_path": "alignment/01.json"
    }
  ]
}
```

Chapter text is a list of **spans**: `{ "text", "seat", "style": ["italic"], "glossary_id"? }`.

Never put secrets in the folder. The folder must be zip-safe and dropbox-safe.

---

## 8. Architecture (how to build it)

### 8.1 Stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** + system WebView | Small, native, offline, Mac/Win |
| UI | TypeScript + React (or Svelte) | Fast to ship screens |
| Audio math | **Rust** in the Tauri backend, or a small **Python sidecar** if you must — prefer Rust | RMS / true peak / gate / splice must be tested |
| ASR | Bundled **whisper.cpp** + official OpenAI Whisper ggml (`small.en` default, `medium.en` optional). Word timestamps on. | MIT, CPU/Metal, Mac+Win, no Python. See **§8.1a**. |
| Align (optional refine) | After ASR+diff, optionally **Montreal Forced Aligner 3.x** on *matching* spans only | Research-best timestamps when the text is trusted. Do **not** MFA-align a skipped chapter. |
| Encode | Bundled **ffmpeg** (LGPL build) or `lame` + `libsamplerate` | CBR MP3 |
| Import | `docx` crate / mammoth; epub zip+html; pdf text via `pdf-extract` or `pdftotext` if present | Fail loudly on scanned PDFs |

If Tauri is too painful in the first week, Electron is acceptable **only if** you still ship offline and do not add auto-update telemetry. Prefer Tauri.

**Models:** bundle the official **OpenAI Whisper ggml** in the installer (`ggml-small.en.bin` default) after checksum verification during release packaging. Proof must work offline immediately after installation. The application-data model cache remains available only as a repair/update fallback.

### 8.1a Local Whisper + align — researched pick (2026)

Two different “best” boards. Do not confuse them.

| Job | What actually leads | Ship in Kosmos v1? |
|---|---|---|
| **What did they say?** (WER) | Open ASR leaderboard: NVIDIA Canary-Qwen-2.5B, IBM Granite, later 2B models. Whisper Large v3 is not #1. | **No** as default. GPU/Python, not a 16 GB laptop `.dmg`. |
| **When did they say it?** (boundary ms) | **MFA 3.0** (Jun 2026 paper): mean error **< 15 ms**; beats WhisperX, MMS, NeMo, BFA, MAPS. 2024 Interspeech: MFA already beat WhisperX/MMS on TIMIT + Buckeye. | Optional refine **after** proof, on **matching** spans only. |
| **Newest Whisper + crisp times** | **CrisperWhisper 2.0**: ~**30 ms** TIMIT vs WhisperX ~65 ms; best verbatim F1 on their own bench. | **No.** Code MIT; **weights + outputs non-commercial.** Cannot ship in a free app people use to make paid books. |
| **Newest faster WhisperX** | **easytranscriber** (KBLab, Feb 2026): 35–102% faster than WhisperX (GPU CTC). Speed, not better pickups. | No. Python + GPU. |
| **Laptop MIT engine** | **whisper.cpp** (C++, Metal/CPU, official Whisper ggml, word timestamps). `small.en` ~466 MB / ~0.9 GB RAM. | **Yes. Default.** |

**v1 pipeline (do not invert):**

1. **whisper.cpp** transcribes the take → heard words + rough times.
2. Diff heard vs manuscript → pickups (`skip` / `insert` / `sub`).
3. Play uses those times. Good enough if Play lands on the right sentence.
4. **Later:** MFA (or wav2vec2 CTC) to tighten times on matching regions only. Never force-align the full manuscript when they skipped a page — MFA *assumes the text is what was spoken* and will smear.

**Forbidden defaults:** CrisperWhisper weights, Canary-Qwen, any NC / research-only checkpoint, any cloud API.

**Accept:** `proof_on_vs_in` still finds the sub. A 70-minute chapter on a 16 GB Mac finishes in one sitting (target: faster than realtime on Apple Silicon `small.en`).

### 8.2 Modules (keep these boundaries)

```
crates/ or src-tauri/
  acx/          # measure + master  — unit tests with fixture WAVs
  proof/        # align transcript to manuscript
  audio_io/     # decode, splice, room tone
  project/      # folder format
app/
  routes: home, chapter, prompter, pickups, acx, glossary, settings
```

UI must not contain ACX math. Proof must not contain MP3 encoding.

### 8.3 ACX spec file (`acx_spec.json`)

```json
{
  "version": "2026-acx",
  "rms_dbfs": { "min": -23, "max": -18, "target": -20 },
  "true_peak_dbfs_max": -3.0,
  "true_peak_limiter_ceiling": -3.2,
  "noise_floor_dbfs_max": -60,
  "sample_rate": 44100,
  "min_bitrate_cbr": 192,
  "vbr_allowed": false,
  "channels": "all_mono_or_all_stereo",
  "max_file_seconds": 7200,
  "room_tone_head_s": { "min": 0.5, "max": 5.0, "target": 1.5 },
  "room_tone_tail_s": { "min": 0.5, "max": 5.0, "target": 1.5 },
  "retail_sample_s": { "min": 60, "max": 300 }
}
```

Source of truth for humans: ACX help “audio submission requirements.” If ACX changes, you change this file + tests.

---

## 9. Algorithms (implement exactly this intent)

### 9.1 Proof / alignment

1. Decode audio to 16 kHz mono PCM for ASR only (keep original for playback).
2. Run whisper.cpp with **word timestamps** (`word_timestamps=true`). Language: user setting, default English.
3. Normalize manuscript and transcript for matching:
   - Unicode fold, lowercase
   - Keep apostrophes in contractions
   - Strip other punctuation for match, keep original text for display
   - Collapse whitespace
   - Optional: expand `Mr.`/`Mrs.` consistently
4. Align token sequences (diff / Myers / Needleman–Wunsch). Map transcript tokens → times.
5. Emit pickups:
   - `skip`: manuscript tokens with no transcript (use surrounding times)
   - `insert`: transcript tokens with no manuscript
   - `sub`: substitution (on/in, toward/towards — setting to ignore trivial variants)
6. Filter:
   - Drop punctuation-only
   - Drop mismatches shorter than 1 character unless they are a full word
   - Merge adjacent pickups within 0.4s into one
7. Confidence: low if ASR probability is low — still **show** in batch proof (recall), hide from live flags (precision).

**Do not** use a cloud LLM to “judge” the take.

Ship `/examples/proof/on_vs_in.wav` + manuscript where the reader says “in” instead of “on”. Test must find that pickup.

### 9.2 Live follow / live flags

- Rolling 2–4s ASR windows.
- Advance highlight only forward (don’t jump back 3 paragraphs on a glitch).
- Live flag only if: flags enabled AND confidence > live threshold AND mismatch ≥ 1 full content word AND not previously dismissed.
- 3 auto-dismiss or user-dismiss false alarms / chapter → disable flags for the session.

If live follow is janky, **ship manual scroll** and call follow “experimental.” A broken scroller is worse than a PDF.

### 9.3 RMS

RMS over the **whole file** after decode (ACX talks about file RMS). Also compute speech-only RMS for debugging, but **pass/fail uses file RMS** unless you document otherwise.

`rms_dbfs = 20 * log10(sqrt(mean(x^2)))` with full-scale 1.0.

### 9.4 True peak

Do **not** use max(abs(samples)).

- Oversample 4× (polyphase / libsamplerate quality).
- True peak = max abs of oversampled signal, in dBFS.
- Fail if `> -3.0`.

Fixture: a sample-peak of −3.2 dBFS that still has inter-sample peaks over −3. Your meter must fail it; Audacity-style sample peak would pass. Add this fixture.

### 9.5 Noise floor

- Find regions that are not speech (energy gate + min 200ms).
- RMS of those regions.
- If the file is wall-to-wall speech, use the quietest 0.5s.
- Digital-zero files: floor is −inf; **warn** “this is digital silence, ACX wants room tone.”

### 9.6 Head / tail room tone

Measure leading/trailing run of non-speech. Fail if 0s (starts on a word with a click) or > 5s. Fail if the pad is exact zeros.

### 9.7 Master gain budget (room test)

```
needed_boost = target_rms - current_speech_rms
predicted_floor = measured_floor + needed_boost
fail_if predicted_floor > -60
```

Show the arithmetic on screen.

### 9.8 One-line punch splice

- User records clip.
- Optional: trim to first/last speech ± 50ms.
- Replace `[t_start, t_end)` in the edited WAV with the clip, crossfade 10ms.
- Never overwrite `*_raw.wav`.

---

## 10. UI copy (use this tone)

- First run: “Kosmos runs on this computer. It does not upload your book or your voice. It does not read the book for you.”
- Proof header: “Word mismatches only. Listen once for acting and noise.”
- ACX green: “Measurable specs pass. ACX can still reject clicks, echo, or a wrong read.”
- Room fail: “Do not record a whole book tonight.”
- Live flags off: “Flags are off so they don’t cry wolf. Turn on when you trust the script.”

Do **not** use the words “AI narrator,” “generate audiobook,” or “unlimited listening.”

---

## 10a. Easy download — Mac and Windows (hard requirement)

Narrators will not `pip install`. The last free proofing suite died on that. **v1 is not shipped until a non-technical person can install on both Mac and Windows without Terminal.**

**What to put on GitHub Releases (every tagged version):**

| File | Who |
|---|---|
| `Kosmos-x.y.z-mac-universal.dmg` or separate `...-arm64.dmg` + `...-x64.dmg` | Mac (Apple Silicon + Intel) |
| `Kosmos-x.y.z-win-x64.exe` (NSIS) or `.msi` | Windows 10/11 64-bit |
| checksums (`SHA256SUMS`) | Anyone who wants to verify |

**Install UX:**

- **Mac:** open `.dmg` → drag Kosmos to Applications → launch. If Gatekeeper blocks: document “right-click → Open” (unsigned OSS). Code-sign + notarize if you have an Apple developer account; do not block ship on that.
- **Windows:** run `.exe` → Next Next Finish. If SmartScreen: document “More info → Run anyway.” Sign if you have a cert; do not block ship.
- First launch: privacy sentence. The installer already contains Whisper and the verified model, so the first **Proof** works offline with no setup on both OSes.

**CI:** GitHub Actions builds both artifacts on tag. README top has two buttons: **Download for Mac** · **Download for Windows**.

**Not acceptable as the only install path:** `git clone`, `npm i`, `pip install`, “install Rust first,” Docker.

**Accept:** a friend with no dev tools can install from the Release page on a Mac *and* on a Windows PC and complete Journey A.

---

## 11. Build order (the agent’s backlog)

Do these in order. Do not start duet or a pretty marketing site first.

### Phase 0 — skeleton

- Tauri app opens.
- New/Open project folder; write `project.json`.
- MIT LICENSE, README (install, “works offline”, how to run examples).
- First-run privacy sentence.

**Accept:** quit and reopen, project still opens.

### Phase 1 — P0 vertical slice (this is the product)

- Paste/import one chapter text.
- Attach a WAV.
- Bundled whisper.cpp transcribes locally (progress UI).
- Pickup list + Play.
- ACX **measure** (not master yet): RMS, true peak, noise floor, rate, channels, duration, head/tail.
- Traffic light + numbers.
- `/examples` sample chapter that contains a known misread.

**Accept:** Journey A in 10 minutes, offline, no account. Tests in `acx/` and `proof/` pass.

### Phase 2 — ACX master + export pack

- Master chain in the specified order.
- Named MP3 export + REPORT.txt.
- Credit slots + sample helper.
- Room test screen.

**Accept:** a clean spoken WAV exports an MP3 your meter marks all-green. **AudioBabble test:** same take + −42 dBFS white noise → floor passes, voice not metallic. A bathroom-noisy fixture refuses to destroy the voice and explains why.

### Phase 3 — manuscript + book home

- Multi-chapter import (DOCX/EPUB/TXT).
- Split/merge/rename.
- Book home table.
- Glossary + optional clips.
- Seat field on spans (UI paint).
- Roles: I am author / I am narrator. Chapter `approved` / `needs_pickup`. Notes on pickups.
- **File → Zip project for collaborator.**

### Phase 4 — narrator booth

- Teleprompter with styles + font size + manual scroll.
- Optional voice-follow.
- Live flags off by default + auto-dim.
- Marker export (Audacity + Reaper).
- Simple in-app recorder + one-line punch.

### Phase 5 — duet (required feature, last)

- Mode switch, seat filters, seat-pack zip, bed + overdub mix, split pickups.

**Stop after Phase 1 if time is short.** A working proof+meter is already useful. A half-duet and no proof is not. Collaboration (notes + zip) can ship in Phase 3 without a server.

---

## 12. Tests the agent must write

Place fixtures under `/testdata` (short WAVs, a few seconds).

| Test | Expect |
|---|---|
| `proof_on_vs_in` | Finds `on`→`in` sub near the right time |
| `proof_skipped_sentence` | One skip pickup covering the missing sentence |
| `acx_true_peak_oversample` | Sample peak pass, true peak fail on the inter-sample fixture |
| `acx_vbr_rejected` | VBR MP3 fails format |
| `acx_48k_flagged` | 48 kHz fails rate until resampled |
| `acx_digital_silence_tail` | Zero tail fails room-tone rule |
| `master_order_noise_before_gain` | After master, floor still ≤ −60 **or** master aborts with message |
| `project_roundtrip` | Save, quit, open, same pickups |
| `master_audiobabble_neg42_noise` | Clean speech + −42 dBFS white noise: after master, floor ≤ −60 and no obvious voice-destroy (keep a before/after RMS-of-speech sanity bound) |
| `collab_roles_roundtrip` | Author note + chapter approved survives zip → open as narrator |
| `offline` | With network blocked (or stub), proof runs from the installer-bundled model |

Do not commit huge model files; document the checksum and fetch them during release packaging so the installer still contains them.

---

## 13. README the agent must write (user-facing)

- What it is / what it is not  
- **Top of README:** Download for Mac · Download for Windows (links to latest GitHub Release)  
- Install: double-click `.dmg` / `.exe`. No Terminal.  
- Gatekeeper / SmartScreen one-liner if unsigned  
- “Your book stays on this computer”  
- Journey A walkthrough  
- How to use next to Reaper  
- ACX: we check measurable specs; human QC is still yours  
- License MIT  
- How to build from source (for contributors only — not the user path)  

Ship a **binary**. A Python-only README is how the last free proofing suite failed to get used.

---

## 14. Competitive cheat-sheet (so you don’t wander)

| Job users pay for | We implement | We skip |
|---|---|---|
| PromptVO window | Teleprompter + optional live flag | Their billing, mobile, cloud |
| Pozotron mismatch list | Local proof + markers + pickups | Cloud, hosted recorder, studio OS |
| chapterpass ACX button | Measure + master + named pack | Their marketing site |
| Auphonic loudness | Only ACX-shaped master | Podcast/music/LUFS suite |
| Nobody | Duet seats + async bed | Live remote studio |
| Nobody as a local folder | Author notes + approve + zip share | Cloud accounts, chat, marketplace |

We sit **next to Reaper**. We do not become Reaper. DIY authors can record a chapter in-app so they never open a DAW.

---

## 15. Definition of done (v1)

A person can:

1. Install without a terminal.
2. Import a book or a chapter, attach audio, get pickups, play them.
3. See honest ACX lights (true peak + noise floor + RMS).
4. Export a named ACX folder that our meter says is green (on a clean recording).
5. Do all of that **offline immediately after installation** with the bundled model.
6. Read in the README that we do not upload, do not clone, do not narrate.

Teleprompter, glossary, duet, and in-app punch make it a **complete booth**. They are worthless if Phase 1 is flaky.

---

## 16. Glossary for the agent

- **PFH** — per finished hour (retail length of the book, not hours in the booth).  
- **Pickup** — a re-record of a bad line.  
- **ACX** — Amazon’s Audiobook Creation Exchange; the door to Audible.  
- **Duet** — same two voices for those characters in every chapter.  
- **Dual** — each POV chapter is one narrator, who also fakes the other gender.  
- **Room tone** — the sound of the booth when nobody speaks. Not digital zero.  
- **True peak** — inter-sample peak after reconstruction, not max PCM sample.  
- **Bed** — one seat’s recording with holes/timing for the other seat.

---

## 17. First commit the agent should make

1. Repo + MIT + this spec copied to `/docs/SPEC.md`.  
2. Empty Tauri app titled “Kosmos”.
3. `testdata` + failing tests for `proof_on_vs_in` and `acx_true_peak_oversample`.  
4. Then make those two tests pass.  
5. Then Journey A UI.

Do not start by designing a landing page or a logo animation.
