# Recorded buffer behavior changes

Controls and ruler gestures are superseded by [Recorded buffer UX](recorded-buffer-ux.md).

Status: implemented. See the implementation record below.

## Behavior contract

1. Playback continues when moving between Qwerkey's Just play, Send MIDI, and
   Recorded buffer tabs. Returning to the editor shows the same running transport,
   loop, selection, zoom, and scroll position. Here, “tab” means an application tab;
   the existing stop-on-window-blur and hidden-page behavior remains in scope as
   lifecycle cleanup, not navigation.
2. Drawing, moving, resizing, entering, or clearing a loop region keeps playback
   running. Keep the absolute playhead if it is inside the new half-open range;
   otherwise jump to the new start and continue. Stop still returns to the current
   range start, not the bounds captured when Play was first clicked.
3. Moving, resizing, transposing, deleting, drawing, and changing note velocities
   keeps playback running. Committed edits become audible on the next transport
   update, with active notes reconciled as described below. Live capture and editor changes feed the same recording snapshot used by the
   roll and running transport; overdubs are available on subsequent loop passes
   without restarting playback.
4. Space toggles buffer playback when focus is on the instrument background or
   buffer editing surface. Ignore repeated keydown, composition, and modified Space.
   Preserve text/number entry, native button activation, select controls, and the
   performance piano's existing Space-to-hold-note interaction. Provide an accessible
   persistent play/stop control so playback can also be stopped outside the buffer tab.
5. Up/Down transposes all selected editable notes by one semitone; Shift+Up/Down
   uses one octave, matching existing single-note editing. Keep intervals intact
   by clamping the group's displacement to MIDI 0–127. Preserve all other metadata
   and pending-note identities. Ruler and velocity controls retain their own arrows.
6. Fit performs two related operations: trim unused trailing buffer duration to the
   latest existing note end, then fit the explicit loop if present, otherwise the
   buffer from zero to that end. Fit preserves note timestamps, leading silence,
   gaps, and notes outside the loop. An explicit loop containing or extending into
   silence remains valid; it is not clamped to the last note. This interpretation
   treats “truncate” as trimming duration, not cutting notes or rebasing their starts.

## Current implementation and causes

- `src/components/instrument/RecordedBuffer.tsx` owns playback state, cancellation,
  and loop bounds. Its effect cleanup stops playback on unmount. Range changes,
  `PianoRoll.Root.onValueChange`, and toolbar deletion also call `stop()` directly.
- `src/components/instrument/Instrument.tsx` conditionally mounts the editor and
  keys it by route and MIDI ports. Entering Recorded buffer calls `releaseAll()`;
  selecting Just play or Send MIDI changes the shared output route.
- `src/instrument/transport.ts` takes immutable notes and length in `startLoop()`.
  It has no update operation, so removing editor `stop()` calls alone would leave
  the old notes and range playing indefinitely.
- `src/instrument/recording.ts` deliberately retains the historical maximum extent
  in `replace()`. Deletion and shortening therefore leave trailing empty duration.
  Fit currently only sets zoom to `600 / duration`; it neither trims that extent
  nor scrolls to a selected region, and uses a fixed assumed viewport width.
- The installed audio/ui core already supports semitone/octave editing from a
  focused note. Its grid keyboard handler does not apply those arrows to a marquee
  selection, which requires an application-level focus/selection bridge.
- `src/hooks/useInstrument.ts` handles document keyboard events and lifecycle release.
  Buffer shortcuts must cooperate with this handler and audio/ui handlers.

## 1. Give transport an instrument lifetime

Move transport ownership to the instrument controller, exposing play, stop, toggle,
update-range, update-editor-data, playing state, and absolute position through a
separate transport subscription. Let `RecordedBuffer` render and edit that state;
its unmount cleanup only releases preview ownership and UI subscriptions.

Keep editor view state above the conditional panel, or retain the editor mounted
under a hidden wrapper with correct accessibility. Remove route/port-based remount
as a lifecycle mechanism. Polling and playhead rendering should run only where
needed without interrupting transport while the editor is hidden.

