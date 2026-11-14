import type { RecordedNote } from "./recording";

/** A deadline-based event transport. Every edge is dispatched, even when a timer is late. */
export function startLoop(
  notes: readonly RecordedNote[],
  length: number,
  output: {
    on(note: RecordedNote): void;
    off(note: RecordedNote): void;
    position(time: number): void;
    startPosition?: number;
  },
  clock = () => performance.now() / 1000,
) {
  let edges = notes
    .flatMap((note) => [
      { time: note.start, on: true, note },
      { time: note.start + note.duration, on: false, note },
    ])
    .sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
  const held = new Map<string, RecordedNote>();
  let cancelled = false,
    cycle = 0,
    index = 0;
  const initialPosition = Math.max(0, Math.min(output.startPosition ?? 0, length - 0.000001));
  let epoch = clock() - initialPosition;
  index = edges.findIndex(edge => edge.time > initialPosition);
  if (index < 0) index = edges.length;
  for (const note of notes) {
    if (note.start <= initialPosition && note.start + note.duration > initialPosition) {
      held.set(note.id, note);
      output.on(note);
    }
  }
  let timer: ReturnType<typeof setTimeout>;
  const release = () => {
    held.forEach(output.off);
    held.clear();
  };
  function pump() {
    if (cancelled) return;
    const elapsed = Math.max(0, clock() - epoch);
    // On a heavily delayed main thread, resume the current cycle rather than replaying a backlog.
    const currentCycle = Math.floor(elapsed / length);
    if (currentCycle > cycle) {
      release();
      cycle = currentCycle;
      index = 0;
    }
    const time = elapsed - cycle * length;
    while (index < edges.length && edges[index]!.time <= time) {
      const edge = edges[index++]!;
      if (edge.on) {
        held.set(edge.note.id, edge.note);
        output.on(edge.note);
      } else {
        held.delete(edge.note.id);
        output.off(edge.note);
      }
    }
    output.position(time);
    const deadline = cycle * length + (edges[index]?.time ?? length);
    timer = setTimeout(
      pump,
      Math.min(16, Math.max(1, (deadline - elapsed) * 1000)),
    );
  }
  pump();
  const cancel = () => {
    cancelled = true;
    clearTimeout(timer);
    release();
  };
  return Object.assign(cancel, {
    position(at = clock()) {
      const elapsed = Math.max(0, at - epoch);
      return elapsed % length;
    },
    update(next: readonly RecordedNote[], nextLength: number, position: number) {
      if (cancelled) return;
      clearTimeout(timer);
      length = Math.max(0.001, nextLength);
      const time = Math.max(0, Math.min(position, length - 0.000001));
      const active = new Map(next.filter(n => n.start <= time && n.start + n.duration > time).map(n => [n.id, n]));
      for (const [id, previous] of held) {
        const note = active.get(id);
        if (!note || note.pitch !== previous.pitch || note.channel !== previous.channel) {
          output.off(previous);
          held.delete(id);
        }
      }
      for (const [id, note] of active) if (!held.has(id)) {
        held.set(id, note);
        output.on(note);
      }
      edges = next.flatMap(note => [
        { time: note.start, on: true, note },
        { time: note.start + note.duration, on: false, note },
      ]).sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
      index = edges.findIndex(edge => edge.time > time);
      if (index < 0) index = edges.length;
      cycle = 0;
      epoch = clock() - time;
      pump();
    },
  });
}
