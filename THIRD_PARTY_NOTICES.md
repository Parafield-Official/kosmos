# Third-party notices

Kosmos is MIT-licensed, but its release installers contain independent
software and its setup flow downloads independently licensed model assets.
These notices travel with every installer and are linked from the download
page.

## Speech models

- `ggml-small.en.bin` is the English small Whisper model in ggml format from
  [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp), which
  is released under the MIT License. Kosmos downloads a revision-pinned
  upstream file during setup and verifies its published SHA-256 before use.
- `realtime_eou_120m-v1-f16.gguf` is a GGUF conversion from
  [mudler/parakeet-cpp-gguf](https://huggingface.co/mudler/parakeet-cpp-gguf),
  derived from NVIDIA NeMo Parakeet checkpoints. The model weights are
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Kosmos downloads the unmodified F16 file from a revision-pinned upstream
  source during setup and includes this attribution and license link in the
  installed application.

## Native runtime tools

- FFmpeg and FFprobe are distributed as LGPL-compatible builds. The exact
  version, configure flags, checksums, license text, dynamic-library notices,
  and corresponding source archive are attached to the matching GitHub Release.
  FFmpeg source: <https://ffmpeg.org/download.html>.
- LAME and mpg123, when included in the macOS runtime, are dynamically linked
  LGPL libraries. Their license/source references are included in the release
  runtime notices.
- whisper.cpp is MIT-licensed: <https://github.com/ggml-org/whisper.cpp>.
- parakeet.cpp is MIT-licensed: <https://github.com/mudler/parakeet.cpp>.
- Microsoft MarkItDown is MIT-licensed:
  <https://github.com/microsoft/markitdown>. The generated license inventory
  for its bundled Python dependencies is included beside the executable.

## Kosmos media

`labs/next/public/welcome.mov` is original Kosmos media. The project maintainer
has confirmed that public redistribution as part of Kosmos is authorized.
