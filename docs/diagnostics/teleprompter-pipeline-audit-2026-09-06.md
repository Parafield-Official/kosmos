# Teleprompter pipeline audit

Audited the recording and proofread teleprompters on `main`, starting at `2ae0d51`, using the two supplied screenshots and deterministic Electron reproductions. Changes are local; no packaged release was installed or published.

## Findings and fixes

| Finding | Cause | Corrected behavior |
| --- | --- | --- |
| Line/Paragraph also highlighted an individual word | `TeleprompterFocus` always added a word rail, irrespective of the setting; proofread also always applied `is-now` to the active word. | Explicit mode controls the overlay and text styling. Line highlights one displayed row; Paragraph highlights its rows; only Word highlights an individual word. A one-word line remains a line band. |
| Highlight/caret drifted while the text scrolled | Viewport-relative coordinates were applied to an absolutely positioned overlay inside the scrolling content. Scrolling displaced that overlay again, and its viewport-sized clipping region moved with it. | The overlay is a sibling of the scroller. Word rectangles are measured relative to the overlay's own origin; clipping belongs to the visible panel. An offscreen cursor has no floating caret. |
| Small manual scrolls snapped back on the next cursor update | Manual scrolling disabled follow only after the cursor left a central band. A one-frame auto-scroll flag could also misclassify delayed scroll events. | Wheel, touch, keyboard, scrollbar dragging, and other manual scrolls detach immediately. Programmatic scroll events are recognized by their destination. Locate restores follow. |
| Browsing during recording-screen tape playback did not stay detached | Every `syncCursorFromTape` callback explicitly re-enabled follow. | Tape timing updates the script cursor without changing the user's detached scroll state. |
| Final line/cursor could disappear or fail to reach the reading position | Embedded panels used fixed bottom padding, and completion can report `cursor === wordCount`, for which no word element exists. | Bottom space scales with panel height. Rendering clamps a completed cursor to the last real word while preserving the underlying completion count. |
| Proofread “Line” meant a sentence | The visual band came from narration redo sentence ranges. | Displayed rows are measured from the actual text layout. Sentence/paragraph redo selection and audio edit ranges remain separate. |
| Highlight did not reliably update after a layout change | Recording band measurement depended on cursor changes, not all font, spacing, or panel changes. | Shared `useTeleprompter` measures on cursor/settings changes, panel/content resize, and font loading. |
| Reading settings disagreed between Record and Proofread | Proofread initialized Word and comfortable spacing independently of persisted recording choices. | Both views read/write the existing indicator and spacing storage keys. |
| First-use font size was 20px despite a declared 28px default | `Number(null)` converted absent storage to zero, which was clamped to the minimum. | Missing/blank values use the intended 28px default. Valid saved sizes are preserved. |

## Pipeline boundaries

Chapter HTML supplies the rendered paragraphs and indexed words. Live transcription feeds the existing matcher and cursor lead; original/working tape playback feeds the existing timing-to-token mapping. Both UI paths now pass their cursor, paragraph bounds, indicator mode, and measured word elements through the same scroll/band controller. The overlay consumes that display state.

Manual scrolling changes only the viewport/follow state. Locate restores automatic positioning. Explicit recording start/resume, chapter changes, and chosen resume words restore follow as appropriate. Recognition, live matching, predictive lead, audio capture, proofing, and audio edit algorithms were not changed.

The screenshots establish the reported layout, but do not by themselves establish a dynamic root cause. The UI failures were reproduced with known cursor indices and synthetic tape time-update events, without invoking a speech model. That confirms UI defects independent of transcription accuracy; it does not assert that every possible live-follow issue is fixed.

## Verification

- `node_modules/.bin/electron scripts/verify-teleprompter.cjs`: **18 passed, 0 failed** in a real Chromium renderer, with an isolated temporary profile and synthetic manuscript/audio.
- The same expanded fixture with `--baseline`: **1 passed, 17 failed** against the original UI and preference code. These are regression-check outcomes, not 17 independent defects; some failures share a cause or setup.
- Covered actual Settings mode/spacing buttons, word/line/paragraph rails, same-line cursor progression, small manual scrolls, recording-screen tape updates, keyboard browsing, Locate, font/spacing reflow, narrower panels, offscreen clipping, theme changes, one-word final lines, and completion at `wordCount`.
- Targeted Vitest run covering `src/core/teleprompter`, `reading-prefs.test.ts`, and `review-timing.test.ts`: **197 tests passed in 16 files**.
- `npm run build`: passed, including TypeScript and the production renderer build. Vite reported its existing chunk-size and mixed-import warnings.
- `git diff --check`: passed.

The first typecheck found a missing declared `react-test-renderer` dependency in the pre-existing `node_modules` tree after switching branches. Installed declared dependencies without changing the manifest or lockfile; the subsequent build passed.

The regression script writes a screenshot and JSON results to a fresh temporary directory and exits nonzero when a check fails. Successful run artifacts: `/var/folders/bp/_84kkvn91hn4k3nd_q4rwmnw0000gn/T/kosmos-prompter-check-5B1B00`. Baseline artifacts: `/var/folders/bp/_84kkvn91hn4k3nd_q4rwmnw0000gn/T/kosmos-prompter-check-BR04XR`.

A real microphone/narration session and the installed packaged app were not exercised in this audit. Those remain useful acceptance checks for live speech timing; the deterministic tests validate the UI defects and fixes independently.
