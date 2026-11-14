import type { RecordedNote } from "./recording";
export function midiFile(notes: readonly RecordedNote[], duration: number) {
  const events: { time: number; bytes: number[]; off: boolean }[] = [];
  // Union overlapping ownership of a channel/pitch before serializing.
  const groups = new Map<string, RecordedNote[]>();
  for (const n of notes) {
    const key = `${n.channel}:${n.pitch}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...n }]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start);
    const merged: RecordedNote[] = [];
    for (const n of group) {
      const last = merged.at(-1);
      if (last && n.start < last.start + last.duration)
        last.duration = Math.max(
          last.duration,
          n.start + n.duration - last.start,
        );
      else merged.push(n);
    }
    for (const n of merged) {
      const start = Math.round(n.start * 1000);
      events.push(
        {
          time: start,
          bytes: [0x90 + n.channel, n.pitch, n.velocity],
          off: false,
        },
        {
          time: Math.max(start + 1, Math.round((n.start + n.duration) * 1000)),
          bytes: [0x80 + n.channel, n.pitch, n.releaseVelocity],
          off: true,
        },
      );
    }
  }
  events.sort((a, b) => a.time - b.time || Number(b.off) - Number(a.off));
  const vlq = (n: number) => {
    const out = [n & 127];
    while ((n = Math.floor(n / 128)) > 0) out.unshift((n & 127) | 128);
    return out;
  };
  const track = [0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40]; // 60 BPM
  let previous = 0;
  for (const e of events) {
    track.push(...vlq(e.time - previous), ...e.bytes);
    previous = e.time;
  }
  track.push(
    ...vlq(Math.max(0, Math.round(duration * 1000) - previous)),
    0xff,
    0x2f,
    0,
  );
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    3,
    232,
    77,
    84,
    114,
    107,
    (track.length >>> 24) & 255,
    (track.length >>> 16) & 255,
    (track.length >>> 8) & 255,
    track.length & 255,
    ...track,
  ]);
}
