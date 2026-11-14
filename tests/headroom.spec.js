import { test, expect } from '@playwright/test';
import { rolldown } from 'rolldown';

let harness;
test.beforeAll(async () => {
  const bundle = await rolldown({ input: 'src/audio.ts' });
  try {
    const result = await bundle.generate({ format: 'iife', name: 'audioHarness' });
    harness = result.output[0].code;
  } finally {
    await bundle.close();
  }
});

test('keeps default effects subtle and makes maximum settings crunchy and flooded', async ({ page }) => {
  await page.addScriptTag({ content: harness });
  const results = await page.evaluate(async () => {
    const NativeAudioContext = window.AudioContext;
    const nativeConnect = AudioNode.prototype.connect;
    const results = [];
    try {
      for (const enabled of [false, true, 'flooded', 'crunch']) {
        const context = new OfflineAudioContext(2, 48000 * 3, 48000);
        Object.defineProperty(context, 'state', { get: () => 'running' });
        context.resume = async () => {};
        window.AudioContext = function () { return context; };
        const edges = [];
        AudioNode.prototype.connect = function (destination, ...args) {
          edges.push([this, destination]);
          return nativeConnect.call(this, destination, ...args);
        };
        const synth = audioHarness.createSynth();
        synth.setParameters({ warmth: enabled === 'crunch' ? 100 : 25, space: enabled === 'flooded' ? 100 : 25 });
        await synth.enable();
        AudioNode.prototype.connect = nativeConnect;
        const hall = edges.find(([from]) => from instanceof ConvolverNode)[0];
        if (!enabled || enabled === 'crunch') hall.disconnect();
        const ceiling = edges.find(([, to]) => to === context.destination)[0];
        const clip = edges.find(([, to]) => to === ceiling)[0];
        const limiter = edges.find(([, to]) => to === clip)[0];
        const compensation = edges.find(([, to]) => to === limiter)[0];
        const master = edges.find(([, to]) => to === compensation)[0];
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(2, 4800, 48000);
        for (let i = 0; i < 4800; i++) {
          source.buffer.getChannelData(0)[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / 48000);
        }
        source.connect(master);
        source.start(0.05);
        const buffer = await context.startRendering();
        const energy = (start, end) => [0, 1].map(channel =>
          buffer.getChannelData(channel).slice(start * 48000, end * 48000)
            .reduce((sum, sample) => sum + sample * sample, 0));
        const harmonic = frequency => {
          let real = 0, imaginary = 0;
          const samples = buffer.getChannelData(0);
          for (let i = 4320; i < 6720; i++) {
            const phase = 2 * Math.PI * frequency * i / 48000;
            real += samples[i] * Math.cos(phase);
            imaginary += samples[i] * Math.sin(phase);
          }
          return Math.hypot(real, imaginary);
        };
        results.push({ direct: energy(0, 0.2), tail: energy(0.3, 1.3), late: energy(2, 3), harmonicRatio: harmonic(1320) / harmonic(440) });
      }
    } finally {
      window.AudioContext = NativeAudioContext;
      AudioNode.prototype.connect = nativeConnect;
    }
    return results;
  });
  const [dry, wet, flooded, crunch] = results;
  expect(crunch.harmonicRatio).toBeGreaterThan(0.05);
  expect(crunch.harmonicRatio).toBeGreaterThan(dry.harmonicRatio * 3);
  for (const channel of [0, 1]) {
    expect(dry.tail[channel]).toBeLessThan(1e-10);
    expect(wet.tail[channel]).toBeGreaterThan(1e-6);
    expect(wet.tail[channel]).toBeLessThan(wet.direct[0] * 0.05);
    expect(wet.late[channel]).toBeLessThan(wet.tail[channel] * 0.01);
    expect(flooded.tail[channel]).toBeGreaterThan(wet.tail[channel] * 10);
  }
});

