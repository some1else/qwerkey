import { createSynth } from './audio';
import { mappings, type KeyMapping } from './layout';
import { createMidi, type MidiPorts } from './midi';

const ACTIVITY_MS = 3000;
const byCode = new Map(mappings.map(key => [key.code, key]));

function setKeyActive(key: KeyMapping | undefined, active: boolean) {
  if (!key) return;
  window.clearTimeout(key.timeout);
  const selector = `.key_${key.noteNumber}, .key_${key.x}_${key.y}`;
  document.querySelectorAll(selector).forEach(element => {
    element.classList.toggle('key_active', active);
    element.classList.toggle('key_inactive', !active);
  });
  if (!active) {
    key.timeout = window.setTimeout(() => {
      document.querySelectorAll(`.key_${key.x}_${key.y}`).forEach(element => {
        element.classList.remove('key_inactive');
      });
    }, ACTIVITY_MS);
  }
}

function createKey(className: string) {
  const element = document.createElement('span');
  element.className = `key ${className}`;
  return element;
}

function drawKeyboard() {
  const computer = document.querySelector('.computer_keys');
  const piano = document.querySelector('.piano_keys');
  if (!computer || !piano) throw new Error('Keyboard containers are missing');

  for (let y = 5; y >= 1; y--) {
    const row = document.createElement('div');
    row.className = `row row_${y}`;
    for (let column = 1; column <= 10; column++) {
      const x = y === 5 ? column + 1 : column;
      const mapping = mappings.find(key => key.x === x && key.y === y);
      if (!mapping) throw new Error(`Missing keyboard mapping at ${x}, ${y}`);
      const key = createKey(`key_${x}_${y} ${mapping.colorClass}`);
      key.dataset.pitch = String(mapping.noteNumber);
      key.dataset.code = String(mapping.code);
      const labels = { kc: mapping.chr, hz: `${Math.round(mapping.frequency)} Hz`, note: mapping.note };
      for (const [className, text] of Object.entries(labels)) {
        const label = document.createElement('span');
        label.className = className;
        label.textContent = text;
        key.append(label);
      }
      row.append(key);
    }
    computer.append(row);
  }

  for (let pitch = 41; pitch <= 96; pitch++) {
    const mapping = mappings.find(key => key.noteNumber === pitch);
    const color = [1, 3, 6, 8, 10].includes(pitch % 12) ? 'black_key raised_key' : 'white_key';
    const classes = mapping ? `key_${mapping.x}_${mapping.y} ${mapping.colorClass} key_${pitch}` : `${color} key_${pitch}`;
    const key = createKey(classes);
    key.dataset.pitch = String(pitch);
    piano.append(key);
  }
}

type Mode = 'audio' | 'midi';
let mode: Mode = 'audio';
let midiConnection: Promise<void> | undefined;
const synth = createSynth();
const safari = /Safari/i.test(navigator.userAgent)
  && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Android/i.test(navigator.userAgent);

interface HeldNote {
  pitch: number;
  mapping?: KeyMapping;
}

const heldNotes = new Map<string, HeldNote>();
const incomingNotes = new Set<number>();

const midi = createMidi((pitch, active) => {
  if (mode !== 'midi') return;
  if (active) incomingNotes.add(pitch);
  else incomingNotes.delete(pitch);
  refreshHighlights();
}, renderPorts);

function renderPorts(ports: MidiPorts) {
  for (const [id, available, selected] of [
    ['midi-input', ports.inputs, ports.inputId],
    ['midi-output', ports.outputs, ports.outputId],
  ] as const) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren(new Option('-- Choose MIDI port --', ''));
    for (const port of available) select.add(new Option(port.name || port.id, port.id));
    select.value = selected;
  }
}

function refreshHighlights() {
  const held = Array.from(heldNotes.values());
  for (const key of mappings) {
    const active = held.some(note => note.mapping === key)
      || (incomingNotes.has(key.noteNumber) && mappings.find(item => item.noteNumber === key.noteNumber) === key);
    const element = document.querySelector(`.computer_keys .key_${key.x}_${key.y}`);
    if (element?.classList.contains('key_active') !== active) setKeyActive(key, active);
  }
  // A pitch can be held through several keys or input devices at once.
  for (const element of document.querySelectorAll<HTMLElement>('.piano_keys .key')) {
    const pitch = Number(element.dataset.pitch);
    const active = incomingNotes.has(pitch) || held.some(note => note.pitch === pitch);
    element.classList.toggle('key_active', active);
  }
}

function sendNote(pitch: number, active: boolean) {
  if (mode === 'midi') midi.sendNote(pitch, active);
  else if (active) synth.play(pitch, 440 * Math.pow(2, (pitch - 69) / 12));
  else synth.release(pitch);
}

