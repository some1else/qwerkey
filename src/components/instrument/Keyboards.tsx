import type { PointerEventHandler } from 'react';
import { mappings } from '../../layout';
import type { Snapshot } from '../../instrument/controller';
type Props = { state: Snapshot; onPointerDown: PointerEventHandler<HTMLDivElement> };
export function ComputerKeyboard({ state, onPointerDown }: Props) {
  return <div className="keys computer_keys" onPointerDown={onPointerDown}>{[5,4,3,2,1].map(y =>
    <div className={`row row_${y}`} key={y}>{Array.from({length: 10}, (_, column) => {
      const x = column + (y === 5 ? 2 : 1);
      const key = mappings.find(key => key.x === x && key.y === y)!;
      const activity = state.keys.has(key.code) ? 'key_active' : state.inactive.has(key.code) ? 'key_inactive' : '';
      return <span key={key.code} className={`key key_${x}_${y} ${key.colorClass} ${activity}`} data-pitch={key.noteNumber} data-code={key.code}>
        <span className="kc">{key.chr}</span><span className="hz">{Math.round(key.frequency)} Hz</span><span className="note">{key.note}</span>
      </span>;
    })}</div>
  )}</div>;
}
export function PianoKeyboard({ state, onPointerDown }: Props) {
  return <div className="piano_scroll" role="region" aria-label="Piano keyboard, scroll horizontally below the keys" tabIndex={0}>
    <div className="keys piano_keys" onPointerDown={onPointerDown}>{Array.from({length: 56}, (_, index) => {
      const pitch = index + 41;
      const mapping = mappings.find(key => key.noteNumber === pitch);
      const color = [1,3,6,8,10].includes(pitch % 12) ? 'black_key raised_key' : 'white_key';
      const classes = mapping ? `key_${mapping.x}_${mapping.y} ${mapping.colorClass}` : color;
      return <span key={pitch} data-pitch={pitch} className={`key ${classes} key_${pitch} ${state.active.has(pitch) ? 'key_active' : ''}`} />;
    })}</div>
  </div>;
}
