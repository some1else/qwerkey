import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Instrument from '../../src/components/instrument/Instrument';
import { createController } from '../../src/instrument/controller';
let root: ReturnType<typeof createRoot> | undefined;
Object.assign(window, {
  createController,
  mount() { root = createRoot(document.getElementById('root')!); root.render(<StrictMode><Instrument /></StrictMode>); },
  unmount() { root?.unmount(); root = undefined; },
});
