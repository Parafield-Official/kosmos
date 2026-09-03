#!/usr/bin/env python3
"""Self-contained WhisperX entry point bundled with Kosmos."""

from whisperx.__main__ import cli


if __name__ == "__main__":
    raise SystemExit(cli())