test('measures Warmth loudness across waveforms and chord sizes', async ({ page }, testInfo) => {
  await page.addScriptTag({ content: harness });
  const measurements = await page.evaluate(async () => {
    const Native = window.AudioContext;
    const results = [];
    try {
      for (const oscillator of ['triangle', 'square']) {
        for (const pitches of [[60], [48, 52, 55]]) {
          for (const warmth of [0, 25, 50, 75, 100]) {
            const context = new OfflineAudioContext(2, 48000 * 3, 48000);
            Object.defineProperty(context, 'state', { get: () => 'running' });
            context.resume = async () => {};
            window.AudioContext = function () { return context; };
            const synth = audioHarness.createSynth();
            synth.setParameters({ oscillator, warmth });
            await synth.enable();
            pitches.forEach(pitch => synth.play(pitch, 440 * 2 ** ((pitch - 69) / 12)));
            const buffer = await context.startRendering();
            let energy = 0;
            for (let channel = 0; channel < 2; channel++) {
              for (const sample of buffer.getChannelData(channel).subarray(96000)) energy += sample * sample;
            }
            results.push({ oscillator, voices: pitches.length, warmth, rms: Math.sqrt(energy / 96000) });
          }
        }
      }
    } finally { window.AudioContext = Native; }
    return results;
  });
  await testInfo.attach('warmth-loudness', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  const endDifferences = [];
  for (const oscillator of ['triangle', 'square']) {
    for (const voices of [1, 3]) {
      const rows = measurements.filter(row => row.oscillator === oscillator && row.voices === voices);
      const reference = rows.find(row => row.warmth === 0).rms;
      for (const row of rows) {
        const difference = 20 * Math.log10(row.rms / reference);
        // Timbre and chord density affect perceived loudness, but the whole
        // sweep should remain within a modest range instead of a large boost.
        expect(difference, JSON.stringify(row)).toBeLessThan(6);
        if (row.warmth === 100) {
          expect(difference).toBeGreaterThan(-1);
          endDifferences.push(difference);
        }
      }
    }
  }
  const meanDifference = endDifferences.reduce((sum, value) => sum + value, 0) / endDifferences.length;
  expect(meanDifference).toBeGreaterThan(2);
  expect(meanDifference).toBeLessThan(4);
});

for (const sampleRate of [44100, 48000]) {
  test(`measures six-voice submix and output headroom at ${sampleRate} Hz`, async ({ page }, testInfo) => {
    await page.addScriptTag({ content: harness });
    const measurements = await page.evaluate(async sampleRate => {
      const results = [];
      const NativeAudioContext = window.AudioContext;
      const nativeConnect = AudioNode.prototype.connect;
      try {
        for (const oscillator of ['sine', 'triangle', 'sawtooth', 'square']) {
          for (const profile of ['chord', 'coherent-low', 'coherent-high', 'resonant', 'wild']) {
            // Three stereo taps: submix, post-compressor makeup, final output.
            const context = new OfflineAudioContext(6, sampleRate * 3, sampleRate);
            Object.defineProperty(context, 'state', { get: () => 'running' });
            context.resume = async () => {};
            window.AudioContext = function () { return context; };
            const edges = [];
            AudioNode.prototype.connect = function (destination, ...args) {
              edges.push([this, destination]);
              return nativeConnect.call(this, destination, ...args);
            };
            const synth = audioHarness.createSynth();
            synth.setParameters({
              voices: 6, oscillator,
              ...(profile === 'chord' ? {} : {
                attack: 0, decay: 0, sustain: 0,
                frequency: ['resonant', 'wild'].includes(profile) ? 440 : 20000,
                resonance: ['resonant', 'wild'].includes(profile) ? 30 : 0.7,
              }),
              ...(profile === 'wild' ? { warmth: 100, space: 100 } : {}),
            });
            await synth.enable();
            const pitches = profile === 'chord' ? [41, 45, 48, 52, 55, 60]
              : Array(6).fill(profile === 'coherent-high' ? 96 : 41);
            pitches.forEach((pitch, key) => synth.play(key, 440 * 2 ** ((pitch - 69) / 12), 127));
            AudioNode.prototype.connect = nativeConnect;

            const ceiling = edges.find(([, to]) => to === context.destination)[0];
            const softClip = edges.find(([, to]) => to === ceiling)[0];
            const limiter = edges.find(([, to]) => to === softClip)[0];
            const compensation = edges.find(([, to]) => to === limiter)[0];
            const master = edges.find(([, to]) => to === compensation)[0];
            const compressor = edges.find(([, to]) => to === master)[0];
            const submix = edges.find(([, to]) => to === compressor)[0];
            ceiling.disconnect(context.destination);
            const merger = context.createChannelMerger(6);
            [submix, master, ceiling].forEach((node, index) => {
              const splitter = context.createChannelSplitter(2);
              node.connect(splitter);
              splitter.connect(merger, 0, index * 2);
              splitter.connect(merger, 1, index * 2 + 1);
            });
            merger.connect(context.destination);
            const buffer = await context.startRendering();
            const peaks = [0, 0, 0];
            let finite = true;
            for (let channel = 0; channel < 6; channel++) {
              for (const sample of buffer.getChannelData(channel)) {
                finite &&= Number.isFinite(sample);
                peaks[Math.floor(channel / 2)] = Math.max(peaks[Math.floor(channel / 2)], Math.abs(sample));
              }
            }
            results.push({ oscillator, profile, finite, peaks, dbFS: peaks.map(peak => 20 * Math.log10(peak)) });
          }
        }
      } finally {
        window.AudioContext = NativeAudioContext;
        AudioNode.prototype.connect = nativeConnect;
      }
      return results;
    }, sampleRate);
    await testInfo.attach('six-voice-headroom', {
      body: JSON.stringify({ sampleRate, taps: ['submix', 'master', 'output'], measurements }, null, 2),
      contentType: 'application/json',
    });
    for (const oscillator of ['sine', 'triangle', 'sawtooth', 'square']) {
      const low = measurements.find(row => row.oscillator === oscillator && row.profile === 'coherent-low');
      const high = measurements.find(row => row.oscillator === oscillator && row.profile === 'coherent-high');
      // Compare actual audio before bus compression can compensate for level.
      expect(high.peaks[0], oscillator).toBeLessThan(low.peaks[0] * 0.6);
    }
    for (const measurement of measurements) {
      expect(measurement.finite, JSON.stringify(measurement)).toBe(true);
      if (!['resonant', 'wild'].includes(measurement.profile)) {
        // At least 3 dB of raw submix headroom, including oscillator/filter
        // overshoot, without relying on compression or the output ceiling.
        expect(measurement.peaks[0], JSON.stringify(measurement)).toBeLessThan(10 ** (-3 / 20));
        expect(measurement.peaks[1]).toBeLessThan(1);
      }
      expect(measurement.peaks[2]).toBeGreaterThan(0.01);
      expect(measurement.peaks[2]).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    }
  });
}
