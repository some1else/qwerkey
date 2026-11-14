import type { RecordedNote } from "./recording";

/** A deadline-based event transport. Every edge is dispatched, even when a timer is late. */
export function startLoop(
  notes: readonly RecordedNote[],
  length: number,
  output: {
    on(note: RecordedNote): void;
    off(note: RecordedNote): void;
    position(time: number): void;
  },
  clock = () => performance.now() / 1000,
) {
  const edges = notes
    .flatMap((note) => [
      { time: note.start, on: true, note },
      { time: note.start + note.duration, on: false, note },
    ])
    .sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
  const held = new Map<string, RecordedNote>();
  let cancelled = false,
    cycle = 0,
    index = 0;
  const epoch = clock();
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
  return () => {
    cancelled = true;
    clearTimeout(timer);
    release();
  };
}
