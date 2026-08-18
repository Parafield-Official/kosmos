# Booth Desk

[Download for Mac](https://github.com/Manishram-ai/booth-desk/releases/latest) · [Download for Windows](https://github.com/Manishram-ai/booth-desk/releases/latest)

Booth Desk is a free, offline desktop app for turning a manuscript and human
recordings into proofed, ACX-ready audiobook files. Your book and your voice
stay on this computer. There are no accounts, meters, analytics, or
cloud-uploaded manuscripts.

Booth Desk does not read the book, generate a voice, replace a DAW, or promise
to catch acting, accents, clicks, or echo. Proof catches text mismatches; a
human still listens.

## Current build

This repository is being built in the phases described in [`docs/SPEC.md`](docs/SPEC.md).
The current build carries the consecutive Phase 0–5 slices: a local project
folder and Journey A proof flow; ACX measurement, mastering, and named export;
TXT/Markdown, DOCX (bold/italic/underline/highlight spans), EPUB, and text-layer
PDF import with split/merge/rename; deterministic glossary candidates with
human pronunciation clips; author/narrator roles, chapter notes, pickup status
and notes, and light/full collaborator ZIPs; a styled manual teleprompter,
DAW marker export, listen-safe DIY recording review, one-line punch splicing,
and room testing; plus duet seat painting, N1/N2 pickup filters, seat packs,
bed/overdub mixing, and separate stems. The master runs gate → loudness →
true-peak limit → room-tone padding and refuses a take whose noise cannot be
fixed without damaging the voice. The shipped proof fixture can be loaded
without a network connection.

The teleprompter is deliberately manual-scroll-first. Listen-only ASR live
flags remain disabled in this pre-release until that path can meet the
high-precision/auto-dim requirement without crying wolf.

This is a pre-release development build. The source path currently expects a
local `ffmpeg`; the release pipeline must bundle the LGPL build and
`whisper-cli` before `.dmg` / `.exe` artifacts are called installable v1 builds.

## Install (release builds)

1. Download the Mac `.dmg` or Windows `.exe` from the latest GitHub Release.
2. macOS: open the disk image and drag Booth Desk to Applications. If
   Gatekeeper blocks an unsigned build, right-click the app and choose Open.
3. Windows: run the installer. If SmartScreen appears for an unsigned build,
   choose More info → Run anyway.

The first Proof run downloads the selected Whisper model once, with a progress
bar and checksum verification. The model stays in Booth Desk's local
application-data folder and is not uploaded. If a release is opened offline
before its model has been cached, the bundled proof fixture and pasted local
transcript path remain available; no cloud fallback is attempted.

## Journey A (first vertical slice)

The target first-use flow is:

1. File → New Project and choose a folder.
2. Paste or import one chapter of plain text.
3. Attach that chapter's WAV or MP3 (or choose **Try the proof fixture**).
4. Click Proof. Booth Desk uses local Whisper when installed; for a fixture or
   development build you may paste a local transcript instead.
5. Review timestamped word mismatches and check the ACX traffic light with RMS, true peak, noise floor, rate,
   channels, duration, and room-tone values.

## Working next to Reaper

Record and edit in Reaper (or another DAW), then attach the finished WAV to a
chapter. Booth Desk is the script, proof, pickup, and ACX desk beside your DAW;
it is not a replacement multitrack editor. The optional in-app recorder is for
DIY authors who need a simple record/stop/punch workflow.

## Offline by design

Prep, proof, teleprompter, ACX checking, mastering, and export are local. The
app has no sign-in, telemetry, crash phone-home, cloud LLM, voice clone, or
remote narrator marketplace. Shared work happens by passing the `.booth`
project folder (or a zip) between people.

## Build from source (contributors)

Requirements: Node.js 20+ and npm. Release packaging also needs the platform
toolchain used by Electron Builder.

```sh
npm install
npm test
npm run typecheck
npm run dev
```

For contributors testing a locally built whisper.cpp engine, point the desktop
shell at it without changing the project format:

```sh
WHISPER_CLI_PATH=/path/to/whisper-cli \
WHISPER_MODEL_PATH=/path/to/ggml-small.en.bin \
npm run dev
```

For a production bundle:

```sh
npm run build
npm run package:mac   # on macOS
npm run package:win   # on Windows
```

## License

Booth Desk is released under the [MIT License](LICENSE).
