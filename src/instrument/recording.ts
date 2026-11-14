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
  let cachedRevision = -1;
  let cached: RecordedNote[] = [];
  const pending = new Map<string, RecordedNote>();
  const indices = new Map<string, number>();
  const startedAt = new Map<string, number>();
  let capturePosition: ((timestamp: number) => number) | null = null;
  let loopCapture: { start: number; timestamp: number } | null = null;
  let loopCaptureArmed = true;
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
    // A transport supplies absolute buffer time; note lengths always use elapsed
    // wall time so wrapping/seeking/stopping cannot shorten a held recording.
    setCapturePosition(source: ((timestamp: number) => number) | null) {
      if (capturePosition && !source) {
        const end = this.extent();
        origin = notes.length ? clock() - end * 1000 : undefined;
        loopCaptureArmed = true;
      }
      if (source) {
        loopCapture = null;
        loopCaptureArmed = false;
      }
      capturePosition = source;
    },
    // A stopped performance includes silence up to the Play gesture. Keep its
    // clock separate from note durations and from later buffer trimming.
    capturedLoop(timestamp = clock()): [number, number] | null {
      if (!loopCapture) return null;
      return [loopCapture.start, loopCapture.start + Math.max(0.001, (timestamp - loopCapture.timestamp) / 1000)];
    },
    finishLoopCapture(timestamp = clock()) {
      const bounds = this.capturedLoop(timestamp);
      if (bounds) {
        extent = Math.max(extent, bounds[1]);
        this.cancelLoopCapture();
        revision++;
      }
      return bounds;
    },
    cancelLoopCapture() {
      if (loopCapture) loopCaptureArmed = false;
      loopCapture = null;
    },
    get count() { return notes.length; },
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
        start: capturePosition ? Math.max(0, capturePosition(timestamp)) : now(timestamp),
        duration: 0,
        source,
      };
      if (!capturePosition && loopCaptureArmed && !loopCapture)
        loopCapture = { start: note.start, timestamp };
      indices.set(note.id, notes.length);
      notes.push(note);
      pending.set(key, note);
      startedAt.set(note.id, timestamp);
      revision++;
    },
    end(key: string, velocity = 64, timestamp = clock()) {
      const note = pending.get(key);
      if (!note) return;
      const completed = { ...note, duration: Math.max(0.001, (timestamp - startedAt.get(note.id)!) / 1000), releaseVelocity: velocity };
      notes[indices.get(note.id)!] = completed;
      extent = Math.max(extent, completed.start + completed.duration);
      pending.delete(key);
      startedAt.delete(note.id);
      revision++;
    },
    finish() {
      for (const key of pending.keys()) this.end(key);
    },
    snapshot() {
      if (!pending.size && cachedRevision === revision) return cached;
      const held = new Set(pending.values()), time = clock();
      cached = notes.map(note => held.has(note) ? {
        ...note, duration: Math.max(0.001, (time - startedAt.get(note.id)!) / 1000),
      } : note);
      cachedRevision = revision;
      return cached;
    },
    extent() {
      let end = extent;
      const time = clock();
      for (const note of pending.values())
        end = Math.max(end, note.start + Math.max(0.001, (time - startedAt.get(note.id)!) / 1000));
      return end;
    },
    pendingIds: () => new Set([...pending.values()].map((note) => note.id)),
    replace(next: RecordedNote[]) {
      const held = new Map(
        [...pending.values()].map((note) => [note.id, note]),
      );
      notes = next.filter(valid).map((note) => held.get(note.id) ?? note);
      indices.clear();
      notes.forEach((note, index) => indices.set(note.id, index));
      for (const note of notes)
        extent = Math.max(extent, note.start + note.duration);
      revision++;
    },
    trim() {
      extent = this.snapshot().reduce((end, n) => Math.max(end, n.start + n.duration), 0);
      if (!pending.size) origin = notes.length ? clock() - extent * 1000 : undefined;
      revision++;
      return extent;
    },
    clear() {
      notes = [];
      indices.clear();
      origin = undefined;
      extent = 0;
      loopCapture = null;
      loopCaptureArmed = !capturePosition;
      const held = [...pending.entries()];
      pending.clear();
      startedAt.clear();
      for (const [key, note] of held)
        this.start(key, note.pitch, note.channel, note.velocity, note.source);
      revision++;
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
