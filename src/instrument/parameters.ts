import type { SynthParameters } from '../audio';

export const fields = [
  { id: 'frequency', label: 'Frequency', unit: 'Hz', title: 'Lowpass cutoff: 440 follows the played note; 880 is one octave above', min: 1, max: 20000, step: 1 },
  { id: 'resonance', label: 'Resonance', unit: '', title: 'Lowpass resonance in classic Q', min: 0.1, max: 30, step: 0.01 },
  { id: 'warmth', label: 'Warmth', unit: '%', title: 'Saturation and high note attenuation in percent', min: 0, max: 100, step: 1 },
  { id: 'space', label: 'Space', unit: '%', title: 'Reverb, unison and stereo spread in percent', min: 0, max: 100, step: 1 },
  { id: 'voices', label: 'Voices', unit: '', title: 'Maximum simultaneous voices', min: 1, max: 32, step: 1 },
  { id: 'attack', label: 'Attack', unit: 'ms', title: 'Attack duration', min: 0, max: 1000, step: 1 },
  { id: 'decay', label: 'Decay', unit: 'ms', title: 'Decay duration', min: 0, max: 2000, step: 1 },
  { id: 'sustain', label: 'Sustain', unit: 'dB', title: 'Sustain level in decibels relative to the attack peak', min: -96, max: 0, step: 0.1 },
  { id: 'release', label: 'Release', unit: 'ms', title: 'Release duration', min: 0, max: 10000, step: 1 },
] as const;


export function validParameters(next: Partial<SynthParameters>): boolean {
  return Object.entries(next).every(([id, value]) => {
    if (id === 'oscillator') return ['sine', 'triangle', 'sawtooth', 'square'].includes(String(value));
    const field = fields.find(field => field.id === id);
    if (!field || typeof value !== 'number' || !Number.isFinite(value)) return false;
    const steps = (value - field.min) / field.step;
    return value >= field.min && value <= field.max && Math.abs(steps - Math.round(steps)) < 1e-7;
  });
}
