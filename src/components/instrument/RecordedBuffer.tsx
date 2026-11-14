import { useEffect, useRef, useState } from "react";
import { PianoRoll } from "@audio-ui/react/piano-roll";
import { Timeline } from "@audio-ui/react/timeline";
import type { Controller } from "../../instrument/controller";
import {
  clipNotes,
  applyRollEdits,
  type RecordedNote,
} from "../../instrument/recording";
import { startLoop } from "../../instrument/transport";
import { midiFile } from "../../instrument/midi-file";

const MIN_RANGE_LENGTH = 0.001;
const KEYBOARD_STEP = 0.01;
const describeSeconds = (value: number) => `${Number(value.toFixed(3))} seconds`;

export default function RecordedBuffer({
  controller,
}: {
  controller: Controller | null;
}) {
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selection, setSelection] = useState<readonly (string | number)[]>([]);
  const [zoom, setZoom] = useState(100);
  const [timelineEnd, setTimelineEnd] = useState(5);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [undo, setUndo] = useState<RecordedNote[] | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const generation = useRef(0);
  const stopRef = useRef<() => void>(() => {});
  const extent = Math.max(
    0.001,
    controller?.recording.extent() ?? 0,
    ...notes.map((n) => n.start + n.duration),
  );
  const effectiveRange: [number, number] = range ?? [0, extent];
  const duration = Math.max(timelineEnd, extent + 1, range?.[1] ?? 0);
  function refresh() {
    setNotes(controller?.recording.snapshot() ?? []);
  }
  useEffect(() => {
    refresh();
    setZoom(
      Math.max(0.1, 600 / Math.max(5, controller?.recording.extent() ?? 0)),
    );
    let revision = -1;
    const timer = setInterval(() => {
      const store = controller?.recording;
      if (store && (store.revision !== revision || store.pendingIds().size)) {
        revision = store.revision;
        refresh();
      }
    }, 50);
    const stop = () => {
      generation.current++;
      stopRef.current();
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      stop();
      controller?.releasePreview();
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [controller]);
  useEffect(() => {
    if (!centered.current && notes.length && body.current) {
      body.current.scrollTop = Math.max(
        0,
        (Math.max(96, ...notes.map((n) => n.pitch)) - notes[0]!.pitch) * 18 -
          180,
      );
      centered.current = true;
    }
  }, [notes]);
  function stop() {
    generation.current++;
    stopRef.current();
  }
  async function play() {
    if (!controller) return;
    stop();
    const attempt = generation.current;
    await controller.enable();
    if (attempt !== generation.current || !controller.getSnapshot().enabled)
      return;
    const snapshot = controller.recording.snapshot();
    const bounds = range ?? [
      0,
      Math.max(
        0.001,
        controller.recording.extent(),
        ...snapshot.map((n) => n.start + n.duration),
      ),
    ];
    const clipped = clipNotes(snapshot, bounds[0], bounds[1]);
    const length = bounds[1] - bounds[0];
    if (length <= 0) return;
    const cancel = startLoop(clipped, length, {
      on: (n) =>
        controller.press(`playback:${n.id}`, { ...n, origin: "playback" }),
      off: (n) => controller.release(`playback:${n.id}`),
      position: (time) => setPosition(bounds[0] + time),
    });
    stopRef.current = () => {
      cancel();
      setPlaying(false);
      setPosition(bounds[0]);
      stopRef.current = () => {};
    };
    setPlaying(true);
  }

  function download(selected: boolean) {
    const all = controller?.recording.snapshot() ?? [];
    const bounds: [number, number] =
      selected && range
        ? range
        : [
            0,
            Math.max(
              0.001,
              controller?.recording.extent() ?? 0,
              ...all.map((n) => n.start + n.duration),
            ),
          ];
    const bytes = midiFile(
      clipNotes(all, bounds[0], bounds[1]),
      bounds[1] - bounds[0],
    );
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selected ? "qwerkey-range.mid" : "qwerkey-buffer.mid";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function changeRange(next: readonly [number, number]) {
    if (
      next.every(Number.isFinite) &&
      next[0] >= 0 &&
      next[1] >= next[0] + MIN_RANGE_LENGTH &&
      (!range || next[0] !== range[0] || next[1] !== range[1])
    ) {
      stop();
      // Retain space exposed by an explicit range so drawing a shorter one
      // cannot shrink the lane and shift its scroll offset mid-gesture.
      setTimelineEnd(Math.max(duration, next[1]));
      setRange([next[0], next[1]]);
      setPosition(next[0]);
    }
  }
  const pending = controller?.recording.pendingIds() ?? new Set<string>();
  return (
    <section
      className="recorded_buffer"
      aria-label="Recorded buffer"
      data-note-count={notes.length}
    >
      <div className="buffer_toolbar">
        <button onClick={play} disabled={playing || !notes.length}>
          Play loop
        </button>
        <button onClick={stop} disabled={!playing}>
          Stop
        </button>
        <button
          onClick={() => {
            stop();
            setUndo(controller?.recording.snapshot() ?? []);
            controller?.recording.clear();
            setSelection([]);
            setTimelineEnd(5);
            setRange(null);
            setPosition(0);
            refresh();
          }}
        >
          Clear buffer
        </button>
        <button
          disabled={!undo}
          onClick={() => {
            if (undo) {
              stop();
              controller?.recording.restore(undo);
              setUndo(null);
              refresh();
            }
          }}
        >
          Undo clear
        </button>
        <button onClick={() => download(false)} disabled={!notes.length}>
          Download entire buffer
        </button>
        <button disabled={!range} onClick={() => download(true)}>
          Download selected range
        </button>
        <button onClick={() => setZoom((z) => Math.min(1000, z * 1.5))}>
          Zoom in
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.1, z / 1.5))}>
          Zoom out
        </button>
        <button onClick={() => setZoom(Math.max(0.1, 600 / duration))}>
          Fit
        </button>
        <button
          disabled={!selection.length}
          onClick={() => {
            stop();
            controller?.recording.replace(
              (controller.recording.snapshot() ?? []).filter(
                (n) => !selection.includes(n.id) || pending.has(n.id),
              ),
            );
            setSelection([]);
            refresh();
          }}
        >
          Delete selected notes
        </button>
      </div>
      <div className="buffer_toolbar">
        {(["start", "end"] as const).map((edge, i) => (
          <label key={edge}>
            Loop {edge} (seconds){" "}
            <input
              type="number"
              min="0"
              step={KEYBOARD_STEP}
              value={Number(effectiveRange[i]!.toFixed(3))}
              onChange={(e) => {
                const next: [number, number] = [...effectiveRange];
                next[i] = Number(e.target.value);
                changeRange(next);
              }}
            />
          </label>
        ))}
        <button
          onClick={() => {
            stop();
            setRange(null);
            setPosition(0);
          }}
        >
          Clear range
        </button>
        <span>
          {notes.length} notes · {extent.toFixed(2)} s
        </span>
      </div>
      {!notes.length && (
        <p>
          Play the keyboard or send MIDI to begin recording. Drag across the
          seconds ruler to select a loop.
        </p>
      )}
      <p id="loop-ruler-help">
        Drag empty ruler space to draw a loop, its body to move it, or its edges
        to resize. Use arrow keys on the focused loop or edge for 0.01 s steps.
      </p>
      <Timeline.Root
        duration={duration}
        snapStep={0}
        step={KEYBOARD_STEP}
        zoom={zoom}
        onZoomChange={setZoom}
        position={position}
      >
        <PianoRoll.Root
          minPitch={Math.min(41, ...notes.map((n) => n.pitch))}
          maxPitch={Math.max(96, ...notes.map((n) => n.pitch))}
          minLength={0.001}
          mode="select"
          selection={selection}
          onSelectionChange={setSelection}
          value={notes.map((n) => ({
            id: n.id,
            pitch: n.pitch,
            start: n.start,
            length: n.duration,
            velocity: n.velocity / 127,
          }))}
          onValueChange={(value) => {
            stop();
            if (!controller) return;
            const current = controller.recording.snapshot();
            controller.recording.replace(
              applyRollEdits(
                current,
                notes,
                controller.recording.pendingIds(),
                value,
              ),
            );
            refresh();
          }}
          onNoteOn={(pitch) =>
            controller?.press(`preview:${pitch}`, { pitch, origin: "preview" })
          }
          onNoteOff={(pitch) => controller?.release(`preview:${pitch}`)}
        >
          <div className="roll_body">
            <div className="roll_key_clip">
              <PianoRoll.Keys className="roll_keys" ref={keys}>
                <PianoRoll.Rows>
                  {(pitch) => (
                    <PianoRoll.Key pitch={pitch}>
                      <PianoRoll.KeyLabel />
                    </PianoRoll.Key>
                  )}
                </PianoRoll.Rows>
              </PianoRoll.Keys>
            </div>
            <Timeline.Viewport
              className="roll_viewport"
              ref={body}
              onScroll={(event) => {
                if (keys.current)
                  keys.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
              }}
            >
              <Timeline.Lane className="roll_ruler">
                {Array.from(
                  {
                    length: Math.min(
                      200,
                      Math.ceil(duration / Math.max(1, Math.ceil(60 / zoom))),
                    ),
                  },
                  (_, i) => i * Math.max(1, Math.ceil(60 / zoom)),
                ).map((time) => (
                  <Timeline.Mark className="roll_tick" key={time} value={time}>
                    {time} s
                  </Timeline.Mark>
                ))}
                <Timeline.Range
                  className="roll_loop"
                  aria-label="Loop range"
                  aria-describedby="loop-ruler-help"
                  getAriaValueText={describeSeconds}
                  data-explicit={range ? "true" : "false"}
                  minDrawnWidth={60}
                  drawable
                  minLength={MIN_RANGE_LENGTH}
                  value={effectiveRange}
                  onValueChange={changeRange}
                >
                  <Timeline.RangeHandle
                    className="roll_loop_handle roll_loop_start"
                    edge="start"
                    aria-label="Loop start"
                  />
                  <Timeline.RangeHandle
                    className="roll_loop_handle roll_loop_end"
                    edge="end"
                    aria-label="Loop end"
                  />
                </Timeline.Range>
              </Timeline.Lane>
              <PianoRoll.Grid className="roll_grid" aria-label="Recorded notes">
                <PianoRoll.Rows>
                  {(pitch) => (
                    <PianoRoll.Row className="roll_row" pitch={pitch} />
                  )}
                </PianoRoll.Rows>
                <PianoRoll.Notes>
                  {(note) => (
                    <PianoRoll.Note
                      className="roll_note"
                      key={note.id}
                      note={note}
                    >
                      <PianoRoll.NoteHandle edge="start" />
                      <PianoRoll.NoteHandle edge="end" />
                    </PianoRoll.Note>
                  )}
                </PianoRoll.Notes>
                <PianoRoll.Marquee className="roll_marquee" />
                <Timeline.Playhead className="roll_playhead" />
              </PianoRoll.Grid>
              <PianoRoll.VelocityLane
                className="roll_velocity"
                aria-label="Note velocities"
              >
                <PianoRoll.Notes>
                  {(note) => <PianoRoll.Velocity key={note.id} note={note} />}
                </PianoRoll.Notes>
              </PianoRoll.VelocityLane>
            </Timeline.Viewport>
          </div>
        </PianoRoll.Root>
      </Timeline.Root>
    </section>
  );
}
