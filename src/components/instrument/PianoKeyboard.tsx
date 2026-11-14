import { Piano } from '@audio-ui/react/piano';
import { mappings } from '../../layout';
import type { Controller, Snapshot } from '../../instrument/controller';

export default function PianoKeyboard({ state, controller }: { state: Snapshot; controller: Controller | null }) {
  const owner = (pitch: number, event: Event) => 'pointerId' in event
    ? `piano:pointer:${event.pointerId}` : `piano:keyboard:${pitch}`;
  return <div className="piano_scroll" role="region" aria-label="Piano keyboard, scroll horizontally below the keys" tabIndex={0}>
    <Piano.Root className="keys piano_keys" minPitch={41} maxPitch={96} disabled={!state.enabled}
      activeNotes={[...state.active]}
      onNoteOn={(pitch, details) => {
        if (!controller?.getSnapshot().enabled) { details.cancel(); return; }
        controller.press(owner(pitch, details.event), { pitch, mapping: mappings.find(key => key.noteNumber === pitch) });
      }} onNoteOff={(pitch, details) => controller?.release(owner(pitch, details.event))}>
      <Piano.Keys>{pitch => {
        const mapping = mappings.find(key => key.noteNumber === pitch);
        const black = [1, 3, 6, 8, 10].includes(pitch % 12);
        return <Piano.Key pitch={pitch} data-pitch={pitch}
          className={({ active }) => `key key_${pitch} ${black ? 'black_key raised_key' : 'white_key'} ${mapping ? `key_${mapping.x}_${mapping.y}` : ''} ${active ? 'key_active' : ''}`} />;
      }}</Piano.Keys>
    </Piano.Root>
  </div>;
}
