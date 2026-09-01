#!/usr/bin/env python3
"""Offline, plugin-free MarkItDown entry point bundled with Kosmos."""

from __future__ import annotations

import argparse
import sys

from markitdown import MarkItDown


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a local manuscript to Markdown.")
    parser.add_argument("filename", help="Path to the local manuscript")
    args = parser.parse_args()

    # Do not load third-party plugins or cloud-backed converters in Kosmos.
    result = MarkItDown(enable_plugins=False).convert(args.filename)
    sys.stdout.write(result.text_content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
