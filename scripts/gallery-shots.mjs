import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const SHOTS_DIR =
  process.env.GALLERY_SHOTS_DIR ?? path.join(process.cwd(), '.gallery-shots');
const CONFIG_FILE = path.join(process.cwd(), 'apps/web/vite.config.ts');
const PORT = 9481;

const SPECIMEN_IDS = [
  'badge-pending',
  'badge-completed',
  'badge-in-progress',
  'badge-processing',
  'badge-error',
  'badge-not-tracked',
  'badge-duplicate',
  'badge-skipped',
  'tag-chips',
  'thumb-placeholder',
  'thumb-loading',
  'thumb-landscape',
  'thumb-portrait',
  'row-folder',
  'row-video',
  'row-video-duplicate',
  'model-row-active',
  'model-row-downloaded',
  'model-row-missing',
  'buttons',
  'callout',
];

const ICON_BADGE_IDS = [
  'badge-pending',
  'badge-completed',
  'badge-in-progress',
  'badge-processing',
  'badge-error',
  'badge-not-tracked',
  'badge-duplicate',
  'badge-skipped',
];

const round = (value) => Math.round(value * 100) / 100;

const measureInset = async (page, testid) => {
  const chip = page.locator(`[data-testid="${testid}"] .MuiChip-root`);
  const icon = page.locator(`[data-testid="${testid}"] .MuiChip-icon`);
  if ((await icon.count()) === 0) return null;
  const chipBox = await chip.boundingBox();
  const iconBox = await icon.boundingBox();
  if (chipBox === null || iconBox === null) return null;
  return {
    leftInset: round(iconBox.x - chipBox.x),
    iconToLabel: round(chipBox.x + chipBox.width - (iconBox.x + iconBox.width)),
    chipWidth: round(chipBox.width),
  };
};

const run = async () => {
  await mkdir(SHOTS_DIR, { recursive: true });

  const server = await createServer({
    configFile: CONFIG_FILE,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true },
  });
  await server.listen();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1600 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/gallery.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gallery-panel-light"]');

  for (const mode of ['light', 'dark']) {
    const panel = page.locator(`[data-testid="gallery-panel-${mode}"]`);
    await panel.screenshot({ path: `${SHOTS_DIR}/panel-${mode}.png` });
  }

  for (const mode of ['light', 'dark']) {
    for (const id of SPECIMEN_IDS) {
      const testid = `spec-${mode}-${id}`;
      const el = page.locator(`[data-testid="${testid}"]`);
      if ((await el.count()) === 0) continue;
      await el.screenshot({ path: `${SHOTS_DIR}/${testid}.png` });
    }
  }

  const measurements = {};
  for (const mode of ['light', 'dark']) {
    for (const id of ICON_BADGE_IDS) {
      const testid = `spec-${mode}-${id}`;
      measurements[testid] = await measureInset(page, testid);
    }
  }

  await writeFile(`${SHOTS_DIR}/measurements.json`, JSON.stringify(measurements, null, 2));

  console.log('Badge icon inset measurements (px):');
  for (const [testid, value] of Object.entries(measurements)) {
    if (value === null) {
      console.log(`  ${testid}: no icon`);
      continue;
    }
    console.log(
      `  ${testid}: leftInset=${value.leftInset} iconToLabel=${value.iconToLabel} chipWidth=${value.chipWidth}`,
    );
  }

  await browser.close();
  await server.close();
};

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
