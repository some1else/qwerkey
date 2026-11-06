import { test, expect } from '@playwright/test';

async function openApp(page, mode = 'both') {
  page.on('request', request => {
    expect(new URL(request.url()).pathname).not.toMatch(/\/(lib|node_modules)\//);
  });
  page.on('response', response => expect(response.status()).toBeLessThan(400));
  await page.addInitScript(mode => {
    window.midiMessages = [];
    const input = {
      id: 'input', name: 'Qwerkey In', type: 'input', state: 'connected',
      connection: 'open', manufacturer: 'Test', version: '1',
      open() { return Promise.resolve(this); },
    };
    const output = {
      ...input, id: 'output', name: 'Qwerkey Out', type: 'output',
      send(data) { window.midiMessages.push(Array.from(data)); },
    };
    window.receiveNote = data => input.onmidimessage({ data: new Uint8Array(data), receivedTime: performance.now() });
    if (mode === 'unsupported') {
      Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
      return;
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: () => mode === 'denied' ? Promise.reject(new Error('Access denied')) : Promise.resolve({
        inputs: new Map(['both', 'input'].includes(mode) ? [['input', input]] : []),
        outputs: new Map(['both', 'output'].includes(mode) ? [['output', output]] : []),
      }),
    });
  }, mode);
  await page.goto('./');
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

test('incoming duplicate pitch uses the first layout mapping', async ({ page }) => {
  await openApp(page);
  // Pitch 59 belongs to B and F1. The original lookup chooses B first.
  await page.evaluate(() => window.receiveNote([144, 59, 100]));
  await expect(page.locator('.computer_keys .key_5_1')).toHaveClass(/key_active/);
  await expect(page.locator('.computer_keys .key_2_5')).not.toHaveClass(/key_active/);
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
