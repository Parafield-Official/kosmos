# Release runtime assets

Release builds place the platform-specific `ffmpeg`, `ffprobe`, and
`whisper-cli` binaries in this directory before Electron Builder runs. The
binaries are intentionally not committed to the source repository. A source
checkout may use `FFMPEG_PATH`, `FFPROBE_PATH`, and `WHISPER_CLI_PATH` instead.

The release maintainer must audit the FFmpeg build as LGPL-compatible (and
bundle any required dynamic libraries and notices) before publishing an
installer. The local developer FFmpeg is not automatically suitable for
redistribution.

See `.github/workflows/release.yml` for the reproducible packaging steps and
the upstream licenses that must travel with a distributed build.
