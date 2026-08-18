# Bundled Whisper model

The release installer includes the pinned `small.en` Whisper model at build
time. `npm run prepare:model` downloads the official whisper.cpp model,
verifies its SHA-1 checksum, and stages it as `ggml-small.en.bin` in this
directory before Electron Builder packages the app.

Pinned SHA-1: `db8a495a91d927739e50b3fc1cc4c6b8f6c2d022`.

The model is intentionally not committed to Git: it is a large binary asset
and GitHub's normal repository limits make source checkout and review slower.
The installer still contains the verified model, so an end user never needs a
separate model download or setup step.
