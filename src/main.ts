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
    const classes = mapping ? `key_${mapping.x}_${mapping.y} ${mapping.colorClass} key_${pitch}` : `key_${pitch}`;
    piano.append(createKey(classes));
  }
}

type Mode = 'audio' | 'midi';
let mode: Mode = 'audio';
let midiConnection: Promise<void> | undefined;
const synth = createSynth();
const safari = /Safari/i.test(navigator.userAgent)
  && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Android/i.test(navigator.userAgent);

const midi = createMidi((pitch, active) => {
  if (mode !== 'midi') return;
  // Preserve the first matching mapping for pitches shared by multiple keys.
  setKeyActive(mappings.find(key => key.noteNumber === pitch), active);
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

function handleKeyboard(event: KeyboardEvent, active: boolean) {
  if (event.target instanceof Element && event.target.closest('select, input, textarea, button, [contenteditable]')) {
    // Still release a musical key that was pressed before focus moved here.
    if (!active) {
      const held = byCode.get(event.keyCode);
      if (held?.pressed) {
        held.pressed = false;
        sendNote(held, false);
        setKeyActive(held, false);
      }
    }
    return;
  }
  if (!document.querySelector<HTMLElement>('.overlay')?.hidden) return;
  const key = byCode.get(event.keyCode);
  if (!key) {
    if (event.key !== 'Tab') event.preventDefault();
    return;
  }
  if (key.pressed === active) return;
  key.pressed = active;
  sendNote(key, active);
  setKeyActive(key, active);
}

function sendNote(key: KeyMapping, active: boolean) {
  if (mode === 'midi') midi.sendNote(key.noteNumber, active);
  else if (active) synth.play(key.code, key.frequency);
  else synth.release(key.code);
}

function releaseHeldNotes() {
  for (const key of mappings) {
    if (key.pressed) sendNote(key, false);
    key.pressed = false;
    window.clearTimeout(key.timeout);
  }
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
  window.addEventListener('blur', releaseHeldNotes);
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
