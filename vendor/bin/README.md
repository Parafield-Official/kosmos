# Release runtime assets

Release builds use the platform-specific `ffmpeg`, `ffprobe`, and
`whisper-cli` binaries in this directory. The macOS arm64 runtime is staged
for the private release repository so a clean clone can build and test the
same proof workflow. A source checkout may still override them with
`FFMPEG_PATH`, `FFPROBE_PATH`, and `WHISPER_CLI_PATH`.

Before `electron-builder` runs, `npm run audit:runtime` must pass. It requires
`FFMPEG_LICENSE.txt`, executes both FFmpeg tools, rejects `--enable-gpl` and
`--enable-nonfree` builds, and writes a local `FFMPEG_AUDIT.json` receipt. It
also executes `whisper-cli`, verifies its MIT notice and SHA-256 checksum, and
writes `WHISPER_AUDIT.json`. A packaged app fails closed if a required runtime
was omitted; it never silently falls back to a system binary in a public
installer.

The release maintainer must stage an FFmpeg build audited as LGPL-compatible,
the matching dynamic libraries/notices, and the pinned whisper.cpp build
notice before publishing an installer. `WHISPER_AUDIT.json` records the
whisper.cpp source commit used for the staged executable.

See `.github/workflows/release.yml` for the reproducible packaging steps and
the upstream licenses that must travel with a distributed build.
