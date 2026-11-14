import { test, expect } from '@playwright/test';

async function setKnob(page, id, value) {
  await page.locator(`#${id} input[type="range"]`).evaluate((input, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

// Observe the actual native graph and envelope schedule at a fixed audio time.
async function openSynth(page) {
  await page.addInitScript(() => {
    window.AudioContext = function () {
      const context = new OfflineAudioContext(1, 48000, 48000);
      Object.defineProperty(context, 'state', { get: () => 'running' });
      context.resume = async () => {};
      return context;
    };
    window.oscillators = [];
    window.filters = [];
    window.ramps = [];
    window.detuneRamps = [];
    window.stops = [];
    const stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.stop = function (time) {
      window.stops.push({ index: window.oscillators.indexOf(this), time });
      return stop.call(this, time);
    };
    // Offline contexts do not apply automation until rendering starts.
    window.parameterValues = new WeakMap();
    const setValue = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, time) {
      window.parameterValues.set(this, value);
      return setValue.call(this, value, time);
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.oscillators.push(this);
      return start.apply(this, args);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof BiquadFilterNode && destination instanceof GainNode) {
        window.filters.push(this);
        window.voiceGain = destination.gain;
      }
      return connect.call(this, destination, ...args);
    };
    const ramp = AudioParam.prototype.exponentialRampToValueAtTime;
    AudioParam.prototype.exponentialRampToValueAtTime = function (value, time) {
      const index = window.oscillators.findIndex(node => node.frequency === this);
      if (index >= 0) window.detuneRamps.push({ index, value: 1200 * Math.log2(value / 440), time });
      else window.ramps.push({ value, time });
      return ramp.call(this, value, time);
    };
  });
  await page.goto('./');
  await page.locator('#enabler').click();
}

async function pressPiano(page, pitch) {
  const key = page.locator(`.piano_keys .key_${pitch}`);
  const box = await key.boundingBox();
  await page.locator('.piano_keys').evaluate(element => { element.setPointerCapture = () => {}; });
  await key.dispatchEvent('pointerdown', { button: 0, pointerId: pitch,
    clientX: box.x + box.width / 2, clientY: box.y + box.height * .85 });
}

test.afterEach(async ({ page }) => { expect(await page.pageErrors()).toEqual([]); });

test('tracks each chord note and tunes oscillator and classic Q while held', async ({ page }) => {
  await openSynth(page);
  await page.locator('.piano_keys .key').evaluateAll(keys => {
    for (const key of keys) key.setPointerCapture = () => {};
  });
  for (const pitch of [69, 81]) {
    await pressPiano(page, pitch);
  }
  const graph = () => page.evaluate(() => ({
    oscillators: window.oscillators.map(node => [node.type, node.frequency.value]),
    filters: window.filters.map(node => [node.type, window.parameterValues.get(node.frequency), window.parameterValues.get(node.Q)]),
  }));
  let actual = await graph();
  expect(actual.oscillators).toEqual([['triangle', 440], ['triangle', 440], ['triangle', 880], ['triangle', 880]]);
  expect(actual.filters.map(node => node.slice(0, 2))).toEqual([['lowpass', 440], ['lowpass', 880]]);
  for (const filter of actual.filters) expect(filter[2]).toBeCloseTo(20 * Math.log10(0.7), 5);
  await setKnob(page, 'frequency', '880');
  await setKnob(page, 'resonance', '2');
  for (const oscillator of ['triangle', 'sawtooth', 'square']) {
    await setKnob(page, 'oscillator', ['sine', 'triangle', 'sawtooth', 'square'].indexOf(oscillator));
    actual = await graph();
    expect(actual.oscillators.map(node => node[0])).toEqual([oscillator, oscillator, oscillator, oscillator]);
  }
  expect(actual.filters.map(node => node[1])).toEqual([880, 1760]);
  for (const filter of actual.filters) expect(filter[2]).toBeCloseTo(20 * Math.log10(2), 5);

});

test('uses the requested defaults and holds sustain at relative dB until release', async ({ page }) => {
  await openSynth(page);
  await expect(page.locator('#oscillator input')).toHaveAttribute('aria-valuetext', 'triangle');
  for (const [id, value] of [['voices', '8'], ['attack', '9'], ['decay', '1800'], ['sustain', '-12'], ['release', '2200'], ['frequency', '440'], ['resonance', '0.7']]) {
    await expect(page.locator(`#${id} input`)).toHaveValue(value);
  }
  await expect(page.getByText('Sustain (dB)', { exact: true })).toBeVisible();
  for (const [id, max] of [['attack', '1000'], ['decay', '2000'], ['voices', '32']]) {
    await expect(page.locator(`#${id} input`)).toHaveAttribute('max', max);
  }
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  const ramps = await page.evaluate(() => window.ramps);
  expect(ramps).toHaveLength(3);
  for (const [index, time] of [0, .009, 1.809].entries()) {
    expect(ramps[index].time).toBeCloseTo(time, 3);
  }
  expect(ramps[1].value).toBeCloseTo(1 / 12, 6);
  expect(ramps[2].value).toBeCloseTo((1 / 12) * 10 ** (-12 / 20), 6);
  // Move beyond the old automatic sustain timeout before releasing.
  await page.evaluate(() => {
    Object.defineProperty(window.oscillators[0].context, 'currentTime', { get: () => 120 });
  });
  await page.keyboard.up('y');
  const result = await page.evaluate(() => ({
    release: window.ramps.at(-1),
    gain: window.parameterValues.get(window.voiceGain),
  }));
  expect(result.release.time).toBeCloseTo(122.2);
  expect(result.release.value).toBe(.0001);
  expect(result.gain).toBeCloseTo((1 / 12) * 10 ** (-12 / 20), 6);
});

test('converts edited sustain dB to amplitude and releases during attack', async ({ page }) => {
  await openSynth(page);
  for (const [id, value] of [['attack', '20'], ['decay', '80'], ['sustain', '-6'], ['release', '50']]) {
    await setKnob(page, id, value);
  }
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  const ramps = await page.evaluate(() => window.ramps);
  expect(ramps).toHaveLength(3);
  expect(ramps[1].time).toBeCloseTo(.02, 3);
  expect(ramps[2].time).toBeCloseTo(.1, 3);
  expect(ramps[2].value).toBeCloseTo((1 / 12) * 10 ** (-6 / 20), 6);
  await page.keyboard.up('y');
  const release = await page.evaluate(() => window.ramps.at(-1));
  expect(release.time).toBeCloseTo(.05);
  expect(release.value).toBe(.0001);
});

test('shows audio controls below keys, preserves settings across modes, and isolates knob keyboard input', async ({ page }) => {
  await openSynth(page);
  const controls = page.getByRole('group', { name: 'Audio parameters' });
  await expect(controls).toBeVisible();
  const piano = await page.locator('.piano_keys').boundingBox();
  const box = await controls.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(piano.y + piano.height);
  await setKnob(page, 'frequency', '880');
  await page.locator('#frequency input').focus();
  await page.keyboard.press('y');
  expect(await page.evaluate(() => window.oscillators.length)).toBe(0);
  await page.locator('#midi-mode').click();
  await expect(controls).toBeHidden();
  await expect(page.locator('.midi_ports')).toBeVisible();
  await page.locator('#audio-mode').click();
  await expect(controls).toBeVisible();
  await expect(page.locator('#frequency input')).toHaveValue('880');
  await page.setViewportSize({ width: 667, height: 800 });
  const mobileBox = await controls.boundingBox();
  expect(mobileBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(667);
  await page.screenshot({ path: '/tmp/qwerkey-parameters.png', fullPage: true });
});


test('limits polyphony, prefers release tails, and applies lower limits immediately', async ({ page }) => {
  await openSynth(page);
  await page.locator('.piano_keys .key').evaluateAll(keys => {
    for (const key of keys) key.setPointerCapture = () => {};
  });
  const press = pitch => pressPiano(page, pitch);
  const release = pitch => page.locator(`.piano_keys .key_${pitch}`).dispatchEvent('pointerup', { pointerId: pitch });
  for (let pitch = 60; pitch < 68; pitch++) await press(pitch);
  expect(await page.evaluate(() => window.stops)).toEqual([]);
  await press(68);
  expect(await page.evaluate(() => window.stops)).toEqual([{ index: 0, time: .005 }, { index: 1, time: .005 }]);
  // Key-up for a stolen note cannot release a different voice.
  await release(60);
  expect(await page.evaluate(() => window.stops.length)).toBe(2);
  await release(65);
  await press(69);
  expect(await page.evaluate(() => window.stops.map(stop => stop.index))).toEqual([0, 1, 10, 11, 10, 11]);
  await setKnob(page, 'voices', '2');
  expect(await page.evaluate(() => window.stops.map(stop => stop.index))).toEqual([0, 1, 10, 11, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15]);
  await press(70);
  expect(await page.evaluate(() => window.stops.at(-1).index)).toBe(17);
  await setKnob(page, 'voices', '4');
  await press(71);
  await press(72);
  expect(await page.evaluate(() => window.stops.length)).toBe(20);
});

test('knob keyboard, drag and reset update held-note tuning', async ({ page }) => {
  test.setTimeout(60000);
  await openSynth(page);
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  await page.keyboard.up('y');
  const slider = page.getByRole('slider', { name: 'Lowpass resonance in classic Q control', exact: true });
  await setKnob(page, 'resonance', '2');
  await expect(slider).toHaveValue('2');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#resonance input')).toHaveValue('30');
  await page.keyboard.press('Home');
  await expect(page.locator('#resonance input')).toHaveValue('0.1');
  const control = page.locator('#resonance .knob_control');
  const box = await control.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 6 });
  await page.mouse.up();
  expect(Number(await page.locator('#resonance input').inputValue())).toBeGreaterThan(0.1);
  await control.dblclick();
  await expect(page.locator('#resonance input')).toHaveValue('0.7');
  expect(await page.evaluate(() => window.oscillators.length)).toBe(2);
});

