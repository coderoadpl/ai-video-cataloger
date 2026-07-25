import { expect, test } from '@playwright/test';

const SURFACES = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
] as const;

for (const surface of SURFACES) {
  test(surface, async ({ page }) => {
    await page.goto(`/visual.html?surface=${surface}`);
    await expect(page.getByTestId(`visual-surface-${surface}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI Video Cataloger' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(`${surface}.png`);
  });
}
