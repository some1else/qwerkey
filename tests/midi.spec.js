import { test, expect } from '@playwright/test';

async function openApp(page, mode = 'both', enterMidi = true) {
  page.on('request', request => {
    expect(new URL(request.url()).pathname).not.toMatch(/\/(lib|node_modules)\//);
  });
  page.on('response', response => expect(response.status()).toBeLessThan(400));
  await page.addInitScript(mode => {
    window.midiMessages = [];
    window.midiRequests = 0;
    const input = {
      id: 'input', name: 'IAC Driver Qwerkey In', type: 'input', state: 'connected',
      connection: 'open', manufacturer: 'Test', version: '1',
      open() { return Promise.resolve(this); },
    };
    const output = {
      ...input, id: 'output', name: 'IAC Driver Qwerkey Out', type: 'output',
      send(data) { window.midiMessages.push(Array.from(data)); },
    };
    const otherInput = { ...input, id: 'other-input', name: 'Other In' };
    const otherOutput = { ...output, id: 'other-output', name: 'Other Out',
      send(data) { window.otherMessages.push(Array.from(data)); },
    };
    window.otherMessages = [];
    const access = {
      inputs: new Map(['both', 'input', 'multiple', 'pending'].includes(mode) ? [['input', input]] : []),
      outputs: new Map(['both', 'output', 'multiple', 'pending'].includes(mode) ? [['output', output]] : []),
    };
    if (['multiple', 'other'].includes(mode)) {
      access.inputs.set(otherInput.id, otherInput);
      access.outputs.set(otherOutput.id, otherOutput);
    }
    window.testMidi = { access, input, output, otherInput, otherOutput };
    window.receiveNote = data => input.onmidimessage({ data: new Uint8Array(data), receivedTime: performance.now() });
    if (mode === 'unsupported') {
      Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
      return;
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: () => {
        window.midiRequests++;
        if (mode === 'pending') return new Promise(resolve => { window.resolveMidi = () => resolve(access); });
        return mode === 'denied' ? Promise.reject(new Error('Access denied')) : Promise.resolve(access);
      },
    });
  }, mode);
  await page.goto('./');
  if (enterMidi) {
    await page.locator('#enabler').click();
    await page.locator('#midi-mode').click();
  }
  await expect(page.locator('.computer_keys .key')).toHaveCount(50);
}

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

test('renders keyboard rows, piano, and Y frequency', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.computer_keys .row')).toHaveCount(5);
  await expect(page.locator('.piano_keys .key')).toHaveCount(56);
  await expect(page.locator('.computer_keys .key_6_3 .hz')).toHaveText('440 Hz');
  await expect(page.locator('.computer_keys .key_6_3 .note')).toHaveText('A 3');
});

test('sends a chord once per held key and releases each note', async ({ page }) => {
  await openApp(page);
  await page.keyboard.down('y');
  await page.keyboard.down('y');
  await page.keyboard.down('t');
  await expect(page.locator('.computer_keys .key_active')).toHaveCount(2);
  await expect(page.locator('.piano_keys .key_active')).toHaveCount(2);
  await page.keyboard.up('y');
  await expect(page.locator('.computer_keys .key_5_3')).toHaveClass(/key_active/);
  await expect(page.locator('.piano_keys .key_69')).not.toHaveClass(/key_active/);
  await page.keyboard.up('t');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.key_active')).toHaveCount(0);
  expect(await page.evaluate(() => window.midiMessages))
    .toEqual([[144, 69, 64], [144, 65, 64], [128, 69, 64], [128, 65, 64]]);
});

test('reflects incoming MIDI notes on both keyboards', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.receiveNote([144, 69, 100]));
  await expect(page.locator('.computer_keys .key_6_3')).toHaveClass(/key_active/);
  await expect(page.locator('.piano_keys .key_69')).toHaveClass(/key_active/);
  await page.evaluate(() => window.receiveNote([128, 69, 0]));
  await expect(page.locator('.key_active')).toHaveCount(0);
});

