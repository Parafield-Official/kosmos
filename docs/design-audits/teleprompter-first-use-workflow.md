# Teleprompter First-Use Workflow Audit

Date: 2026-08-24

## Direct answer

Before this correction, a first-time narrator would not reliably understand the Teleprompter without experimentation. The primary recording loop existed, but the interface presented too many concepts at once and used labels that described the product's internal model instead of the narrator's task.

## Observed comprehension failures

1. **The entry action was hidden below the manuscript preview.** “Open the page” did not clearly mean “open the Teleprompter and record while reading.”
2. **The top bar mixed modes and actions.** Narrate and Review looked like tabs, but Review opened a recording chooser instead of switching a view.
3. **Technical disclosure arrived before orientation.** “Voice follow is experimental” explained limitations before telling a new narrator what to do.
4. **“Off” was unexplained.** It could mean microphone off, voice follow off, recording stopped, or a model failure.
5. **The reading surface opened crowded.** Chapter navigation and five Materials tabs competed with the manuscript even for a one-chapter book.
6. **Stopped actions were duplicated.** Continue and Start over appeared in both the saved-read card and the sticky action bar.
7. **Two progress measures disagreed.** The saved tape could say 10% recorded while the bottom bar said 0% page progress.
8. **Completion appeared too early.** “Finished this chapter?” could be visible even when recorded coverage was far from complete.

## Corrected narrator workflow

### 1. Enter

- The Record page leads with **Teleprompter** and an **Open teleprompter** action.
- The manuscript preview and imported-take workflow remain available below it.
- A one-chapter book opens without a redundant chapter rail.
- Materials stay closed until requested.

### 2. Understand

- A compact three-step guide explains the entire loop:
  1. Start recording.
  2. Read naturally and follow the highlighted line.
  3. Stop, then continue or review.
- The current step has an explicit state sentence: Ready, Recording, Paused, Saving, or Saved.
- Technical details live behind **How voice follow and saving work**.

### 3. Record

- The primary action says **Start recording**, not Start narrating.
- While active, the state says **Recording your booth read**.
- The final action says **Stop and save**, making the consequence explicit.
- Pause clearly holds the narrator's place and excludes new microphone audio.

### 4. Decide after Stop

- The saved-read card provides evidence: duration, manuscript coverage, and playback.
- The sticky action bar contains the only decision controls:
  - **Continue recording** — primary.
  - **Review recording…** — secondary.
  - **Start over…** — cautious/destructive path with confirmation.
- The bottom progress line uses recorded coverage in this state, matching the saved-read card.

### 5. Review

- Review is named as an action, not a Teleprompter mode.
- If multiple recordings exist, the narrator chooses the source before Review.
- The chapter-completion prompt appears only when page progress or recorded coverage reaches 90%.

## Acceptance criteria

- A first-time narrator can describe the three-step loop before recording.
- Every state answers: Is recording happening? What should I do next? What will that action save or replace?
- Only one primary action appears in each state.
- Continue, Review, and Start over are not duplicated.
- Saved-read coverage is consistent between the card and bottom action bar.
- Optional materials and diagnostics do not compete with the initial task.
- Review is not offered as chapter completion before the narrator is near the end.
