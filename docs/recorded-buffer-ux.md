# Recorded buffer UX simplification plan

Status: implemented. Uses an in-app confirmation dialog to preserve playback on cancel.

This plan supersedes the controls and gestures described in
`recording-and-playback.md`, `ruler-loop-region.md`, and
`recorded-buffer-behavior.md` where they conflict with the requirements below.
Existing playback continuity, live recording, note editing, Fit, and MIDI metadata
preservation remain part of the implementation contract.

## Behavior and implementation

### 1. Hide the editor tab on mobile

- Use the existing mobile breakpoint: viewport width at or below 667 px.
- Hide only the Recorded buffer tab. Keep Just play and Send MIDI available.
- Replace `Instrument.tsx`'s hard-coded three-tab keyboard navigation with
  navigation over the currently visible tabs, including Home/End behavior.
- If the viewport becomes mobile while Recorded buffer is active, select the
  performance tab matching the current output route. Retain the mounted editor
  and its state so playback continues and the editor can be reopened on desktop.
  Move focus to that tab if focus was inside the now-hidden editor or tab.
- Keep session recording and the existing performance-tab Play/Stop buffer control
  available on mobile.

Files: `src/components/instrument/Instrument.tsx`, `src/styles/app.css`.

### 2. Reduce controls

- Remove the paragraph beginning “Drag empty ruler space to draw a loop” and its
  obsolete `aria-describedby` reference.
- Remove the visible Loop start/Loop end number fields, Clear range, Delete
  selected notes, Zoom in, Zoom out, and Undo clear controls.
- Remove Playback output from `Instrument.tsx`. Buffer playback uses the output
  selected through Just play or Send MIDI; the existing sound and port controls
  continue to control that route.
- Retain Play loop, Stop, Clear buffer, Fit, note count/duration, and one download
  action. Consolidate the remaining toolbar/status layout and remove unused CSS.
- Preserve the ruler's accessible Loop range, Loop start, and Loop end controls,
  their seconds announcements, visible focus, and keyboard adjustments. Removing
  the separate number fields must not remove the primitives' accessible inputs.

Files: `RecordedBuffer.tsx`, `Instrument.tsx`, `src/styles/app.css`.

### 3. Distinguish ruler click from drag and support seeking

- A primary single click outside the current loop clears the explicit range and
  seeks to the clicked time. With no explicit range, clicking empty ruler space
  seeks without creating a loop. Clicking the loop body or either handle retains
  its existing behavior.
- Use one gesture owner to distinguish a click from a drag, with a small movement
  threshold (initially 4 CSS px). Commit clearing/seeking only on pointer release
  without a drag. A canceled gesture does neither.
- Preserve drawing in both directions, moving the body, resizing either edge,
  the 1 ms minimum range, and keyboard adjustments. A completed drag must not
  trigger a follow-up click that clears its range.
- The current `Timeline.Lane` intentionally avoids the competing seek handler in
  `Timeline.Ruler`. Adapt the existing range drawing integration or replace only
  its empty-space drawing handler; do not layer two independent gesture owners.
- Convert coordinates using the scrolled timeline's geometry and current zoom.
  Compare against actual time bounds, including for short loops whose visual
  handles use `minDrawnWidth`; decorative ticks must pass pointer events through.
- Add an explicit seek path that updates both `positionRef` and rendered position.
  Clear-range and seek must be one transport update so the old range start does
  not overwrite the requested playhead. While stopped, keep the cursor at the
  clicked time; the next Play starts there when it is inside playback bounds.
- While playing, update the running transport and reconcile sounding notes without
  stopping. Follow the existing bounds policy: a seek outside whole-buffer bounds
  resumes at their start. A stopped cursor may sit in displayed trailing silence;
  seeking alone does not extend the recording or exported duration.
- Keep Stop returning to the effective loop start. Adjust `play()` to honor a valid
  stopped seek position rather than always starting at zero.

Files: `RecordedBuffer.tsx`; reuse `src/instrument/transport.ts`'s existing update
operation, extending its start-position interface only if needed.