Replace navigation's blanket `releaseAll()` with release of live/preview owners,
preserving playback owners. Route-changing tabs retain their existing output
selection behavior: hand playback over to the new output at the same playhead,
releasing old-route voices before revoicing notes spanning that position. Preserve
live-note cleanup and MIDI permission/Safari behavior. Handle explicit output
changes the same way; an unavailable MIDI output releases old voices and leaves
the running transport silent until a usable output is selected. Input changes
finalize incoming recordings without restarting playback.

Move blur, hidden-page, pagehide, and disposal cancellation to this persistent
owner. Clear buffer remains an explicit stop. Preserve cancellation of an async
Play request during audio enable, and avoid duplicate listeners under Strict Mode.

## 2. Support edits during playback

Refactor `startLoop()` into a transport with explicit start, update, stop, and
dispose operations, retaining the current deadline timer approach and injected
clock. This change does not require replacing the scheduling engine.

- Keep an absolute playhead, current bounds, playback note snapshot, and active
  playback owners. Update bounds/notes atomically before the next pump, cancel
  obsolete callbacks, and schedule remaining edges from the current position.
- Reconcile old and new sounding notes by stable ID and output identity. Preserve
  unchanged active owners, release deleted/moved-out/shortened notes immediately,
  release/revoice changed pitches or channels, and start notes newly spanning the
  playhead. Apply velocity changes at the next note-on. A duration-only extension
  of an active note changes its off deadline without retriggering it.
- Reuse `clipNotes()` for loop boundaries. Keep note-offs before note-ons at equal
  times and retain shared-pitch ownership with live notes and preview audition.
  Seeking after a range change releases the old active set and reconstructs the
  new one. Neither seeking nor editing transitions through stopped state.
- Pass explicit editor changes/deletions by ID to both recording and transport.
  Use `applyRollEdits()` against the latest recording snapshot to preserve
  concurrent capture. Selection-only and zoom/scroll changes do not reschedule.
- Remove stop calls from range changes, Clear range, note edits, and deletion.
  Coalesce rapid gesture updates to one transport reconciliation per pump.
  Deleting all playback notes leaves the transport running silently until Stop;
  retain valid loop bounds, with a 1 ms minimum for a whole-buffer loop.

## 3. Add keyboard handling with explicit focus rules

Handle transport Space centrally before live-key dispatch. Consume a handled event
once, prevent scrolling/native duplicate action where applicable, and make async
start cancellation work for a quick second Space. Honor already-handled events.
Intercept Space on focused roll notes before audio/ui's note-selection shortcut;
Enter remains available for note selection. Do not intercept the performance piano
or a focused native toolbar control.

Bridge Up/Down from the roll grid/marquee focus to the current selection, using the
same group edit operation as focused-note editing. Avoid a second transpose when
audio/ui already handles a focused note. Scope this to note editing, excluding
loop handles, velocity controls, editable fields, and live keyboard surfaces.
Expand displayed pitch bounds after transposition rather than treating the initial
41–96 visible range as the permitted MIDI range. Retain selected IDs and focus.

## 4. Make Fit trim duration and frame the target

Add an explicit recording-store operation to recompute extent from current notes;
keep ordinary edits from shrinking the timeline automatically. Include the current
snapshot end of held notes without finalizing or changing them. Fit on an empty
buffer resets stale extent to zero and uses a small valid display/transport minimum.

When no notes are pending, re-anchor future capture at the trimmed end at Fit time
so the deleted duration does not reappear on the next live note. Later elapsed
silence still records normally. While notes are held, preserve their recording
clock and identities; trim only obsolete stored extent. Repeated Fit is idempotent
apart from naturally growing held notes.

Compute zoom from the actual `.roll_viewport` client width and target interval,
with small edge padding, then set horizontal scroll after layout so both target
boundaries are visible. Use explicit loop bounds first, otherwise `[0, noteEnd]`.
Allow supported zoom bounds to accommodate long targets. Reset stale `timelineEnd`
padding while retaining enough timeline to reach all notes and any explicit loop.
Keep a safe empty-state fallback, vertical scroll position, and ruler alignment.

