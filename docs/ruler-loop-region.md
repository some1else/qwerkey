# Piano roll ruler loop-region plan

Status: implemented. See the implementation record below.

## Goal

Make the Recorded buffer's seconds ruler a clear, reliable surface for drawing,
moving, and resizing the loop region. Keep the ruler, exact seconds inputs,
playback, and selected-range MIDI download connected to one range value.

## Current implementation

- `src/components/instrument/RecordedBuffer.tsx` already owns
  `range: [number, number] | null`, exact start/end inputs, and Clear range.
  `null` means playback uses the whole buffer; the ruler displays `[0, extent]`.
- The ruler already contains a controlled `Timeline.Range` with `drawable`,
  a 1 ms minimum length, and start/end handles. `changeRange` stops playback
  before accepting a valid range. Playback and export already share `clipNotes`.
- The pinned `@audio-ui/react` 0.13.0 implementation gives `Timeline.Ruler` its
  own seek/scrub pointer handler. `Range` drawing separately listens on its
  parent lane and requires the pointer target to be that lane itself. Combining
  them creates competing gestures; ruler marks can also prevent drawing when
  they become the pointer target.
- `RangeHandle` supplies interaction and a native keyboard input, but no visual
  positioning or dimensions. The current stylesheet has no loop-handle rules
  and uses a broad `.roll_ruler > div` background selector.
- `tests/recording.spec.js` covers numeric range edits, clipped export, playback,
  and sticky ruler placement. It does not exercise ruler drawing, range movement,
  or handle resizing.

These findings come from the repository and installed package source; reproducing
the pointer behavior in the browser is the first implementation check.

## Interaction contract

| Action | Result |
| --- | --- |
| Drag empty ruler space, in either direction | Create or replace the explicit loop range. |
| Drag the highlighted range body | Move both boundaries while preserving its duration. |
| Drag the start or end handle | Resize only that boundary; prevent crossing and preserve a 1 ms minimum. |
| Edit either seconds input | Update the same region immediately when valid. |
| Focus the range or a handle and use arrow keys | Move the range or boundary in 10 ms steps, using the existing primitive's keyboard behavior. |
| Clear range | Restore the implicit whole-buffer loop and disable selected-range download. |

Clamp pointer gestures to the displayed timeline, including empty time after the
last note. Moving against either edge preserves range length. Keep timing free of
musical snapping. Range selection remains independent of selected notes.

Any accepted range change stops playback and places the stopped playhead at the
new start. A later Play uses a fresh snapshot and the updated bounds. Clearing the
range stops playback and returns the playhead to zero. Drawing or dragging must
not change notes, note selection, or recorded data.

## Implementation steps

1. **Give ruler gestures one owner.** In `RecordedBuffer.tsx`, use a non-seekable
   `Timeline.Lane` as the seconds-ruler surface, retaining `.roll_ruler`, its
   marks, sticky placement, and the controlled drawable `Timeline.Range`.
   This preserves plain-drag selection without a competing scrub controller or
   a custom pointer-to-time implementation. Make decorative marks ignore pointer
   events so their labels and ticks also act as empty ruler space. Seeking is
   outside this change's scope.

2. **Make the region and boundaries visible.** Add explicit classes for the
   range body and each handle. Give the range a visible height, translucent fill,
   border, and move cursor; absolutely position its start/end handles with clear
   edge markers and resize cursors. Replace broad child selectors with these
   classes. Supply hover, dragging, and `:focus-within` states. Use
   `minDrawnWidth` to keep handles usable for short ranges at low zoom, and verify
   that dragging the end still maps correctly to the stored duration. Ensure
   handles remain independently targetable and do not cover the entire move
   area. Keep touch targets usable within the ruler, increasing the shared ruler
   height and keyboard-header offset together if needed.