### 4. Delete selected notes with Backspace

- Handle Backspace when focus is on the note editing surface, including a focused
  note and the grid after marquee selection. Delete all selected editable notes.
- Share one deletion path with the editor update flow. Use the latest recording
  snapshot, retain pending held notes and concurrent capture, clear deleted IDs
  from selection, and reconcile playback immediately.
- Prevent the browser default and consume a handled event once, before the
  primitive can also delete the focused note. Ignore composition, modified keys,
  editable fields, ruler controls, and unrelated instrument controls.
- Preserve the primitive's existing Delete-key behavior unless it needs to use
  the shared path to avoid inconsistent selection handling. Note deletion requires
  no confirmation; confirmation applies to Clear buffer.

File: `RecordedBuffer.tsx`.

### 5. Zoom with the wheel over the ruler

- Scroll up (`deltaY < 0`) zooms out; scroll down (`deltaY > 0`) zooms in.
- Normalize wheel delta modes and use smooth bounded scaling that handles mouse
  wheels and trackpads. Keep the time under the pointer fixed while zoom changes.
- Handle vertical wheel input across the ruler, including its loop and handles,
  with a non-passive listener. Prevent page/viewport scrolling for handled input;
  leave wheel scrolling over the note grid and horizontal-only scrolling intact.
- Coordinate with `Timeline.Viewport`'s existing Cmd/Ctrl-wheel zoom so each wheel
  event changes zoom once. Preserve its behavior outside the ruler.
- Reconcile zoom bounds with Fit, which currently permits values outside the
  toolbar's old 0.1–1000 limits. A wheel step after Fit must not cause a sudden
  jump to those old bounds. Zoom changes must not change loop or note times.

Files: `RecordedBuffer.tsx`, `src/styles/app.css` if cursor styling is needed.

### 6. Show loop boundaries through the piano roll

- Draw distinct loop-start and loop-end vertical markers through the note grid,
  aligned to the ruler's exact time coordinates. Use the same effective range as
  playback, including the implicit whole-buffer range.
- Give markers small brace caps and a color/style distinguishable from the white
  playhead. Use actual range times rather than the ruler's widened handle geometry.
- Make grid markers decorative and non-interactive so they cannot block note
  selection, dragging, resizing, or marquee gestures. Keep editing handles in the
  ruler and accessible values on the existing range controls.
- Verify alignment during drawing, movement, resizing, zoom, Fit, recording growth,
  and horizontal/vertical scrolling.

Files: `RecordedBuffer.tsx`, `src/styles/app.css`.

### 7. Use one contextual MIDI download action

Resolve the export target from the latest snapshot at click time, in this order:

| State | Export | Button label / filename |
| --- | --- | --- |
| At least one selected note ID still exists | Only selected notes, with complete durations; rebase the earliest selected start to zero and end at the latest selected end. Preserve internal gaps. Selection takes priority over a loop and is not clipped to it. | Download selected notes / `qwerkey-selection.mid` |
| No selected notes, explicit loop exists | All notes intersecting the loop, clipped/rebased with `clipNotes`; retain exact loop duration, including silence. | Download loop range / `qwerkey-range.mid` |
| Neither exists | All notes from zero through recording extent, retaining leading/trailing silence. | Download entire buffer / `qwerkey-buffer.mid` |

- Render exactly one button and update its visible/accessibility label with scope.
- Ignore stale selected IDs when choosing the target. Snapshot pending selected
  notes at download time, as current whole-buffer export already does.
- Disable only when there are neither exportable notes nor an explicit loop;
  an explicit silent loop remains downloadable, including on an empty buffer.
- Reuse `midiFile`, note metadata, Blob download, and URL cleanup behavior. Export
  requires no output device or MIDI permission.

Files: `RecordedBuffer.tsx`; extract a small export-target helper if it makes
scope resolution independently testable.

### 8. Confirm Clear buffer and remove undo logic

- Require confirmation before stopping playback or changing recording/editor
  state. Use a native confirmation initially: “Clear the recorded buffer? This
  cannot be undone.” Cancel is a complete no-op for the clear action.
