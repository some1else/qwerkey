import { test, expect } from '@playwright/test';

for (const sampleRate of [44100, 48000]) {
  test(`mixes every voice through dynamics and bounds output at ${sampleRate} Hz`, async ({ page }) => {
    await page.addInitScript(sampleRate => {
      // Render the app's actual audio graph deterministically, without speakers.
      window.AudioContext = function (options) {
        window.contextOptions = options;
        const context = new OfflineAudioContext(2, sampleRate * 4, sampleRate);
        Object.defineProperty(context, 'state', { get: () => 'running' });
        context.resume = async () => {};
        window.renderContext = context;
        return context;
      };
      window.connections = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        window.connections.push([this, destination]);
        return connect.call(this, destination, ...args);
      };
    }, sampleRate);
    await page.goto('./');
    await page.locator('#enabler').click();
    await expect(page.locator('.overlay')).toBeHidden();
    await page.locator('#voices input').focus();
    await page.keyboard.press('End');
    await page.locator('.piano_keys').evaluate(element => { element.setPointerCapture = () => {}; });
    await page.locator('.piano_keys .key').evaluateAll(keys => {
      keys.forEach((key, index) => {
        key.setPointerCapture = () => {};
        const box = key.getBoundingClientRect();
        key.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, button: 0, pointerId: index + 1,
          clientX: box.x + box.width / 2, clientY: box.y + box.height * .85,
        }));
      });
    });
    const result = await page.evaluate(async () => {
      const context = window.renderContext;
      const edges = window.connections;
      const outputs = edges.filter(([, to]) => to === context.destination);
      const ceiling = outputs[0][0];
      const softClip = edges.find(([, to]) => to === ceiling)[0];
      const limiter = edges.find(([, to]) => to === softClip)[0];
      const makeup = edges.find(([, to]) => to === limiter)[0];
      const compressor = edges.find(([, to]) => to === makeup)[0];
      const mixer = edges.find(([, to]) => to === compressor)[0];
      const voiceInputs = edges.filter(([, to]) => to === mixer);
      const graph = {
        contextOptions: window.contextOptions,
        outputs: outputs.length,
        stages: [mixer, compressor, makeup, limiter, softClip, ceiling].map(node => node.constructor.name),
        mixerGain: mixer.gain.value,
        makeupGain: makeup.gain.value,
        oversample: [softClip.oversample, ceiling.oversample],
        voices: voiceInputs.length,
        voiceOutputs: voiceInputs.every(([voice]) => edges.filter(([from]) => from === voice).length === 1),
      };

      // An extreme positive/negative overload through the whole chain must stay
      // bounded, and fed straight into the clip stages (bypassing the
      // compressor and limiter) must land exactly on the safety ceiling.
      const overload = context.createConstantSource();
      overload.offset.setValueAtTime(1e6, 3);
      overload.offset.setValueAtTime(-1e6, 3.05);
      overload.connect(mixer);
      overload.connect(softClip);
      overload.start(3);
      overload.stop(3.1);

      const buffer = await context.startRendering();
      let peak = 0;
      let minimum = 0;
      let chordPeak = 0;
      let finite = true;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          finite &&= Number.isFinite(samples[i]);
          peak = Math.max(peak, Math.abs(samples[i]));
          minimum = Math.min(minimum, samples[i]);
          if (i < buffer.sampleRate * 3) chordPeak = Math.max(chordPeak, Math.abs(samples[i]));
        }
      }
      return { graph, peak, minimum, chordPeak, finite };
    });
    expect(result.graph.makeupGain).toBeCloseTo(1.6, 5);
    delete result.graph.makeupGain;
    expect(result.graph).toEqual({
      contextOptions: { latencyHint: 'interactive' },
      outputs: 1,
      stages: ['GainNode', 'DynamicsCompressorNode', 'GainNode', 'DynamicsCompressorNode', 'WaveShaperNode', 'WaveShaperNode'],
      mixerGain: 0.5,
      oversample: ['4x', 'none'],
      voices: 56,
      voiceOutputs: true,
    });
    expect(result.finite).toBe(true);
    expect(result.chordPeak).toBeGreaterThan(0.05);
    expect(result.peak).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    expect(result.peak).toBeCloseTo(10 ** (-1 / 20), 5);
    expect(result.minimum).toBeCloseTo(-(10 ** (-1 / 20)), 5);
    expect(await page.pageErrors()).toEqual([]);
  });
}

for (const [pitch, side] of [[41, 'left'], [69, 'center'], [96, 'right']]) {
  test(`pans root note ${pitch} to the ${side} in rendered audio`, async ({ page }) => {
    await page.addInitScript(() => {
      window.AudioContext = function () {
        const context = new OfflineAudioContext(2, 48000, 48000);
        Object.defineProperty(context, 'state', { get: () => 'running' });
        context.resume = async () => {};
        window.renderContext = context;
        return context;
      };
    });
    await page.goto('./');
    await page.locator('#enabler').click();
    await page.locator('.piano_keys').evaluate(element => { element.setPointerCapture = () => {}; });
    const key = page.locator(`.piano_keys .key_${pitch}`);
    const box = await key.boundingBox();
    await key.dispatchEvent('pointerdown', {
      button: 0, pointerId: pitch,
      clientX: box.x + box.width / 2, clientY: box.y + box.height * .85,
    });
    const energies = await page.evaluate(async () => {
      const buffer = await window.renderContext.startRendering();
      return [0, 1].map(channel => buffer.getChannelData(channel).reduce((sum, sample) => sum + sample * sample, 0));
    });
    if (side === 'left') {
      expect(energies[0]).toBeGreaterThan(1);
      expect(energies[1]).toBeLessThan(energies[0] * 1e-6);
    } else if (side === 'right') {
      expect(energies[1]).toBeGreaterThan(1);
      expect(energies[0]).toBeLessThan(energies[1] * 1e-6);
    } else {
      expect(energies[0]).toBeGreaterThan(1);
      expect(energies[1] / energies[0]).toBeCloseTo(Math.tan(((pitch - 68.5) / 27.5 + 1) * Math.PI / 4) ** 2, 2);
    }
    expect(await page.pageErrors()).toEqual([]);
  });
}