test('sustain knob supports decimal values and updates the native envelope', async ({ page }) => {
  await openSynth(page);
  const slider = page.getByRole('slider', { name: 'Sustain level in decibels relative to the attack peak control', exact: true });
  await setKnob(page, 'sustain', '-6.5');
  await expect(slider).toHaveValue('-6.5');
  await slider.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#sustain input')).toHaveValue('-6.4');
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  const ramps = await page.evaluate(() => window.ramps);
  expect(ramps[2].value).toBeCloseTo((1 / 12) * 10 ** (-6.4 / 20), 6);
  await page.keyboard.up('y');
});

test('uses eight knobs with labels below and ADSR on the bottom row', async ({ page }) => {
  await openSynth(page);
  const controls = page.getByRole('group', { name: 'Audio parameters' });
  await expect(controls.getByRole('slider')).toHaveCount(8);
  await expect(controls.locator('input[type="number"], select, .parameter_fader')).toHaveCount(0);
  const layout = await controls.locator('.audio_parameter').evaluateAll(items => items.map(item => ({
    id: item.id,
    y: item.getBoundingClientRect().y,
    knobBottom: item.querySelector('.knob_control').getBoundingClientRect().bottom,
    labelTop: item.querySelector('.parameter_label').getBoundingClientRect().top,
  })));
  expect(layout.map(item => item.id)).toEqual(['oscillator', 'voices', 'frequency', 'resonance', 'attack', 'decay', 'sustain', 'release']);
  expect(new Set(layout.slice(0, 4).map(item => item.y)).size).toBe(1);
  expect(new Set(layout.slice(4).map(item => item.y)).size).toBe(1);
  expect(layout[4].y).toBeGreaterThan(layout[0].y);
  for (const item of layout) expect(item.labelTop).toBeGreaterThanOrEqual(item.knobBottom);
  const oscillator = page.getByRole('slider', { name: 'Oscillator', exact: true });
  await oscillator.focus();
  await page.keyboard.press('Home');
  await expect(oscillator).toHaveAttribute('aria-valuetext', 'sine');
  await page.keyboard.press('End');
  await expect(oscillator).toHaveAttribute('aria-valuetext', 'square');
  await page.locator('#oscillator .knob_control').dblclick();
  await expect(oscillator).toHaveAttribute('aria-valuetext', 'triangle');
});

