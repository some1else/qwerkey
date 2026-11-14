export interface RecordedNote {
  id: string;
  pitch: number;
  channel: number;
  velocity: number;
  releaseVelocity: number;
  start: number;
  duration: number;
  source: "local" | "midi";
}

export function createRecording(clock = () => performance.now()) {
  let origin: number | undefined;
  let serial = 0,
    revision = 0,
    extent = 0;
  let notes: RecordedNote[] = [];
  const pending = new Map<string, RecordedNote>();
  const now = (timestamp = clock()) =>
    origin === undefined ? 0 : Math.max(0, (timestamp - origin) / 1000);
  const valid = (n: RecordedNote) =>
    [
      n.start,
      n.duration,
      n.pitch,
      n.channel,
      n.velocity,
      n.releaseVelocity,
    ].every(Number.isFinite) &&
    n.start >= 0 &&
    n.duration > 0 &&
    Number.isInteger(n.pitch) &&
    n.pitch >= 0 &&
    n.pitch <= 127 &&
    Number.isInteger(n.channel) &&
    n.channel >= 0 &&
    n.channel < 16 &&
    n.velocity >= 1 &&
    n.velocity <= 127;
  return {
    get revision() {
      return revision;
    },
    start(
      key: string,
      pitch: number,
      channel = 0,
      velocity = 64,
      source: RecordedNote["source"] = "local",
      timestamp = clock(),
    ) {
      if (pending.has(key)) this.end(key, 64, timestamp);
      origin ??= timestamp;
      const note = {
        id: `recorded-${++serial}`,
        pitch,
        channel,
        velocity,
        releaseVelocity: 64,
        start: now(timestamp),
        duration: 0,
        source,
      };
      notes.push(note);
      pending.set(key, note);
      revision++;
    },
    end(key: string, velocity = 64, timestamp = clock()) {
      const note = pending.get(key);
      if (!note) return;
      note.duration = Math.max(0.001, now(timestamp) - note.start);
      note.releaseVelocity = velocity;
      extent = Math.max(extent, note.start + note.duration);
      pending.delete(key);
      revision++;
    },
    finish() {
      for (const key of pending.keys()) this.end(key);
    },
    snapshot() {
      const held = new Set(pending.values()),
        time = now();
      return notes.map((note) => ({
        ...note,
        duration: held.has(note)
          ? Math.max(0.001, time - note.start)
          : note.duration,
      }));
    },
    extent() {
      return Math.max(extent, pending.size ? now() : 0);
    },
    pendingIds: () => new Set([...pending.values()].map((note) => note.id)),
    replace(next: RecordedNote[]) {
      const held = new Map(
        [...pending.values()].map((note) => [note.id, note]),
      );
      notes = next.filter(valid).map((note) => held.get(note.id) ?? note);
      for (const note of notes)
        extent = Math.max(extent, note.start + note.duration);
      revision++;
    },
    trim() {
      extent = Math.max(0, ...this.snapshot().map(n => n.start + n.duration));
      if (!pending.size) origin = notes.length ? clock() - extent * 1000 : undefined;
      revision++;
      return extent;
    },
    clear() {
      notes = [];
      origin = undefined;
      extent = 0;
      const held = [...pending.entries()];
      pending.clear();
      for (const [key, note] of held)
        this.start(key, note.pitch, note.channel, note.velocity, note.source);
      revision++;
    },
    restore(previous: RecordedNote[]) {
      const offset = Math.max(0, ...previous.map((n) => n.start + n.duration));
      for (const note of notes) note.start += offset;
      if (origin !== undefined) origin -= offset * 1000;
      else origin = clock() - offset * 1000;
      extent += offset;
      this.replace([...previous, ...notes]);
    },
  };
}

export function clipNotes(
  notes: readonly RecordedNote[],
  start: number,
  end: number,
) {
  return notes
    .filter((n) => n.start < end && n.start + n.duration > start)
    .map((n) => ({
      ...n,
      start: Math.max(start, n.start) - start,
      duration: Math.min(end, n.start + n.duration) - Math.max(start, n.start),
    }));
}

/** Merge editor changes by identity, retaining events received since the last displayed snapshot. */
export function applyRollEdits(
  current: RecordedNote[],
  displayed: RecordedNote[],
  pending: ReadonlySet<string>,
  edits: readonly {
    id: string | number;
    pitch: number;
    start: number;
    length: number;
    velocity?: number;
  }[],
): RecordedNote[] {
  const byId = new Map(current.map((note) => [note.id, note]));
  const shown = new Set(displayed.map((note) => note.id));
  return [
    ...edits
      .filter((note) => !pending.has(String(note.id)))
      .map((note) => ({
        ...byId.get(String(note.id)),
        id: String(note.id),
        pitch: note.pitch,
        start: note.start,
        duration: note.length,
        velocity: Math.max(
          1,
          Math.min(127, Math.round((note.velocity ?? 64 / 127) * 127)),
        ),
        channel: byId.get(String(note.id))?.channel ?? 0,
        releaseVelocity: byId.get(String(note.id))?.releaseVelocity ?? 64,
        source: byId.get(String(note.id))?.source ?? ("local" as const),
      })),
    ...current.filter((note) => pending.has(note.id) || !shown.has(note.id)),
  ];
}