for (const mode of ['input', 'output', 'none', 'denied', 'unsupported']) {
  test(`works with MIDI mode ${mode}`, async ({ page }) => {
    await openApp(page, mode);
    await page.keyboard.down('y');
    await expect(page.locator('.computer_keys .key_6_3')).toHaveClass(/key_active/);
    await page.keyboard.up('y');
    await expect(page.locator('.key_active')).toHaveCount(0);
    expect(await page.evaluate(() => window.midiMessages))
      .toEqual(mode === 'output' ? [[144, 69, 64], [128, 69, 64]] : []);
    if (mode === 'input') {
      await page.evaluate(() => window.receiveNote([144, 69, 100]));
      await expect(page.locator('.piano_keys .key_69')).toHaveClass(/key_active/);
      await page.evaluate(() => window.receiveNote([128, 69, 0]));
      await expect(page.locator('.key_active')).toHaveCount(0);
      // Notes outside the keyboard mapping should be safe in both directions.
      await page.evaluate(() => {
        window.receiveNote([144, 1, 100]);
        window.receiveNote([128, 1, 0]);
      });
    }
  });
}

test('incoming duplicate pitch highlights every matching key until its final release', async ({ page }) => {
  await openApp(page);
  // Pitch 59 belongs to B and F1; both represent the current note.
  await page.evaluate(() => window.receiveNote([144, 59, 100]));
  await expect(page.locator('.computer_keys .key_5_1')).toHaveClass(/key_active/);
  await expect(page.locator('.computer_keys .key_2_5')).toHaveClass(/key_active/);
  await page.evaluate(() => {
    window.receiveNote([145, 59, 100]);
    window.receiveNote([128, 59, 0]);
  });
  await expect(page.locator('.computer_keys [data-pitch="59"].key_active')).toHaveCount(2);
  await page.evaluate(() => window.receiveNote([129, 59, 0]));
  await expect(page.locator('.computer_keys .key_active')).toHaveCount(0);
});

test('handles all channels, zero velocity, and unrelated MIDI messages', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.receiveNote([176, 69, 100]);
    window.receiveNote([248]);
  });
  await expect(page.locator('.key_active')).toHaveCount(0);
  await page.evaluate(() => window.receiveNote([159, 69, 100]));
  await expect(page.locator('.computer_keys .key_6_3')).toHaveClass(/key_active/);
  await page.evaluate(() => window.receiveNote([159, 69, 0]));
  await expect(page.locator('.key_active')).toHaveCount(0);
  expect(await page.evaluate(() => window.midiMessages)).toEqual([]);
});

test('removes the computer key release class after three seconds', async ({ page }) => {
  await openApp(page);
  await page.clock.install();
  await page.keyboard.press('y');
  const key = page.locator('.computer_keys .key_6_3');
  await expect(key).toHaveClass(/key_inactive/);
  await page.clock.fastForward(3000);
  await expect(key).not.toHaveClass(/key_inactive/);
});

for (const mode of ['both', 'input', 'output', 'other', 'none', 'denied', 'unsupported']) {
  test(`port selectors use independent defaults: ${mode}`, async ({ page }) => {
    await openApp(page, mode);
    await expect(page.locator('#midi-input')).toHaveValue(['both', 'input'].includes(mode) ? 'input' : '');
    await expect(page.locator('#midi-output')).toHaveValue(['both', 'output'].includes(mode) ? 'output' : '');
    await expect(page.locator('#midi-input option').first()).toHaveText('-- Choose MIDI port --');
    if (mode === 'other') await expect(page.locator('#midi-input option')).toHaveCount(2);
  });
}