for (const [release, noteOff] of [[0, .005], [50, .9], [2200, 3]]) {
  test(`detunes over decay and continues smoothly into ${release} ms release at ${noteOff}s`, async ({ page }) => {
    await openSynth(page);
    await expect(page.locator('#decay .parameter_label')).toHaveText('Decay (ms)');
    await setKnob(page, 'release', String(release));
    await page.locator('#instrument').focus();
    await page.keyboard.down('y');
    const held = await page.evaluate(() => ({
      ramps: window.detuneRamps,
      starts: window.oscillators.map(node => 1200 * Math.log2(window.parameterValues.get(node.frequency) / 440)),
    }));
    expect(held.starts).toEqual([0, 0]);
    expect(held.ramps).toHaveLength(2);
    expect(held.ramps[0].value).toBeCloseTo(-5, 6);
    expect(held.ramps[1].value).toBeCloseTo(5, 6);
    for (const ramp of held.ramps) expect(ramp.time).toBeCloseTo(1.80902, 6);
    await page.evaluate(time => {
      Object.defineProperty(window.oscillators[0].context, 'currentTime', { get: () => time });
    }, noteOff);
    await page.keyboard.up('y');
    const result = await page.evaluate(() => ({
      ramps: window.detuneRamps.slice(2),
      gain: window.parameterValues.get(window.voiceGain),
      starts: window.oscillators.map(node => 1200 * Math.log2(window.parameterValues.get(node.frequency) / 440)),
      stops: window.stops,
      envelope: window.ramps.at(-1),
    }));
    const peak = 1 / 12;
    const sustain = peak * 10 ** (-12 / 20);
    const level = noteOff <= .00901
      ? .0001 * (peak / .0001) ** (noteOff / .00901)
      : peak * (sustain / peak) ** Math.min(1, (noteOff - .00901) / (1.80902 - .00901));
    expect(result.gain).toBeCloseTo(level, 6);
    const spread = 5 * Math.max(0, Math.min(1, (noteOff - .00901) / (1.80902 - .00901)));
    expect(result.starts[0]).toBeCloseTo(-spread, 6);
    expect(result.starts[1]).toBeCloseTo(spread, 6);
    expect(result.ramps).toHaveLength(2);
    expect(result.ramps[0].value).toBeCloseTo(-10, 6);
    expect(result.ramps[1].value).toBeCloseTo(10, 6);
    for (const ramp of result.ramps) expect(ramp.time).toBeCloseTo(noteOff + release / 1000, 6);
    expect(result.stops.map(stop => stop.time)).toEqual([result.envelope.time, result.envelope.time]);
  });
}
