# Line-follow stress benchmark

This benchmark measures the teleprompter as a reading-position tracker, not as
a word-error proofreader. A fixed macOS virtual narrator reads a seven-line
manuscript with realistic miscues. The audio is decoded by Kosmos's bundled
Parakeet live model, and its finalized word batches are passed to the production
`matchLiveWindow` function with the default stop-on-mismatch behavior enabled.

## Cases and expected behavior

- Clean sequential reading continues through the last spoken line.
- Restarting the current line follows the narrator back and then recovers.
- Saying an editing phrase ("Sorry, start again") does not stop the page before
  the repair can arrive.
- Repeating the prior line follows the narrator back and then recovers.
- Skipping one or two complete lines stops on the first unread line.
- Jumping away after part of a line stops where continuity broke.
- An unrelated sentence does not move the page and stops on the unread line.

The score is scenario accuracy: the expected stop/recovery outcome must be
correct. Continue cases also require the final cursor to cover the last intended
line, and repetition cases require an observed backward cursor transition.

## Why these cases

Reading-tracker research evaluates position changes by transition type: staying
at a word, advancing one, skipping ahead, and regressing. It also warns that a
strict left-to-right tracker masks repetition and deletion errors, while an
unconstrained "chase the reader" strategy is vulnerable to more insertion
errors. Kosmos therefore needs asymmetric recovery: strong evidence can follow
a local regression, while a forward jump across an unread line should stop for
confirmation rather than silently consume the omission.

Speech-repair research models a self-correction as the abandoned material,
optional editing words, and the repair. Restarts and repetitions need a short
grace period so the repeated manuscript anchor can arrive before ordinary
off-page mismatch handling stops the session.

Research references:

- J. Mostow et al., *Evaluating Tracking Accuracy of an Automatic Reading
  Tutor*: https://www.cs.cmu.edu/~listen/pdfs/tracking-paper.pdf
- V. Sunder et al., *End-to-End real time tracking of children's reading with
  pointer network*: https://arxiv.org/abs/2310.11486
- C. Nakatani and J. Hirschberg, *A Speech-First Model for Repair Detection and
  Correction*: https://aclanthology.org/H93-1066/
- S. Zwarts et al., *Detecting Speech Repairs Incrementally Using a Noisy
  Channel Approach*: https://aclanthology.org/C10-1154/

## Baseline

Run on 2026-08-24 with the Daniel virtual voice at 165 words per minute and the
bundled `realtime_eou_120m-v1-f16.gguf` recognizer: **2/9 scenarios passed
(22.2%)**. Clean reading and unrelated speech behaved correctly. All four
restart/repetition cases failed, and all three forward-jump cases were silently
accepted instead of stopping at the unread line.

The machine-readable trace is `line-follow-before.json` in this directory.

## Open-source alignment review

WhisperX is the right tool for post-recording timing, not the live cursor. Its
published pipeline uses VAD to assemble long speech chunks and then applies
phoneme-model/DTW forced alignment to a completed transcript. Kosmos already
uses optional WhisperX output after a booth tape stops, with the manuscript
clock retained as fallback. Running that batch pipeline during narration would
add another recognizer and seconds of context without deciding whether a
forward text match is a legitimate ASR recovery or an omitted line.

ReadAlong Studio is a useful MIT-licensed reference for private audiobook
text/audio alignment, but it is likewise an offline production pipeline rather
than a streaming position tracker.

Two newer 2026 projects are worth a future recognizer bake-off, but not a blind
runtime replacement in this fix:

- Qwen3-ASR offers a 0.6B forced aligner and streaming ASR, but its official
  streaming path does not return timestamps. The forced aligner remains a
  separate offline operation.
- `audio.cpp` now exposes Qwen3-ASR and Qwen3-ForcedAligner through a portable
  GGUF/Metal runtime. This is promising for a future native A/B benchmark, but
  it introduces a substantially larger model family and has not yet been tested
  against Kosmos's 160 ms follow latency or this narrator-miscue corpus.
- The small pure-C Qwen3-ASR runtime is MIT-licensed and supports live input,
  but commits stable text in two-second chunks. That is too coarse to replace
  the current 160 ms Parakeet hop without a measured UX win.

The production change therefore reuses the most relevant alignment idea—local,
constrained sequence evidence—inside the existing low-latency matcher. It does
not add a network service, Python environment, model download, or new license.

Additional references:

- WhisperX source and limitations: https://github.com/m-bain/whisperX
- WhisperX paper: https://www.isca-archive.org/interspeech_2023/bain23_interspeech.pdf
- ReadAlong Studio: https://github.com/ReadAlongs/Studio
- Qwen3-ASR: https://github.com/QwenLM/Qwen3-ASR
- `audio.cpp`: https://github.com/0xShug0/audio.cpp
- Pure-C Qwen3-ASR: https://github.com/antirez/qwen-asr

## Improved result

The identical cached virtual-voice recordings and recognizer were rerun after
adding bounded backward repair anchors, neutral editing cues, and guarded
cross-line forward resync. Browser-measured wrapped rows are also passed into
the matcher, so a skipped on-screen line inside one prose paragraph receives
the same protection; that path has a separate regression test. The virtual
voice result improved from **2/9 (22.2%) to 9/9 (100.0%)**:

- all four restart/repetition cases moved backward and recovered;
- all three skip/jump cases stopped on the first unread line;
- clean sequential reading still completed;
- unrelated speech still stopped without being treated as manuscript progress.

The exact after trace is `line-follow-after.json` in this directory.
