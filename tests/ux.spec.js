import { test, expect } from '@playwright/test';
async function setKnob(page, id, value) {
  await page.locator(`#${id} input[type="range"]`).evaluate((input, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}


for (const width of [1000, 668]) {
  test(`view and output layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./');
    await page.locator('#enabler').click();
    await expect(page.getByRole('tab')).toHaveText(['Keyboard', 'Buffer']);
    await expect(page.getByRole('button', { name: /^(Play|Stop) buffer$/ })).toHaveCount(0);
    const controls = await page.locator('.audio_parameter').evaluateAll(items => items.map(item => {
      const { x, y } = item.getBoundingClientRect(); return { x, y };
    }));
    expect(new Set(controls.map(item => item.x)).size).toBe(4);
    expect(new Set(controls.map(item => item.y)).size).toBe(2);
    await setKnob(page, 'attack', 123);
    await page.screenshot({ path: `/tmp/qwerkey-just-play-${width}.png` });
    await page.locator('#midi-mode').click();
    const input = await page.locator('#midi-input').boundingBox();
    const output = await page.locator('#midi-output').boundingBox();
    expect(input.x).toBe(output.x);
    expect(input.y + input.height).toBeLessThan(output.y);
    await page.screenshot({ path: `/tmp/qwerkey-midi-${width}.png` });
    await page.locator('#buffer-mode').click();
    await expect(page.locator('.output_controls')).toBeVisible();
    await expect(page.locator('.buffer_toolbar')).toBeVisible();
    await expect(page.locator('.roll_velocity')).toBeVisible();
    await page.screenshot({ path: `/tmp/qwerkey-buffer-${width}.png` });
    await page.locator('#keyboard-mode').click();
    await expect(page.locator('#midi-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#audio-mode').click();
    await expect(page.locator('#attack input')).toHaveValue('123');
    await page.locator('#buffer-mode').click();
    await page.setViewportSize({ width: 667, height: 1000 });
    await expect(page.locator('#keyboard-mode')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#buffer-mode')).toBeHidden();
  });
}

test('Buffer actions and shared output controls preserve settings and playback highlights', async ({ page }) => {
  await page.goto('./');
  await page.locator('#enabler').click();
  await expect(page.locator('#audio-mode')).toHaveText('Audio');
  await expect(page.locator('#midi-mode')).toHaveText('Midi');
  await expect(page.locator('#attack input')).toHaveAttribute('type', 'range');
  await setKnob(page, 'attack', 12);
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  await page.waitForTimeout(800);
  await page.keyboard.up('y');
  await page.locator('#buffer-mode').click();
  await expect(page.locator('#attack input')).toHaveValue('12');
  await expect(page.locator('#audio-mode')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download entire buffer', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('qwerkey-buffer.mid');
  await page.getByRole('button', { name: 'Play loop', exact: true }).click();
  await page.locator('#keyboard-mode').click();
  await expect(page.locator('.computer_keys [data-pitch="69"]')).toHaveClass(/key_active/);
  await page.locator('#instrument').focus();
  await page.keyboard.down('y');
  await page.keyboard.up('y');
  await expect(page.locator('.computer_keys [data-pitch="69"]')).toHaveClass(/key_active/);
  await page.locator('#buffer-mode').click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('#keyboard-mode').click();
  await expect(page.locator('.computer_keys .key_active')).toHaveCount(0);
  await page.locator('#buffer-mode').click();
  await page.getByRole('button', { name: 'Clear buffer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.roll_note')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Clear buffer', exact: true }).click();
  await page.getByRole('button', { name: 'Clear recording', exact: true }).click();
  await expect(page.locator('.roll_note')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play loop', exact: true })).toBeDisabled();
});
