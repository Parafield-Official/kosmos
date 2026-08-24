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

