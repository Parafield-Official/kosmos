#!/usr/bin/env python3
"""Self-contained WhisperX entry point bundled with Kosmos."""

import multiprocessing
import sys
from importlib import metadata


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if sys.argv[1:] == ["--version"]:
        print(f'whisperx {metadata.version("whisperx")}')
        raise SystemExit(0)

    from whisperx.__main__ import cli

    raise SystemExit(cli())
