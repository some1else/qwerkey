import { createSynth, defaultParameters, type SynthParameters } from '../audio';
import { mappings, type KeyMapping } from '../layout';
import { createMidi, type MidiPorts } from '../midi';

import { validParameters } from './parameters';

export type Mode = 'audio' | 'midi';
export interface HeldNote { pitch: number; mapping?: KeyMapping }
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
  mode: 'audio', enabled: false, busy: false, error: false,
  active: new Set(), keys: new Set(), inactive: new Set(),
  ports: { inputs: [], outputs: [], inputId: '', outputId: '' },
};
export function createController() {
  let state = { ...initialSnapshot };
  let disposed = false;
  const listeners = new Set<(state: Snapshot) => void>();
  const held = new Map<string, HeldNote>();
  const incoming = new Set<number>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const synth = createSynth();
  let connection: Promise<void> | undefined;
  function publish(next: Partial<Snapshot> = {}) {
    if (disposed) return;
    state = { ...state, ...next };
    listeners.forEach(listener => listener(state));
  }
  function refresh() {
    const active = new Set(incoming);
    const keys = new Set<number>();
    const inactive = new Set(state.inactive);
    for (const note of held.values()) {
      active.add(note.pitch);
      if (note.mapping) keys.add(note.mapping.code);
    }
    for (const pitch of incoming) {
      const key = mappings.find(key => key.noteNumber === pitch);
      if (key) keys.add(key.code);
    }
    for (const key of mappings) {
      if (state.keys.has(key.code) === keys.has(key.code)) continue;
      clearTimeout(timers.get(key.code));
      timers.delete(key.code);
      if (keys.has(key.code)) inactive.delete(key.code);
      else {
        inactive.add(key.code);
        timers.set(key.code, setTimeout(() => {
          timers.delete(key.code);
          const next = new Set(state.inactive);
          next.delete(key.code);
          publish({ inactive: next });
        }, 3000));
      }
    }
    publish({ active, keys, inactive });
  }
  const midi = createMidi((pitch, active) => {
    if (state.mode !== 'midi' || disposed) return;
    if (active) incoming.add(pitch); else incoming.delete(pitch);
    refresh();
  }, ports => publish({ ports }));
  function send(pitch: number, active: boolean) {
    if (state.mode === 'midi') midi.sendNote(pitch, active);
    else if (active) synth.play(pitch, 440 * 2 ** ((pitch - 69) / 12));
    else synth.release(pitch);
  }
  function releaseAll() {
    for (const pitch of new Set(Array.from(held.values(), note => note.pitch))) send(pitch, false);
    held.clear(); incoming.clear();
    timers.forEach(clearTimeout); timers.clear();
    publish({ interaction: state.interaction + 1, active: new Set(), keys: new Set(), inactive: new Set() });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: (state: Snapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async enable() {
      if (disposed || state.busy) return;
      publish({ busy: true, error: false });
      try { await synth.enable(); publish({ enabled: true }); }
      catch { publish({ error: true }); }
      finally { publish({ busy: false }); }
    },
    press(source: string, note: HeldNote) {
      if (disposed || !state.enabled || held.has(source)) return;
      const sounding = Array.from(held.values()).some(item => item.pitch === note.pitch);
      held.set(source, note);
      if (!sounding) send(note.pitch, true);
      refresh();
    },
    release(source: string) {
      const note = held.get(source);
      if (!note || disposed) return;
      held.delete(source);
      if (!Array.from(held.values()).some(item => item.pitch === note.pitch)) send(note.pitch, false);
      refresh();
    },
    releaseAll,
    selectMode(mode: Mode) {
      if (disposed || mode === state.mode) return;
      releaseAll(); midi.setEnabled(false);
      publish({ mode });
      midi.setEnabled(mode === 'midi');
      if (mode === 'midi') connection ??= midi.connect();
    },
    setParameters(next: Partial<SynthParameters>) {
      if (disposed || !validParameters(next)) return;
      if (Object.entries(next).every(([key, value]) => state.parameters[key as keyof SynthParameters] === value)) return;
      const parameters = { ...state.parameters, ...next };
      synth.setParameters(next);
      publish({ parameters });
    },
    selectInput: midi.selectInput,
    selectOutput: midi.selectOutput,
    dispose() {
      if (disposed) return;
      listeners.clear(); releaseAll(); disposed = true;
      midi.dispose(); synth.dispose();
    },
  };
}
export type Controller = ReturnType<typeof createController>;
