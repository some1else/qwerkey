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
  onPlayingChange,
  visible,
}: {
  controller: Controller | null;
  onPlayingChange: (playing: boolean) => void;
  visible: boolean;
}) {
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selection, setSelection] = useState<readonly (string | number)[]>([]);
  const [zoom, setZoom] = useState(100);
  const [timelineEnd, setTimelineEnd] = useState(5);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => onPlayingChange(playing), [playing, onPlayingChange]);
  const confirmation = useRef<HTMLDialogElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; time: number; moved: boolean } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const generation = useRef(0);
  const loop = useRef<ReturnType<typeof startLoop> | null>(null);
  const playbackNotes = useRef<RecordedNote[]>([]);
  const boundsRef = useRef<[number, number]>([0, 0.001]);
  const positionRef = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => { if (visible) setPosition(positionRef.current); }, [visible]);
  const rangeRef = useRef(range);
  rangeRef.current = range;
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
      if (store && (store.revision !== revision || (visibleRef.current && store.pendingIds().size))) {
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
  function updatePlayback(nextRange = rangeRef.current) {
    const end = Math.max(0.001, controller?.recording.extent() ?? 0);
    const bounds: [number, number] = nextRange ?? [0, end];
    const absolute = positionRef.current >= bounds[0] && positionRef.current < bounds[1]
      ? positionRef.current : bounds[0];
    boundsRef.current = bounds;
    positionRef.current = absolute;
    if (loop.current) loop.current.update(clipNotes(playbackNotes.current, ...bounds), bounds[1] - bounds[0], absolute - bounds[0]);
    setPosition(loop.current ? absolute : bounds[0]);
  }
  function applyEdits(next: RecordedNote[], created: string[] = []) {
    const before = new Map(notes.map(n => [n.id, n]));
    const after = new Map(next.map(n => [n.id, n]));
    playbackNotes.current = playbackNotes.current.filter(n => !before.has(n.id) || after.has(n.id)).map(n => {
      const edited = after.get(n.id);
      return edited && !controller?.recording.pendingIds().has(n.id) && JSON.stringify(edited) !== JSON.stringify(before.get(n.id)) ? edited : n;
    });
    for (const n of next) if (created.includes(n.id) && !controller?.recording.pendingIds().has(n.id)) playbackNotes.current.push(n);
    controller?.recording.replace(next);
    updatePlayback();
    refresh();
  }
  async function play() {
    if (!controller) return;
    const requestedPosition = positionRef.current;
    stop();
    const attempt = generation.current;
    await controller.enable();
    if (attempt !== generation.current || !controller.getSnapshot().enabled)
      return;
    const snapshot = controller.recording.snapshot();
    const bounds: [number, number] = rangeRef.current ?? [
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
    playbackNotes.current = snapshot;
    boundsRef.current = bounds;
    const initial = requestedPosition >= bounds[0] && requestedPosition < bounds[1] ? requestedPosition : bounds[0];
    const cancel = startLoop(clipped, length, {
      startPosition: initial - bounds[0],
      on: (n) =>
        controller.press(`playback:${n.id}`, { ...n, origin: "playback" }),
      off: (n) => controller.release(`playback:${n.id}`),
      position: (time) => {
        positionRef.current = boundsRef.current[0] + time;
        if (visibleRef.current) setPosition(positionRef.current);
      },
    });
    loop.current = cancel;
    stopRef.current = () => {
      cancel();
      loop.current = null;
      setPlaying(false);
      positionRef.current = boundsRef.current[0];
      setPosition(boundsRef.current[0]);
      stopRef.current = () => {};
    };
    setPlaying(true);
  }

  const selectedNotes = notes.filter(n => selection.includes(n.id));
  const downloadLabel = selectedNotes.length ? "Download selected notes" : range ? "Download loop range" : "Download entire buffer";
  function download() {
    const all = controller?.recording.snapshot() ?? [];
    const selected = all.filter(n => selection.includes(n.id));
    const bounds: [number, number] = selected.length
      ? [Math.min(...selected.map(n => n.start)), Math.max(...selected.map(n => n.start + n.duration))]
      : range ?? [0, Math.max(0.001, controller?.recording.extent() ?? 0, ...all.map(n => n.start + n.duration))];
    const bytes = midiFile(clipNotes(selected.length ? selected : all, ...bounds), bounds[1] - bounds[0]);
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selected.length ? "qwerkey-selection.mid" : range ? "qwerkey-range.mid" : "qwerkey-buffer.mid";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function seek(time: number) {
    rangeRef.current = null;
    setRange(null);
    positionRef.current = time;
    if (loop.current) updatePlayback(null);
    else setPosition(time);
  }
  useEffect(() => {
    const element = ruler.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || !body.current) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = body.current;
      const x = event.clientX - viewport.getBoundingClientRect().left;
      const time = (viewport.scrollLeft + x) / zoom;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      const next = Math.max(0.000001, Math.min(1000000, zoom * Math.exp(Math.max(-1, Math.min(1, delta * 0.002)))));
      setZoom(next);
      requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, time * next - x); });
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => element.removeEventListener("wheel", wheel, true);
  }, [zoom]);
  function changeRange(next: readonly [number, number]) {
    if (
      next.every(Number.isFinite) &&
      next[0] >= 0 &&
      next[1] >= next[0] + MIN_RANGE_LENGTH &&
      (!range || next[0] !== range[0] || next[1] !== range[1])
    ) {
      // Retain space exposed by an explicit range so drawing a shorter one
      // cannot shrink the lane and shift its scroll offset mid-gesture.
      setTimelineEnd(Math.max(duration, next[1]));
      setRange([next[0], next[1]]);
      updatePlayback([next[0], next[1]]);
    }
  }
  const actions = useRef({ play, stop, playing, notes });
  actions.current = { play, stop, playing, notes };
  useEffect(() => {
    let starting = false;
    const toggle = () => {
      if (actions.current.playing || starting) { actions.current.stop(); starting = false; }
      else if (actions.current.notes.length) {
        starting = true;
        void actions.current.play().finally(() => { starting = false; });
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.code !== "Space" || event.repeat || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!target?.closest("#instrument") || target.closest('input, textarea, select, [contenteditable], .piano_keys') || (target.closest("button") && !target.closest(".roll_note"))) return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };
    window.addEventListener("qwerkey:toggle-buffer", toggle);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("qwerkey:toggle-buffer", toggle);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  const pending = controller?.recording.pendingIds() ?? new Set<string>();
  return (
    <section
      className="recorded_buffer"
      aria-label="Recorded buffer"
      data-note-count={notes.length}
      onKeyDownCapture={event => {
        if (!["ArrowUp", "ArrowDown", "Backspace", "Delete"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        const target = event.target as Element;
        if (!target.closest(".roll_grid") || target.closest('input, textarea, select, [contenteditable]') || !selection.length) return;
        const selected = notes.filter(n => selection.includes(n.id) && !pending.has(n.id));
        if (!selected.length) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Backspace" || event.key === "Delete") {
          applyEdits((controller?.recording.snapshot() ?? []).filter(n => !selection.includes(n.id) || pending.has(n.id)));
          setSelection([]);
          return;
        }
        const requested = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 12 : 1);
        const delta = Math.max(-Math.min(...selected.map(n => n.pitch)), Math.min(127 - Math.max(...selected.map(n => n.pitch)), requested));
        applyEdits(notes.map(n => selected.some(item => item.id === n.id) ? { ...n, pitch: n.pitch + delta } : n));
      }}
    >
      <div className="buffer_toolbar">
        <button onClick={play} disabled={playing || !notes.length}>
          Play loop
        </button>
        <button onClick={stop} disabled={!playing}>
          Stop
        </button>
        <button onClick={() => confirmation.current?.showModal()}>Clear buffer</button>
        <button onClick={download} disabled={!notes.length && !range}>{downloadLabel}</button>
        <button onClick={() => {
          const end = controller?.recording.trim() ?? 0;
          const target = range ?? [0, Math.max(0.001, end)];
          const width = body.current?.clientWidth ?? 600;
          const nextZoom = Math.max(0.000001, (width - 24) / (target[1]! - target[0]!));
          setTimelineEnd(Math.max(end, range?.[1] ?? 0, 0.001));
          setZoom(nextZoom);
          updatePlayback();
          refresh();
          requestAnimationFrame(() => { if (body.current) body.current.scrollLeft = Math.max(0, target[0]! * nextZoom - 12); });
        }}>
          Fit
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
      <dialog ref={confirmation} aria-labelledby="clear-buffer-title" onClose={() => body.current?.focus()}>
        <p id="clear-buffer-title">Clear the recorded buffer? This cannot be undone.</p>
        <form method="dialog">
          <button autoFocus>Cancel</button>
          <button onClick={() => {
            stop();
            controller?.recording.clear();
            setSelection([]);
            setTimelineEnd(5);
            rangeRef.current = null;
            setRange(null);
            positionRef.current = 0;
            setPosition(0);
            playbackNotes.current = [];
            refresh();
          }}>Clear recording</button>
        </form>
      </dialog>
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
            if (!controller) return;
            const current = controller.recording.snapshot();
            applyEdits(
              applyRollEdits(
                current,
                notes,
                controller.recording.pendingIds(),
                value,
              ),
              value.filter(n => !notes.some(old => old.id === String(n.id))).map(n => String(n.id)),
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
              <Timeline.Lane className="roll_ruler" ref={ruler}
                onPointerDown={event => {
                  if (event.button !== 0 || (event.target as Element).closest(".roll_loop")) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  gesture.current = { id: event.pointerId, x: event.clientX, time: Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom), moved: false };
                }}
                onPointerMove={event => {
                  const drag = gesture.current;
                  if (!drag || drag.id !== event.pointerId) return;
                  if (Math.abs(event.clientX - drag.x) >= 4) drag.moved = true;
                  if (drag.moved) {
                    const time = Math.max(0, Math.min(duration, (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom));
                    const start = Math.min(drag.time, time);
                    changeRange([start, Math.max(start + MIN_RANGE_LENGTH, drag.time, time)]);
                  }
                }}
                onPointerUp={event => {
                  const drag = gesture.current;
                  gesture.current = null;
                  if (drag && drag.id === event.pointerId && !drag.moved) seek(drag.time);
                }}
                onPointerCancel={() => { gesture.current = null; }}
              >
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
                  getAriaValueText={describeSeconds}
                  data-explicit={range ? "true" : "false"}
                  minDrawnWidth={60}
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
                {effectiveRange.map((time, i) => (
                  <Timeline.Mark key={i} value={time} aria-hidden="true" className={`roll_boundary roll_boundary_${i ? "end" : "start"}`} />
                ))}
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