test('switches routing, releases old notes, and supports deselection', async ({ page }) => {
  await openApp(page, 'multiple');
  await page.keyboard.down('y');
  await page.locator('#midi-output').selectOption('other-output');
  expect(await page.evaluate(() => window.midiMessages)).toEqual([[144, 69, 64], [128, 69, 64]]);
  await page.keyboard.up('y');
  await page.locator('#midi-output').evaluate(element => element.blur());
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.otherMessages)).toEqual([[144, 65, 64], [128, 65, 64]]);
  await page.locator('#midi-output').selectOption('');
  await page.locator('#midi-output').evaluate(element => element.blur());
  await page.keyboard.press('y');
  expect(await page.evaluate(() => window.otherMessages)).toHaveLength(2);
  await page.evaluate(() => window.receiveNote([144, 69, 100]));
  await page.locator('#midi-input').selectOption('other-input');
  await expect(page.locator('.key_active')).toHaveCount(0);
  expect(await page.evaluate(() => window.testMidi.input.onmidimessage)).toBeNull();
  await page.evaluate(() => window.testMidi.otherInput.onmidimessage({ data: new Uint8Array([144, 65, 100]) }));
  await expect(page.locator('.piano_keys .key_65')).toHaveClass(/key_active/);
  await page.locator('#midi-input').selectOption('');
  await expect(page.locator('.key_active')).toHaveCount(0);
});

test('refreshes devices without overriding choices and clears disconnected selections', async ({ page }) => {
  await openApp(page, 'multiple');
  await page.locator('#midi-input').selectOption('other-input');
  await page.locator('#midi-output').selectOption('');
  await page.evaluate(() => {
    const { access, otherInput } = window.testMidi;
    access.outputs.set('new', { ...window.testMidi.output, id: 'new', name: 'New Out' });
    access.onstatechange();
    otherInput.state = 'disconnected';
    access.onstatechange();
  });
  await expect(page.locator('#midi-input')).toHaveValue('');
  await expect(page.locator('#midi-output')).toHaveValue('');
  await expect(page.locator('#midi-input option')).toHaveCount(2);
  await expect(page.locator('#midi-output option')).toHaveCount(4);
});

