# Generated Silero VAD cache

The release workflow downloads the pinned Silero VAD source archive, verifies
its SHA-256, and stages only `hubconf.py`, `LICENSE`, `src/`, and a revision
marker in this directory. Electron Builder ships the result so WhisperX can
seed Torch Hub without downloading executable code on first use.