function pressNote(source: string, note: HeldNote) {
  if (heldNotes.has(source)) return;
  const sounding = Array.from(heldNotes.values()).some(held => held.pitch === note.pitch);
  heldNotes.set(source, note);
  if (!sounding) sendNote(note.pitch, true);
  refreshHighlights();
}

function releaseNote(source: string) {
  const note = heldNotes.get(source);
  if (!note) return;
  heldNotes.delete(source);
  if (!Array.from(heldNotes.values()).some(held => held.pitch === note.pitch)) sendNote(note.pitch, false);
  refreshHighlights();
}

function handleKeyboard(event: KeyboardEvent, active: boolean) {
  const key = byCode.get(event.keyCode);
  if (!active) {
    releaseNote(`keyboard:${event.keyCode}`);
    return;
  }
  if (event.target instanceof Element && event.target.closest('select, input, textarea, button, [contenteditable]')) return;
  if (!document.querySelector<HTMLElement>('.overlay')?.hidden) return;
  if (!key) {
    if (event.key !== 'Tab') event.preventDefault();
    return;
  }
  event.preventDefault();
  pressNote(`keyboard:${key.code}`, { pitch: key.noteNumber, mapping: key });
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0 || !document.querySelector<HTMLElement>('.overlay')?.hidden) return;
  const key = event.target instanceof Element ? event.target.closest<HTMLElement>('.key') : null;
  if (!key?.dataset.pitch) return;
  event.preventDefault();
  key.setPointerCapture(event.pointerId);
  document.getElementById('instrument')?.focus({ preventScroll: true });
  const pitch = Number(key.dataset.pitch);
  const mapping = key.dataset.code ? byCode.get(Number(key.dataset.code)) : mappings.find(item => item.noteNumber === pitch);
  pressNote(`pointer:${event.pointerId}`, { pitch, mapping });
}

function releaseHeldNotes() {
  for (const pitch of new Set(Array.from(heldNotes.values(), note => note.pitch))) sendNote(pitch, false);
  heldNotes.clear();
  incomingNotes.clear();
  for (const key of mappings) window.clearTimeout(key.timeout);
  document.querySelectorAll('.key_active, .key_inactive').forEach(element => {
    element.classList.remove('key_active', 'key_inactive');
  });
}

function selectMode(next: Mode) {
  if (next === 'midi' && safari) {
    window.alert('Qwerkey’s MIDI mode is unavailable in Safari. You can keep playing in Audio mode or open Qwerkey in a browser with Web MIDI support.');
    document.getElementById('instrument')?.focus();
    return;
  }
  if (next !== mode) {
    midi.setEnabled(false);
    releaseHeldNotes();
    mode = next;
    midi.setEnabled(mode === 'midi');
    if (mode === 'midi') midiConnection ??= midi.connect();
    document.getElementById('audio-mode')?.setAttribute('aria-pressed', String(mode === 'audio'));
    document.getElementById('midi-mode')?.setAttribute('aria-pressed', String(mode === 'midi'));
    document.querySelector<HTMLElement>('.midi_ports')!.hidden = mode !== 'midi';
  }
  document.getElementById('instrument')?.focus();
}

function start() {
  drawKeyboard();
  document.getElementById('midi-input')?.addEventListener('change', event => {
    midi.selectInput((event.target as HTMLSelectElement).value);
  });
  document.getElementById('midi-output')?.addEventListener('change', event => {
    midi.selectOutput((event.target as HTMLSelectElement).value);
  });
  document.addEventListener('keydown', event => handleKeyboard(event, true));
  document.addEventListener('keyup', event => handleKeyboard(event, false));
  document.getElementById('audio-mode')?.addEventListener('click', () => selectMode('audio'));
  document.getElementById('midi-mode')?.addEventListener('click', () => selectMode('midi'));
  if (safari) document.getElementById('midi-mode')?.setAttribute('aria-disabled', 'true');
  document.querySelectorAll<HTMLElement>('.keys').forEach(keyboard => {
    keyboard.addEventListener('pointerdown', handlePointerDown);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    document.addEventListener(event, event => releaseNote(`pointer:${event.pointerId}`));
  }
  window.addEventListener('blur', releaseHeldNotes);
  window.addEventListener('pagehide', releaseHeldNotes);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseHeldNotes();
  });
  const enabler = document.querySelector<HTMLButtonElement>('#enabler');
  enabler?.addEventListener('click', async () => {
    enabler.disabled = true;
    try {
      await synth.enable();
      document.querySelector<HTMLElement>('.overlay')!.hidden = true;
      document.getElementById('instrument')?.focus();
    } catch {
      enabler.textContent = 'Audio could not start. Click to retry';
    } finally {
      enabler.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
