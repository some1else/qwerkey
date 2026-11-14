import { useEffect, useRef, useState } from 'react';
import { createController, initialSnapshot, type Controller } from '../instrument/controller';
import { mappings } from '../layout';
const byCode = new Map(mappings.map(key => [key.code, key]));
export function useInstrument() {
  const controller = useRef<Controller | null>(null);
  const instrument = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(initialSnapshot);
  const [ready, setReady] = useState(false);
  const [safari, setSafari] = useState(false);
  useEffect(() => {
    const runtime = createController();
    controller.current = runtime;
    let frame = 0;
    let previous = runtime.getSnapshot();
    let pressed = new Set<number>(), pitches = new Set<number>();
    const unsubscribe = runtime.subscribe(next => {
      for (const key of next.keys) pressed.add(key);
      for (const pitch of next.active) pitches.add(pitch);
      if (next.enabled !== previous.enabled || next.mode !== previous.mode || next.parameters !== previous.parameters || next.ports !== previous.ports || next.interaction !== previous.interaction || next.busy !== previous.busy || next.error !== previous.error) {
        cancelAnimationFrame(frame); frame = 0;
        pressed.clear(); pitches.clear(); setState(next);
      } else if (!frame) {
        frame = requestAnimationFrame(() => {
          const latest = runtime.getSnapshot();
          const transient = [...pressed].some(key => !latest.keys.has(key));
          setState(transient ? { ...latest, keys: new Set([...latest.keys, ...pressed]), active: new Set([...latest.active, ...pitches]) } : latest);
          pressed.clear(); pitches.clear(); frame = 0;
          if (transient) frame = requestAnimationFrame(() => { frame = 0; pressed.clear(); pitches.clear(); setState(runtime.getSnapshot()); });
        });
      }
      previous = next;
    });
    setState(runtime.getSnapshot()); setReady(true);
    setSafari(/Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Android/i.test(navigator.userAgent));
    const keyboard = (event: KeyboardEvent, active: boolean) => {
      if (!active) { runtime.release(`keyboard:${event.keyCode}`); return; }
      if (event.target instanceof Element && event.target.closest('select, input, textarea, button, [contenteditable], .recorded_buffer')) return;
      if (!runtime.getSnapshot().enabled) return;
      const key = byCode.get(event.keyCode);
      if (!key) { if (event.key !== 'Tab') event.preventDefault(); return; }
      event.preventDefault(); runtime.press(`keyboard:${key.code}`, { pitch: key.noteNumber, mapping: key });
    };
    const down = (event: KeyboardEvent) => keyboard(event, true);
    const up = (event: KeyboardEvent) => keyboard(event, false);
    const release = (event: PointerEvent) => runtime.release(`pointer:${event.pointerId}`);
    const visibility = () => { if (document.hidden) runtime.releaseAll(); };
    document.addEventListener('keydown', down); document.addEventListener('keyup', up);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) document.addEventListener(name, release);
    window.addEventListener('blur', runtime.releaseAll); window.addEventListener('pagehide', runtime.releaseAll);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe(); cancelAnimationFrame(frame); controller.current = null;
      document.removeEventListener('keydown', down); document.removeEventListener('keyup', up);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) document.removeEventListener(name, release);
      window.removeEventListener('blur', runtime.releaseAll); window.removeEventListener('pagehide', runtime.releaseAll);
      document.removeEventListener('visibilitychange', visibility); runtime.dispose();
    };
  }, []);
  const focus = () => instrument.current?.focus({ preventScroll: true });
  return { state, ready, safari, controller, instrument, focus };
}
