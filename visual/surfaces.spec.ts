import { expect, test } from '@playwright/test';

const SURFACES = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
  'shell-backup-idle',
  'shell-backup-running',
  'shell-backup-failed',
  'variant-compare',
  'catalog-sidebar-narrow',
  'catalog-sidebar-wide',
  'photos-sidebar-narrow',
  'photos-sidebar-wide',
  'people-pair-review',
  'people-pair-review-alerts',
  'people-pair-review-empty',
  'people-header',
] as const;

for (const surface of SURFACES) {
  test(surface, async ({ page }) => {
    await page.goto(`/visual.html?surface=${surface}`);
    await expect(page.getByTestId(`visual-surface-${surface}`)).toBeVisible();
    if (surface.startsWith('shell-')) {
      await expect(page.getByRole('heading', { name: 'AI Video Cataloger' })).toBeVisible();
    } else if (surface === 'variant-compare') {
      await expect(page.getByRole('heading', { name: 'Compare analysis variants' })).toBeVisible();
    } else if (surface === 'people-pair-review') {
      await expect(page.getByTestId('people-pair-review-question')).toBeVisible();
      await expect(page.getByTestId('people-pair-review-position')).toHaveText('1 of 6');
    } else if (surface === 'people-header') {
      await expect(page.getByTestId('people-threshold-button')).toHaveText('Min. observations: 10');
      await expect(page.getByTestId('people-pair-review-open')).toHaveText('Review look-alikes (200+)');
    } else if (surface === 'people-pair-review-empty') {
      await expect(page.getByTestId('people-pair-review-empty')).toBeVisible();
    } else if (surface === 'people-pair-review-alerts') {
      await expect(page.getByTestId('people-pair-review-error')).toBeVisible();
      await expect(page.getByTestId('people-pair-review-not-undoable')).toBeVisible();
      await expect(page.getByTestId('people-pair-review-truncated')).toBeVisible();
      await expect(page.getByTestId('people-pair-review-undo')).toBeEnabled();
    } else {
      await expect(page.getByTestId('sidebar-folder-panel')).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(`${surface}.png`);
  });
}