- On confirmation, cancel playback and pending async Play, clear the recording,
  reset selection/range/playhead/timeline padding, and refresh the editor.
- Retain `recording.clear()`'s existing behavior for physically held notes: they
  begin fresh capture in the new buffer and finish normally on release. Clear does
  not mute live input or disable recording.
- Remove the undo state, snapshot capture, restore handler, and Undo clear button.
  Remove `recording.restore()` after verifying it has no remaining callers, along
  with tests and documentation that promise undo. Do not introduce general history.
- Test confirmation with the app's existing blur/visibility cleanup: opening or
  canceling the native dialog must not itself reset playback or editor state.
  If the native dialog triggers that cleanup, use an accessible in-app confirmation
  dialog instead, with Cancel initially focused and Escape canceling.

Files: `RecordedBuffer.tsx`, `src/instrument/recording.ts`.

## Delivery order

1. Implement ruler click/drag arbitration and seek, wheel zoom, and Backspace
   deletion, then remove their replaced controls.
2. Add grid loop markers and contextual download scope.
3. Add clear confirmation, remove undo/restore, remove the output selector, and
   simplify the toolbar.
4. Add mobile visibility and visible-tab navigation, including resize/focus handling.
5. Update tests and README; mark conflicting portions of the earlier plans as
   superseded by this plan when implementation is delivered.

## Verification and acceptance

Extend `tests/recording.spec.js` and responsive coverage in `tests/pointer.spec.js`:

- At 375, 666, and 667 px, Recorded buffer is hidden and keyboard navigation skips
  it; at 668 px and desktop it is available. Desktop-to-mobile resize preserves
  playback/editor state and leaves focus and panel labeling on a visible tab.
- Replace tests using removed number fields/buttons with ruler gestures and
  accessible range-handle keyboard controls. Move editor tests currently running
  at 667 px above the breakpoint; keep narrow desktop/touch gesture coverage.
- Assert removed controls/help text are absent and exactly one download exists.
- Click before/after a loop while stopped and playing; verify range clearing,
  stopped/next-Play positions, and audible/event-level seek reconciliation. Cover
  no range, trailing silence, short widened loops, ticks, scrolling, drag threshold,
  pointer cancellation, and absence of an extra clear after a drag.
- Backspace deletes single and multiple selections, including marquee focus and
  during playback. Pending/concurrently captured notes survive; input fields,
  ruler controls, and performance surfaces do not trigger deletion.
- Verify both wheel directions, pointer anchoring, delta modes, limits, Fit followed
  by wheel, no double zoom with modifiers, and ordinary grid scrolling.
- Assert marker time alignment and that marker overlays do not block note editing.
- Parse downloaded MIDI for all three scopes and selection-plus-loop priority,
  discontiguous notes, stale IDs, pending-note snapshots, boundary clipping,
  metadata, silence, and empty-buffer enable/disable behavior.
- Cancel clear with state intact, accept clear with state reset, cover held notes
  and pending async Play cancellation, and assert Undo clear is absent.
- Retain route handoff, playback continuity, live-capture isolation, Fit, and
  lifecycle cleanup regressions.

Run `npm run build`, the focused recording/responsive tests, then the full
Playwright suite (`npm test`). Visually inspect the simplified desktop toolbar,
loop markers, tiny-loop handles, zoom anchoring, and mobile tab layout. No new
dependencies are expected.

## Implementation record

Implemented the simplified toolbar, mobile tab visibility and resize/focus handling,
click-versus-drag ruler gestures, seek-aware playback starts, ruler wheel zoom,
Backspace group deletion, grid loop boundaries, contextual MIDI export, and an
in-app clear confirmation. Removed recording restore/undo. Updated the README
and supersession links in the earlier behavior plans.

Validation: `npm run build` passed with only the existing keyCode deprecation
hints. All 79 Playwright tests passed. Desktop loop-marker/toolbar and mobile tab
screenshots were visually inspected. MIDI coverage uses mock ports; no hardware
MIDI validation was performed.