test('dropdown keyboard navigation does not play notes', async ({ page }) => {
  await openApp(page, 'multiple');
  await page.locator('#midi-input').focus();
  await page.locator('#midi-input').selectOption('other-input');
  await expect(page.locator('#midi-input')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('y');
  await page.keyboard.press('Tab');
  await expect(page.locator('#midi-output')).toBeFocused();
  expect(await page.evaluate(() => window.midiMessages)).toEqual([]);
  await expect(page.locator('.key_active')).toHaveCount(0);
});

test('places port controls below the piano within the minimum page width', async ({ page }) => {
  await openApp(page);
  const controls = page.locator('.midi_ports');
  const output = page.locator('.midi_port').last();
  const input = page.locator('.midi_port').first();
  const pianoBox = await page.locator('.piano_keys').boundingBox();
  const controlsBox = await controls.boundingBox();
  expect(controlsBox.y).toBeGreaterThanOrEqual(pianoBox.y + pianoBox.height);
  expect((await output.boundingBox()).y).toBeGreaterThan((await input.boundingBox()).y);
  await controls.screenshot({ path: '/tmp/qwerkey-ports-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const outputBox = await output.boundingBox();
  const inputBox = await input.boundingBox();
  expect(inputBox.y).toBeLessThan(outputBox.y);
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(667);
  await controls.screenshot({ path: '/tmp/qwerkey-ports-mobile.png' });
});

test('Audio and MIDI share a stable controls row above 667px', async ({ page }) => {
  await page.setViewportSize({ width: 668, height: 900 });
  await openApp(page, 'both', false);
  await page.locator('#enabler').click();
  const layout = () => page.locator('.computer_keys, .piano_scroll, .sound_controls')
    .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  const audioLayout = await layout();
  await expect(page.getByRole('slider')).toHaveCount(10);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.locator('#midi-mode').click();
  await expect(page.getByRole('combobox')).toHaveCount(2);
  expect(await layout()).toEqual(audioLayout);
  await page.locator('#audio-mode').click();
  expect(await layout()).toEqual(audioLayout);
  await page.setViewportSize({ width: 667, height: 900 });
  expect(await page.locator('.midi_ports').evaluate(row => row.getClientRects().length)).toBe(0);
});

test('defaults to Audio behind the splash and delays MIDI access', async ({ page }) => {
  await openApp(page, 'both', false);
  await expect(page.locator('#audio-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.overlay')).toBeVisible();
  await expect(page.locator('.midi_ports')).toBeHidden();
  await page.keyboard.press('y');
  await expect(page.locator('.key_active')).toHaveCount(0);
  await page.locator('#enabler').click();
  await page.keyboard.press('y');
  expect(await page.evaluate(() => window.midiRequests)).toBe(0);
  expect(await page.evaluate(() => window.midiMessages)).toEqual([]);
  const switchBox = await page.locator('.mode_switch').first().boundingBox();
  const keyboardBox = await page.locator('.computer_keys').boundingBox();
  expect(switchBox.y + switchBox.height).toBeLessThan(keyboardBox.y);
  await page.screenshot({ path: '/tmp/qwerkey-audio-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mode_switch').first()).toBeVisible();
});

test('switching releases audio and MIDI notes and preserves selected ports', async ({ page }) => {
  await openApp(page, 'multiple');
  await page.evaluate(() => {
    window.releases = 0;
    const cancel = AudioParam.prototype.cancelScheduledValues;
    AudioParam.prototype.cancelScheduledValues = function (...args) {
      window.releases++;
      return cancel.apply(this, args);
    };
  });
  await page.locator('#midi-output').selectOption('other-output');
  await page.locator('#audio-mode').click();
  await page.keyboard.down('y');
  await page.locator('#midi-mode').click();
  expect(await page.evaluate(() => window.releases)).toBe(1);
  expect(await page.locator('.key_active, .key_inactive').count()).toBe(0);
  await page.keyboard.up('y');
  await page.keyboard.down('t');
  await page.evaluate(() => window.receiveNote([144, 69, 100]));
  await page.locator('#audio-mode').click();
  expect(await page.evaluate(() => window.otherMessages)).toEqual([[144, 65, 64], [128, 65, 64]]);
  expect(await page.locator('.key_active, .key_inactive').count()).toBe(0);
  await page.evaluate(() => window.receiveNote([144, 69, 100]));
  await expect(page.locator('.key_active')).toHaveCount(0);
  await page.keyboard.up('t');
  await page.locator('#midi-mode').click();
  await expect(page.locator('#midi-output')).toHaveValue('other-output');
  expect(await page.evaluate(() => window.midiRequests)).toBe(1);
});

test('a late MIDI permission response stays inactive in Audio mode', async ({ page }) => {
  await openApp(page, 'pending');
  await page.locator('#audio-mode').click();
  await page.evaluate(() => window.resolveMidi());
  await expect(page.locator('#midi-input')).toHaveValue('input');
  await page.evaluate(() => window.receiveNote([144, 69, 100]));
  await page.keyboard.press('y');
  await expect(page.locator('.key_active')).toHaveCount(0);
  expect(await page.evaluate(() => window.midiMessages)).toEqual([]);
});

test('Safari blocks MIDI with an alert for pointer and keyboard activation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    });
  });
  await openApp(page, 'both', false);
  await page.locator('#enabler').click();
  await expect(page.locator('#midi-mode')).toHaveAttribute('aria-disabled', 'true');
  const alerts = [];
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
  // aria-disabled keeps the explanatory action available, so use a real pointer.
  const box = await page.locator('#midi-mode').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('#midi-mode').focus();
  await page.keyboard.press('Enter');
  expect(alerts).toHaveLength(2);
  expect(alerts[0]).toContain('unavailable in Safari');
  await expect(page.locator('#audio-mode')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.midiRequests)).toBe(0);
});

test('pointer and keyboard share MIDI notes and every piano pitch can play', async ({ page }) => {
  await openApp(page);
  await page.keyboard.down('y');
  await page.locator('.piano_keys .key_69').hover();
  await page.mouse.down();
  await page.keyboard.up('y');
  expect(await page.evaluate(() => window.midiMessages)).toEqual([[144, 69, 64]]);
  await page.mouse.up();
  await page.locator('.piano_keys .key_42').click();
  expect(await page.evaluate(() => window.midiMessages)).toEqual([
    [144, 69, 64], [128, 69, 64], [144, 42, 64], [128, 42, 64],
  ]);
});
