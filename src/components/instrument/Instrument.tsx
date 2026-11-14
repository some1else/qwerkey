import type { PointerEvent } from 'react';
import { mappings } from '../../layout';
import { useInstrument } from '../../hooks/useInstrument';
import type { Mode } from '../../instrument/controller';
import PianoKeyboard from './PianoKeyboard';
import AudioParameters from './AudioParameters';
import MidiPorts from './MidiPorts';
import { ComputerKeyboard } from './Keyboards';
export default function Instrument() {
  const { state, ready, safari, controller, instrument, focus } = useInstrument();
  function selectMode(mode: Mode) {
    if (mode === 'midi' && safari) window.alert('Qwerkey’s MIDI mode is unavailable in Safari. You can keep playing in Audio mode or open Qwerkey in a browser with Web MIDI support.');
    else controller.current?.selectMode(mode);
    focus();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !controller.current?.getSnapshot().enabled) return;
    const key = event.target instanceof Element ? event.target.closest<HTMLElement>('.key') : null;
    if (!key?.dataset.pitch) return;
    event.preventDefault(); key.setPointerCapture(event.pointerId); focus();
    const pitch = Number(key.dataset.pitch);
    const mapping = key.dataset.code ? mappings.find(item => item.code === Number(key.dataset.code)) : mappings.find(item => item.noteNumber === pitch);
    controller.current.press(`pointer:${event.pointerId}`, { pitch, mapping });
  }
  return <>
    <div className="overlay" hidden={state.enabled}>
      <p>Keyboard <a href="https://en.wikipedia.org/wiki/Tonnetz" target="_blank">Tonnetz</a></p>
      <p><a href="http://twitter.com/some1else" target="_blank">@some1else</a></p>
      <p><button id="enabler" disabled={!ready || state.busy} onClick={async () => { await controller.current?.enable(); if (controller.current?.getSnapshot().enabled) focus(); }}>{state.error ? 'Audio could not start. Click to retry' : 'Click here to enable audio'}</button></p>
    </div>
    <div id="instrument" tabIndex={-1} ref={instrument} style={{textAlign: 'center'}}>
      <div className="mode_switch" role="group" aria-label="Playback mode">
        <button id="audio-mode" type="button" aria-pressed={state.mode === 'audio'} onClick={() => selectMode('audio')}>Audio</button>
        <button id="midi-mode" type="button" aria-pressed={state.mode === 'midi'} aria-disabled={safari || undefined} onClick={() => selectMode('midi')}>MIDI</button>
      </div>
      <ComputerKeyboard state={state} onPointerDown={pointerDown} />
      <PianoKeyboard key={state.interaction} state={state} controller={controller.current} />
      <div className="sound_controls"><AudioParameters parameters={state.parameters} hidden={state.mode !== 'audio'} controller={controller.current} /><MidiPorts state={state} controller={controller.current} /></div>
    </div>
  </>;
}