The trimmed extent must drive whole-buffer looping, the displayed duration, and
whole-buffer MIDI end-of-track time. Range export continues to preserve its exact
chosen silence. Fit during playback applies any whole-buffer bound change through
the running update path; an explicit loop keeps its bounds and playback position.

## Delivery and verification

Implement in order: persistent transport and navigation, mutable playback data,
keyboard handling, then Fit/store extent. Add focused tests with each stage, then
update `README.md` and mark the earlier stop-on-edit/navigation requirements in
`docs/recording-and-playback.md` and `docs/ruler-loop-region.md` as superseded.

Extend `tests/recording.spec.js` and add deterministic transport coverage:

- Application-tab round trips in both outputs, including route handoff and MIDI
  input changes: playback state/phase and editor state survive; old output notes
  are released and playback never feeds recording.
- Range drawing, movement, resizing, numeric edits, and clearing while playing:
  inside/outside playhead cases, boundary clipping, silent ranges, and Stop
  returning to the latest start. Replace the existing stop-on-range-edit assertion.
- Move, resize, transpose, velocity, add, delete, and concurrent incoming capture
  while playing: correct subsequent note edges, prompt active-note reconciliation,
  unchanged notes not retriggered, no stuck notes or canceled callbacks sounding.
- Space start/stop from background, grid, and note focus; key-repeat and rapid
  async toggles; native controls and live-piano Space continue to behave correctly.
- Single, Shift-click, and marquee selections transpose once by 1/12 semitones;
  MIDI bounds preserve group intervals, metadata and pending notes survive, and
  ruler/velocity arrows retain their existing meanings.
- Delete/shorten the last note and Fit: extent and downloaded MIDI track duration
  shrink. Cover empty buffers, held notes, subsequent live capture, leading/gap
  silence, long recordings, repeated Fit, and Fit while playing.
- Fit a nonzero loop after scrolling and zooming, including a silent loop beyond
  note extent: both edges appear within the actual viewport at desktop and 667 px.
- Existing blur/visibility/pagehide/disposal cleanup, Clear/Undo, preview/live
  shared ownership, route permissions, and MIDI export regressions still pass.

Run `npm run build`, the focused transport/recording tests, and the full Playwright
suite. Visually inspect Fit and persistent controls at desktop and the supported
667 px width. Completion requires audible/event-level continuity as well as a
running button state; leaving stale playback behind is not sufficient.


## Implementation record

The buffer editor remains mounted under a hidden wrapper for the instrument's
lifetime, retaining transport, selection, range, zoom, and scroll state across tabs.
This uses the plan's retained-editor option rather than moving transport into the
controller. Hidden editors skip playhead rendering and pending-length refreshes.
The controller releases only live/preview owners on entering the editor and
hands active playback owners between output routes. A persistent Play/Stop buffer
button is available on the performance tabs.

The deadline transport now supports updates that reconcile active owners by ID,
pitch, and channel, preserving unchanged voices and replacing future note edges.
Range changes retain an in-range absolute playhead or continue at the new start.
The roll and transport now share each refreshed recording snapshot, including
concurrent live recordings; the separate playback snapshot has been removed.
Space handling respects native controls and the performance piano; grid and note
selection transposition uses one group displacement bounded by MIDI 0–127.

Fit recomputes recording extent, reanchors future capture when no notes are held,
and calculates zoom and horizontal scroll from the actual viewport and selected
loop. Notes retain their timestamps and selected silent ranges remain intact.
Existing blur/hidden-page cleanup and Clear/Undo behavior remain available.

Validation: production build/typecheck and the full 76-test Playwright suite
passed, with only the existing keyCode hints. Added browser coverage for tab continuity (including oscillator starts
while hidden), Space, edits while running, group octave transposition, and a
nonzero silent-loop Fit at 667 px. Added deterministic checks for extent trimming,
subsequent capture, and active-note reconciliation without retriggering unchanged
voices. Desktop and narrow screenshots were visually inspected. No hardware MIDI
check was performed; the test suite exercises MIDI through mock ports.
