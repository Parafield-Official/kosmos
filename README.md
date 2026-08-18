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
The current Phase 0 build establishes the project-folder format, persistence
boundary, and tested proof/ACX core contracts. The first runnable vertical
slice is the next phase.

## Install (release builds)

1. Download the Mac `.dmg` or Windows `.exe` from the latest GitHub Release.
2. macOS: open the disk image and drag Booth Desk to Applications. If
   Gatekeeper blocks an unsigned build, right-click the app and choose Open.
3. Windows: run the installer. If SmartScreen appears for an unsigned build,
   choose More info → Run anyway.

The first Proof run downloads the selected Whisper model once, with a progress
bar. The model stays in Booth Desk's local application-data folder and is not
uploaded.

## Journey A (first vertical slice)

The target first-use flow is:

1. File → New Project and choose a folder.
2. Paste or import one chapter of plain text.
3. Attach that chapter's WAV or MP3.
4. Click Proof and review timestamped word mismatches.
5. Check the ACX traffic light and measured RMS, true peak, noise floor, rate,
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

For a production bundle:

```sh
npm run build
npm run package:mac   # on macOS
npm run package:win   # on Windows
```

## License

Booth Desk is released under the [MIT License](LICENSE).

