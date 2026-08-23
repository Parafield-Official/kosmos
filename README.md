# Kosmos

[Download for Mac](https://github.com/Manishram-ai/kosmos/releases/download/v0.1.1/Kosmos-0.1.1-mac-arm64.dmg) · [Download for Windows](https://github.com/Manishram-ai/kosmos/releases/download/v0.1.1/Kosmos-0.1.1-win-x64.exe)

Kosmos is a free, offline desktop app for turning a manuscript and human
recordings into proofed, delivery-ready audiobook files. Your book and your voice
stay on this computer. There are no accounts, meters, analytics, or
cloud-uploaded manuscripts.

Kosmos does not read the book, generate a voice, replace a DAW, or promise
to catch acting, accents, clicks, or echo. Proof catches text mismatches; a
human still listens.

## Current build

This repository is being built in the phases described in [`docs/SPEC.md`](docs/SPEC.md).
The current build carries the consecutive Phase 0–5 slices: a local project
folder and Journey A proof flow; ACX measurement, mastering, and named export;
TXT/Markdown, DOCX (bold/italic/underline/highlight spans), EPUB, and text-layer
PDF import with split/merge/rename; deterministic glossary candidates with
human pronunciation clips; author/narrator roles, chapter notes, pickup status
and notes, and a live pasteable invite on People (no zip pack); a styled manual teleprompter,
DAW marker export, listen-safe DIY recording review, one-line punch splicing,
and room testing; plus duet seat painting, N1/N2 pickup filters, seat packs,
bed/overdub mixing, and separate stems. The master applies conservative
steady-noise cleanup when needed, then runs loudness → true-peak limiting →
room-tone padding and refuses a take whose noise cannot be fixed without
damaging the voice. The shipped proof fixture can be loaded
without a network connection. Project settings expose batch proof sensitivity,
the long-pause threshold, ACX target RMS, and teleprompter display defaults;
the versioned ACX pass limits themselves remain pinned in `acx_spec.json`.

The teleprompter can follow narration locally with word-level highlighting.
Kosmos warms a persistent whisper.cpp recognizer when voice follow starts,
shows its check count and latency, and stops the recognizer when narration
stops. Full-chapter Proof keeps the higher-quality one-shot decoder; the live
path is a listen-only guide and never saves microphone audio.

Rich manuscript imports use Microsoft's offline [MarkItDown](https://github.com/microsoft/markitdown)
helper in release installers, with the built-in Kosmos parser as a safe
fallback. Source builds can point to a local helper with `MARKITDOWN_PATH`;
plain-text and Markdown chapter parsing remain local and deterministic.

This is a pre-release development build. Release packaging stages the audited
FFmpeg/ffprobe and whisper.cpp runtimes plus the checksum-verified `small.en`
model inside the application. Source builds may still override those tools for
development.

## Install (release builds)

1. Download the Mac `.dmg` or Windows `.exe` from the latest GitHub Release.
2. macOS: open the disk image and drag Kosmos to Applications. If
   Gatekeeper blocks an unsigned build, right-click the app and choose Open.
3. Windows: run the installer. If SmartScreen appears for an unsigned build,
   choose More info → Run anyway.
4. If you still have the first public installer, download the current Mac or
   Windows file once and replace that app. Later versions then arrive in
   Kosmos; restart when you are not recording. Your book folder is unchanged.

Whisper CLI, the persistent Whisper server, and the checksum-verified
`small.en` model are already included in the installer. Proof and listen-only
voice follow work offline immediately after installation: there is no
model download, account, Python setup, or cloud fallback.

## Journey A (first vertical slice)

The target first-use flow is:

1. File → New Project and choose a folder.
2. Paste or import one chapter of plain text.
3. Attach that chapter's WAV or MP3 (or choose **Try the proof fixture**).
4. Click Proof. Kosmos uses local Whisper when installed; for a fixture or
   development build you may paste a local transcript instead.
5. Review timestamped word mismatches and check the ACX traffic light with RMS, true peak, noise floor, rate,
   channels, duration, and room-tone values.

## ACX mastering and automatic noise cleanup

Export is one click for work Kosmos can perform safely. It checks the selected
delivery target, reconstructs detected clicks and clipped peaks, applies
conservative steady-noise reduction when needed, normalizes level, limits
peaks, resamples and mixes channels, adds compliant room tone, encodes the
delivery file, then measures the encoded file again. The app shows one
checklist of what was changed and what the delivered file actually passed.

The graphs below come from the deterministic noisy-narration fixture used by
`verify:delivery`. Time runs left to right, frequency runs bottom to top, and
brighter colors mean more audio energy. In the first graph, the blue haze
across the full height is broadband room noise:

![Noisy narration before automatic cleanup](docs/images/acx-denoise/acx-noise-before.png)

After automatic cleanup, that haze is darker while the bright speech shapes
remain in the same places:

![The same narration after automatic cleanup](docs/images/acx-denoise/acx-noise-after.png)

FFmpeg independently measures the quiet window moving from −58.8 to
−68.8 dBFS while the narration remains −31.4 dBFS before and after. That gives
the delivered file more room under ACX's −60 dBFS noise-floor limit without
turning down or sanding away the voice. Cleanup is capped at 12 dB; if a take
needs more than that, Kosmos refuses to ship it instead of applying destructive
processing.

Kosmos uses the same scan → diagnose → repair candidate → preservation check →
commit-or-pickup pattern across automatic restoration. Click and clipping repair
now runs before noise reduction and mastering; plosive, dereverb, changing-room,
and best-take selection workflows are specified in
[`docs/AUTOMATIC_AUDIO_REPAIR.md`](docs/AUTOMATIC_AUDIO_REPAIR.md). A person
still confirms the listening experience, but the app prepares the exact pickup
only when a bounded repair cannot preserve the human voice.

## Working next to Reaper

Record and edit in Reaper (or another DAW), then attach the finished WAV to a
chapter. Kosmos is the script, proof, pickup, and ACX desk beside your DAW;
it is not a replacement multitrack editor. The optional in-app recorder is for
DIY authors who need a simple record/stop/punch workflow.

## Offline by design

Prep, proof, teleprompter, ACX checking, mastering, and export are local. The
app has no sign-in, telemetry, crash phone-home, cloud LLM, voice clone, or
remote narrator marketplace. Shared work happens by passing the Kosmos project
folder (or a ZIP) between people.

## Build from source (contributors)

Requirements: Node.js 20+ and npm. Release packaging also needs the platform
toolchain used by Electron Builder.

```sh
npm install
npm test
npm run typecheck
npm run dev
```

### Verifying against other tools

`npm test` checks our code against our own expectations, which cannot catch a
mistake we made twice. `npm run verify` checks the parts that make a claim about
the outside world against tools that were not written here, on real audio:

| Command | What it proves, and who says so |
|---|---|
| `verify:acx` | The mastered MP3 meets ACX's numbers, measured by ffmpeg's `astats` and `volumedetect` rather than by us — and an unfixable take is refused instead of shipped. |
| `verify:delivery` | FFmpeg's adaptive cleanup lowers steady noise without changing narration level, the cleanup cap is enforced, and an EBU R128 delivery is really 48 kHz mono 24-bit PCM WAV. |
| `verify:restoration` | FFmpeg reconstructs planted clicks and clipped peaks, while a clean narration control stays sample- and level-neutral. |
| `verify:loudness` | Our LUFS meter agrees with ffmpeg's `ebur128` on sines, noise and gated speech at both sample rates. |
| `verify:markers` | Every marker export parses as the editor that imports it expects, read back with Python's `csv` module. |
| `verify:packet` | The pickup packet's clips are playable MP3s (`ffprobe`), its spreadsheet opens in `openpyxl`, and its page is well-formed HTML. |
| `verify:collab` | A pack written by the app's own ZIP writer opens in Python's `zipfile` and imports back with the right merge, checked against the bytes on disk. |
| `verify:proof` | The proof pass scores precision and recall against takes spoken by the macOS voices and decoded by the bundled whisper build. |
| `verify:book` | The occurrence scan, the whole-book pickup list and the word filter hold up on those real recordings, and the bundled dictionary's respellings are the ones a narrator wants. |

`verify:proof` and `verify:book` need the speech model (`npm run prepare:model`)
and macOS `say`; the rest run anywhere the vendored ffmpeg does. `verify:packet`
also needs Python with `openpyxl`.

### Looking at the panels

Reviewing an interface by reading JSX is guesswork. The design workbench renders
the working panels with realistic content — a book mid-proof, a name read two
ways, a pack that disagrees with yours — so a layout can be looked at:

```bash
npm run design                       # serves design/preview.html
npm run design:shots                 # writes design/shots/*.png
npm run design:shots -- --width 760  # the narrow column, for wrapping
```

Open `http://127.0.0.1:5173/design/preview.html` for every panel, add
`?panel=pickups` for one, and `&open` to photograph menus open. The page is dev
only and is not part of the production entry, so nothing there ships.

For contributors testing a locally built whisper.cpp engine, point the desktop
shell at it without changing the project format:

```sh
WHISPER_CLI_PATH=/path/to/whisper-cli \
WHISPER_SERVER_PATH=/path/to/whisper-server \
WHISPER_MODEL_PATH=/path/to/ggml-small.en.bin \
npm run dev
```

For a production bundle:

```sh
npm run build
npm run package:mac   # on macOS
npm run package:win   # on Windows
```

The packaging commands fetch and verify the pinned official Whisper model as a
build asset before creating the installer. Release CI also bundles MarkItDown
and its DOCX/PDF conversion dependencies; end users do not run either setup
step.

## License

Kosmos is released under the [MIT License](LICENSE).
