import { createRecording } from "./recording";
import { createSynth, defaultParameters, type SynthParameters } from "../audio";
import { mappings, type KeyMapping } from "../layout";
import { createMidi, type MidiPorts } from "../midi";

import { validParameters } from "./parameters";

export type Mode = "audio" | "midi";
export interface HeldNote {
  pitch: number;
  channel?: number;
  velocity?: number;
  releaseVelocity?: number;
  origin?: "playback" | "preview";
  mapping?: KeyMapping;
}
export interface Snapshot {
  interaction: number;
  parameters: Readonly<SynthParameters>;
  mode: Mode;
  enabled: boolean;
  busy: boolean;
  error: boolean;
  active: ReadonlySet<number>;
  keys: ReadonlySet<number>;
  inactive: ReadonlySet<number>;
  ports: MidiPorts;
}
export const initialSnapshot: Snapshot = {
  interaction: 0,
  parameters: { ...defaultParameters },
  mode: "audio",
  enabled: false,
  busy: false,
  error: false,
  active: new Set(),
  keys: new Set(),
  inactive: new Set(),
  ports: { inputs: [], outputs: [], inputId: "", outputId: "" },
};
export function createController() {
  let state = { ...initialSnapshot };
  let disposed = false;
  const listeners = new Set<(state: Snapshot) => void>();
  const held = new Map<string, HeldNote>();
  const incoming = new Set<number>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const synth = createSynth();
  const recording = createRecording();
  let connection: Promise<void> | undefined;
  function publish(next: Partial<Snapshot> = {}) {
    if (disposed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  }
  function refresh() {
    const active = new Set([...incoming].map((key) => key % 128));
    const keys = new Set<number>();
    const inactive = new Set(state.inactive);
    for (const note of held.values()) {
      active.add(note.pitch);
      if (note.mapping) keys.add(note.mapping.code);
    }
    for (const inputKey of incoming) {
      const pitch = inputKey % 128;
      const key = mappings.find((key) => key.noteNumber === pitch);
      if (key) keys.add(key.code);
    }
    for (const key of mappings) {
      if (state.keys.has(key.code) === keys.has(key.code)) continue;
      clearTimeout(timers.get(key.code));
      timers.delete(key.code);
      if (keys.has(key.code)) inactive.delete(key.code);
      else {
        inactive.add(key.code);
        timers.set(
          key.code,
          setTimeout(() => {
            timers.delete(key.code);
            const next = new Set(state.inactive);
            next.delete(key.code);
            publish({ inactive: next });
          }, 3000),
        );
      }
    }
    publish({ active, keys, inactive });
  }
  const midi = createMidi(
    (
      pitch,
      active,
      channel = 0,
      velocity = 64,
      timestamp = performance.now(),
    ) => {
      if (state.mode !== "midi" || disposed) return;
      const key = channel * 128 + pitch;
      if (active) {
        incoming.add(key);
        recording.start(
          `midi:${key}`,
          pitch,
          channel,
          velocity,
          "midi",
          timestamp,
        );
      } else {
        incoming.delete(key);
        recording.end(`midi:${key}`, velocity, timestamp);
      }
      refresh();
    },
    (ports) => publish({ ports }),
  );
  function send(pitch: number, active: boolean, channel = 0, velocity = 64) {
    if (state.mode === "midi") midi.sendNote(pitch, active, channel, velocity);
    else if (active)
      synth.play(pitch, 440 * 2 ** ((pitch - 69) / 12), velocity);
    else synth.release(pitch);
  }
  const sameOutput = (a: HeldNote, b: HeldNote) =>
    a.pitch === b.pitch &&
    (state.mode === "audio" || (a.channel ?? 0) === (b.channel ?? 0));
  function releaseAll() {
    for (const note of held.values())
      send(note.pitch, false, note.channel, note.releaseVelocity);
    held.clear();
    incoming.clear();
    recording.finish();
    timers.forEach(clearTimeout);
    timers.clear();
    publish({
      interaction: state.interaction + 1,
      active: new Set(),
      keys: new Set(),
      inactive: new Set(),
    });
  }
  return {
    recording,
    getSnapshot: () => state,
    subscribe(listener: (state: Snapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async enable() {
      if (disposed || state.busy) return;
      publish({ busy: true, error: false });
      try {
        await synth.enable();
        publish({ enabled: true });
      } catch {
        publish({ error: true });
      } finally {
        publish({ busy: false });
      }
    },
    press(source: string, note: HeldNote) {
      if (disposed || !state.enabled || held.has(source)) return;
      const sounding = Array.from(held.values()).some((item) =>
        sameOutput(item, note),
      );
      held.set(source, note);
      if (
        !note.origin &&
        ![...held.entries()].some(
          ([owner, n]) =>
            owner !== source && !n.origin && n.pitch === note.pitch,
        )
      )
        recording.start(`local:${note.pitch}`, note.pitch);
      if (!sounding) send(note.pitch, true, note.channel, note.velocity);
      refresh();
    },
    release(source: string) {
      const note = held.get(source);
      if (!note || disposed) return;
      held.delete(source);
      if (
        !note.origin &&
        ![...held.values()].some((n) => !n.origin && n.pitch === note.pitch)
      )
        recording.end(`local:${note.pitch}`);
      if (!Array.from(held.values()).some((item) => sameOutput(item, note)))
        send(note.pitch, false, note.channel, note.releaseVelocity);
      refresh();
    },
    releaseAll,
    releaseLive() {
      for (const [owner, note] of held) if (note.origin !== "playback") this.release(owner);
      this.releasePreview();
    },
    selectMode(mode: Mode) {
      if (disposed || mode === state.mode) return;
      const playback = [...held.entries()].filter(([, note]) => note.origin === "playback");
      releaseAll();
      midi.setEnabled(false);
      publish({ mode });
      midi.setEnabled(mode === "midi");
      if (mode === "midi") connection ??= midi.connect();
      for (const [owner, note] of playback) this.press(owner, note);
    },
    setParameters(next: Partial<SynthParameters>) {
      if (disposed || !validParameters(next)) return;
      if (
        Object.entries(next).every(
          ([key, value]) =>
            state.parameters[key as keyof SynthParameters] === value,
        )
      )
        return;
      const parameters = { ...state.parameters, ...next };
      synth.setParameters(next);
      publish({ parameters });
    },
    selectInput: midi.selectInput,
    selectOutput(id: string) {
      const playback = [...held.entries()].filter(([, note]) => note.origin === "playback");
      releaseAll();
      midi.selectOutput(id);
      for (const [owner, note] of playback) this.press(owner, note);
    },
    releasePreview() {
      for (const [owner, note] of held) {
        if (note.origin !== "preview") continue;
        held.delete(owner);
        if (![...held.values()].some((other) => sameOutput(other, note)))
          send(note.pitch, false, note.channel);
      }
      refresh();
    },
    dispose() {
      if (disposed) return;
      listeners.clear();
      releaseAll();
      disposed = true;
      midi.dispose();
      synth.dispose();
    },
  };
}
export type Controller = ReturnType<typeof createController>;
