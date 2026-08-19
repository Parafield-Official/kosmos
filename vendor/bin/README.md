# Release runtime assets

Release builds use the platform-specific `ffmpeg`, `ffprobe`, `whisper-cli`,
`whisper-server`, and `markitdown` helpers in this directory. `whisper-server`
is used only for short, listen-only narration windows so the small.en model
stays loaded while the narrator is speaking; Kosmos stops it when narration
stops and also has a 30-second idle safety timeout. The macOS arm64 runtime is staged
for the private release repository so a clean clone can build and test the
same proof workflow. A source checkout may still override them with
`FFMPEG_PATH`, `FFPROBE_PATH`, `WHISPER_CLI_PATH`, and `MARKITDOWN_PATH`.

`markitdown` is Microsoft's plugin-free, offline document converter. Release
CI builds it from `scripts/markitdown_cli.py` with the pinned DOCX/PDF extras
and includes its `MARKITDOWN_LICENSE.txt` notice beside the executable.

Before `electron-builder` runs, `npm run audit:runtime` must pass. It requires
`FFMPEG_LICENSE.txt`, executes both FFmpeg tools, rejects `--enable-gpl` and
`--enable-nonfree` builds, and writes a local `FFMPEG_AUDIT.json` receipt. It
also executes `whisper-cli`, verifies its MIT notice and SHA-256 checksum, and
writes `WHISPER_AUDIT.json`. A packaged app fails closed if a required runtime
was omitted; it never silently falls back to a system binary in a public
installer.

The release maintainer must stage an FFmpeg build audited as LGPL-compatible,
the matching dynamic libraries/notices, and the pinned whisper.cpp build
notice before publishing an installer. Both Whisper executables are static
builds from the same pinned source commit. `WHISPER_AUDIT.json` records the
whisper.cpp source commit used for the staged CLI executable.

See `.github/workflows/release.yml` for the reproducible packaging steps and
the upstream licenses that must travel with a distributed build.
