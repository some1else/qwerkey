import { test, expect } from '@playwright/test';
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
    await page.locator('#attack').fill('123');
    await page.screenshot({ path: `/tmp/qwerkey-just-play-${width}.png` });
    await page.locator('#midi-mode').click();
    const input = await page.locator('#midi-input').boundingBox();
    const output = await page.locator('#midi-output').boundingBox();
    expect(input.x).toBe(output.x);
    expect(input.y + input.height).toBeLessThan(output.y);
    await page.screenshot({ path: `/tmp/qwerkey-midi-${width}.png` });
    await page.locator('#buffer-mode').click();
    await expect(page.locator('.output_controls')).toBeHidden();
    await expect(page.locator('.buffer_toolbar')).toHaveCount(0);
    await expect(page.locator('.roll_velocity')).toBeVisible();
    await page.screenshot({ path: `/tmp/qwerkey-buffer-${width}.png` });
    await page.locator('#keyboard-mode').click();
    await expect(page.locator('#midi-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#audio-mode').click();
    await expect(page.locator('#attack')).toHaveValue('123');
    await page.locator('#buffer-mode').click();
    await page.setViewportSize({ width: 667, height: 1000 });
    await expect(page.locator('#keyboard-mode')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#buffer-mode')).toBeHidden();
  });
}