3. **Unify bounds and state updates.** Keep the existing nullable range state;
   derive one effective range for the ruler and numeric inputs. Share minimum
   length and keyboard-step constants. Reject nonfinite, negative, reversed, and
   sub-minimum numeric values. Ignore unchanged callbacks and stop transport
   before applying a changed range. Set the stopped playhead to the accepted
   start. Include an explicit range's end in the displayed timeline duration so
   typing a loop into silence beyond the recording does not leave the controls
   and primitive bounds inconsistent. New recording may extend the implicit
   whole-buffer range but must not move an explicit range.

4. **Preserve accessible operation.** Retain the primitive's native inputs and
   accessible names for Loop range, Loop start, and Loop end. Announce values in
   seconds through `getAriaValueText`, show focus on the visible region/handle,
   and keep exact numeric controls as an alternative to dragging. Update the
   hint to explain empty-space drawing, body movement, and edge resizing. Verify
   keyboard input stays inside the editor using the existing `.recorded_buffer`
   focus exclusion in `useInstrument.ts`.

5. **Document the final behavior.** Update the recording/playback paragraph in
   `README.md` and add a brief implementation record here after validation.
   Retain current dependencies, transport scheduling, and MIDI clipping logic.

## Verification and acceptance

Add focused Playwright coverage in `tests/recording.spec.js`, using known ranges
and bounding boxes rather than performance timing to determine drag coordinates:

- Draw forward and backward on empty ruler space, including directly over a
  tick label; assert both numeric inputs and the visible region agree.
- Move the body and resize each handle; assert preserved length for movement,
  the untouched boundary for resizing, timeline clamping, and the 1 ms minimum.
- Repeat representative gestures after horizontal scrolling and zooming, and
  after vertical scrolling with the ruler stuck to the viewport top.
- Exercise a very short region at low zoom, keyboard movement/resizing, and a
  touch drag. Check that handles and the move area remain usable.
- Verify exact input changes update the ruler, a range beyond note extent stays
  reachable, incoming recording leaves explicit bounds unchanged, and Clear
  range restores whole-buffer behavior.
- Change the range during playback; verify playback stops, its owned notes are
  released, and the playhead returns to the new start. Verify a subsequent Play
  uses the new bounds and a selected MIDI download has the expected clipped,
  rebased events and duration, including a range containing only silence.
- Assert ruler gestures and keyboard range edits preserve note count, note
  selection, and note metadata, and do not trigger live keyboard notes.

Run the production build/typecheck and focused recording suite, then the existing
Playwright suite. Visually inspect desktop and the supported 667 px minimum
width for sticky positioning, label readability, handle visibility, focus, and
contained scrolling. Record implementation validation below.

Done means all three pointer operations work on the ruler with mouse and touch,
keyboard and numeric alternatives control the same bounds, and playback/export
consistently use the region shown.


## Implementation record

Replaced the seekable ruler primitive with a non-seekable Timeline lane so drawing
and range manipulation share one gesture controller. Decorative marks pass pointer
events through to the lane. Added a 44 px ruler, explicit loop styling, 24 px edge
hit areas, focus states, and a minimum drawn width that leaves room to move even a
1 ms range. Numeric edits and ruler gestures share validation and stopped-playhead
updates; explicit range ends extend the visible timeline into silence. That space
is retained until Clear buffer so a shorter range cannot shift horizontal scroll
mid-gesture. Removed the old mobile rule hiding mode tabs at 667 px, keeping the
Recorded buffer reachable at the supported minimum width.

Added browser coverage for drawing in both directions and over tick labels,
moving, resizing both edges, keyboard steps, stopping playback on range edits,
clearing, extending into silence, short-range handle separation, and touch drawing
after horizontal and vertical scrolling. The touch test also checks silent-range
MIDI export. Updated the README with these interactions.

Validation: production build/typecheck passed (only the existing `keyCode`
deprecation hints). The final production-build regression run passed 67 tests;
four responsive-tab assertions still expected the previous hidden mobile tabs.
After updating those assertions, all four passed in a focused rerun, verifying
all 71 cases across the two runs. Desktop and 667 px screenshots were visually
inspected. No hardware MIDI check was performed.
