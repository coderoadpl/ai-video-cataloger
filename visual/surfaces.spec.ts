import { expect, test } from '@playwright/test';

const SURFACES = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
  'variant-compare',
  'photos-layout',
] as const;

for (const surface of SURFACES) {
  test(surface, async ({ page }) => {
    await page.goto(`/visual.html?surface=${surface}`);
    await expect(page.getByTestId(`visual-surface-${surface}`)).toBeVisible();
    if (surface.startsWith('shell-')) {
      await expect(page.getByRole('heading', { name: 'AI Video Cataloger' })).toBeVisible();
    } else if (surface === 'variant-compare') {
      await expect(page.getByRole('heading', { name: 'Compare analysis variants' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(`${surface}.png`);
  });
}
