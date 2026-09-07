import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { z } from 'zod';

import { ensureE2eFaceModels } from './face-models.js';
import { awaitPeopleGridUnfolded, copyPhotoFixtures, dismissSetupWizard, ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, removeTempDir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

interface Merged {
  survivor: string;
  absorbed: string;
}

const TEST_TIMEOUT_MS = 900_000;
const GRID_UNFOLD_TIMEOUT_MS = 300_000;
const REGRID_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 10_000;

const countSchema = z.number().int().nonnegative();
const personIdSchema = z.string().min(1);
const personIdsSchema = z.array(personIdSchema);
const numberInText = z.string().transform((value) => value.match(/\d+/gu) ?? []);

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-people-pairs-userdata-'));
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  await dismissSetupWizard(page);

  return { app, page };
}

const openPeople = async (page: Page): Promise<void> => {
  await page.getByTestId('mode-library').click();
  await page.getByTestId('subnav-people').click();
};

const badgeCount = async (page: Page): Promise<number> => {
  const badge = page.getByTestId('people-pair-review-open');
  if (await badge.count() === 0) return 0;
  const text = await badge.textContent({ timeout: READ_TIMEOUT_MS });
  const digits = numberInText.parse(text ?? '');
  return countSchema.parse(Number(digits[digits.length - 1] ?? Number.NaN));
};

const position = async (page: Page): Promise<{ index: number; total: number }> => {
  const text = await page.getByTestId('people-pair-review-position').textContent({ timeout: READ_TIMEOUT_MS });
  const digits = numberInText.parse(text ?? '');
  return {
    index: countSchema.parse(Number(digits[0] ?? Number.NaN)),
    total: countSchema.parse(Number(digits[1] ?? Number.NaN)),
  };
};

const positionIndex = async (page: Page): Promise<number> => (await position(page)).index;

const currentPairIds = async (page: Page): Promise<[string, string]> => {
  const first = await page.getByTestId('people-pair-review-person-a').getAttribute('data-person-id', { timeout: READ_TIMEOUT_MS });
  const second = await page.getByTestId('people-pair-review-person-b').getAttribute('data-person-id', { timeout: READ_TIMEOUT_MS });
  return [personIdSchema.parse(first), personIdSchema.parse(second)];
};

const cardPersonIds = async (page: Page): Promise<string[]> => personIdsSchema.parse(
  await page.getByTestId('people-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-person-id'))),
);

const pairKey = (ids: readonly [string, string], merged: Merged | null): string => {
  const rekey = (id: string): string => merged !== null && id === merged.absorbed ? merged.survivor : id;
  return [rekey(ids[0]), rekey(ids[1])].sort().join('|');
};

const answerSame = async (page: Page): Promise<void> => {
  await page.keyboard.press('1');
  const confirmDialog = page.getByTestId('people-pair-review-confirm');
  const named = await confirmDialog.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false);
  if (named) await page.getByTestId('people-pair-review-confirm-accept').click();
};

const decisionCounts = async (homeDirectory: string): Promise<Record<string, number>> => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(join(homeDirectory, '.ai-video-cataloger', 'catalog.db')));
  try {
    const result = db.exec('SELECT decision, COUNT(*) FROM people_pair_decisions GROUP BY decision');
    const rows = z.array(z.tuple([z.string(), z.number()])).parse(result[0]?.values ?? []);
    return Object.fromEntries(rows);
  } finally {
    db.close();
  }
};

const runPhotosAnalysis = async (session: Session, folder: string): Promise<void> => {
  await session.page.getByTestId('mode-analysis').click();
  await stubOpenDialog(session.app, folder);
  const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
  await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
  await openFolderButton.click();
  await expect(session.page.getByText(folder)).toBeVisible({ timeout: 30_000 });

  const photosToggle = session.page.getByTestId('analysis-media-photos');
  await photosToggle.click();
  await expect(photosToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await expect(session.page.getByTestId('photos-sidebar-unscanned')).toBeHidden({ timeout: 300_000 });
};

const enableFacesAtWideScope = async (page: Page): Promise<void> => {
  await page.getByTestId('open-settings-button').click();
  const modal = page.getByTestId('settings-modal');
  await expect(modal).toBeVisible({ timeout: 15_000 });
  const facesSwitch = page.getByTestId('faces-enabled-switch');
  await expect(facesSwitch).toBeVisible({ timeout: 15_000 });
  if (!(await facesSwitch.locator('input[type="checkbox"]').isChecked())) await facesSwitch.click();
  await page.getByTestId('settings-faces-pair-scope-wide').click();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
  await expect(modal).toBeHidden({ timeout: 15_000 });
};

test.describe('People: answering "Ta sama osoba?" over a real faces pass', () => {
  test('every answer is a 30-day decision, so the walk spends four pairs at most and the decisions outlive a relaunch', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const samples = process.env.E2E_FACES_PAIR_SAMPLES;
    if (samples === undefined || samples.length === 0) {
      test.skip(true, 'Set E2E_FACES_PAIR_SAMPLES to a folder of photos of two people to run this leg');
      return;
    }
    if (!existsSync(samples)) {
      test.skip(true, `E2E_FACES_PAIR_SAMPLES does not exist: ${samples}`);
      return;
    }

    const workdir = makeEmptyWorkdir('people-pairs');
    const home = isolatedHome(workdir);
    const folder = join(workdir, 'pair-photos');
    mkdirSync(folder, { recursive: true });
    expect(copyPhotoFixtures(samples, folder)).toBeGreaterThan(0);

    const models = await ensureE2eFaceModels({ homeDirectory: home });
    expect(models.ok ? null : `${models.error.code}: ${models.error.message}`).toBeNull();

    let session = await launch(workdir);
    try {
      await runPhotosAnalysis(session, folder);
      await enableFacesAtWideScope(session.page);

      const indexButton = session.page.getByTestId('people-index');
      await expect(indexButton).toBeEnabled({ timeout: 60_000 });
      await indexButton.click();

      await openPeople(session.page);
      await awaitPeopleGridUnfolded(session.page, GRID_UNFOLD_TIMEOUT_MS);

      const badge = session.page.getByTestId('people-pair-review-open');
      await expect(badge).toBeVisible({ timeout: 60_000 });
      const badgeBefore = await badgeCount(session.page);
      expect(
        badgeBefore,
        'E2E_FACES_PAIR_SAMPLES produced fewer than three reviewable pairs at scope \'wide\' — the fixture must contain people the conservative cut splits',
      ).toBeGreaterThanOrEqual(3);
      const cardsBefore = await session.page.getByTestId('people-card').count();

      await badge.click();
      await expect(session.page.getByTestId('people-pair-review')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('people-pair-review-person-a').getByTestId('people-pair-review-crop').first())
        .toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('people-pair-review-person-b').getByTestId('people-pair-review-crop').first())
        .toBeVisible({ timeout: 15_000 });

      const opened = await position(session.page);
      expect(opened.index).toBe(1);
      const firstPairIds = await currentPairIds(session.page);

      await session.page.keyboard.press('2');
      await expect.poll(() => positionIndex(session.page), { timeout: 15_000 }).toBe(2);
      expect((await position(session.page)).total).toBe(opened.total);
      await expect.poll(() => badgeCount(session.page), { timeout: 15_000 }).toBe(badgeBefore - 1);

      await session.page.keyboard.press('Backspace');
      await expect.poll(() => positionIndex(session.page), { timeout: 15_000 }).toBe(1);
      expect(await currentPairIds(session.page)).toEqual(firstPairIds);
      expect((await position(session.page)).total).toBe(opened.total);
      await expect.poll(() => badgeCount(session.page), { timeout: 15_000 }).toBe(badgeBefore);

      await session.page.keyboard.press('3');
      await expect.poll(() => positionIndex(session.page), { timeout: 15_000 }).toBe(2);
      await expect.poll(() => badgeCount(session.page), { timeout: 15_000 }).toBe(badgeBefore - 1);

      const mergePairIds = await currentPairIds(session.page);
      expect(
        pairKey(mergePairIds, null),
        'the skipped pair is still at the head — a 30-day skip must take it out of the queue',
      ).not.toBe(pairKey(firstPairIds, null));

      await answerSame(session.page);
      await expect.poll(() => badgeCount(session.page), { timeout: 60_000 }).toBeLessThan(badgeBefore - 1);
      const badgeAfterMerge = await badgeCount(session.page);
      await expect(
        badge,
        'the queue emptied on the merge — every answer costs a pair for 30 days, so the walk must answer at most four of them',
      ).toBeVisible({ timeout: 15_000 });
      expect(badgeAfterMerge).toBeGreaterThanOrEqual(1);

      await session.page.getByTestId('people-back-main').click();
      await expect(session.page.getByTestId('people-grid')).toBeVisible({ timeout: 15_000 });
      await awaitPeopleGridUnfolded(session.page, REGRID_TIMEOUT_MS);
      await expect(session.page.getByTestId('people-card')).toHaveCount(cardsBefore - 1, { timeout: 30_000 });

      const cardIds = await cardPersonIds(session.page);
      const survivors = mergePairIds.filter((personId) => cardIds.includes(personId));
      expect(survivors, 'exactly one person of the merged pair keeps a card, and it is the survivor the merge chose').toHaveLength(1);
      const merged: Merged = {
        survivor: personIdSchema.parse(survivors[0]),
        absorbed: personIdSchema.parse(mergePairIds.find((personId) => !cardIds.includes(personId))),
      };

      const badgeBeforeRelaunch = await badgeCount(session.page);
      const counts = await decisionCounts(home);
      expect(counts['same']).toBe(1);
      expect(counts['skip'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(counts['different'] ?? 0, 'the undone answer left a decision row behind').toBe(0);

      await session.app.close();
      session = await launch(workdir);

      await openPeople(session.page);
      await awaitPeopleGridUnfolded(session.page, REGRID_TIMEOUT_MS);
      const relaunchedCardIds = await cardPersonIds(session.page);
      expect(relaunchedCardIds).toContain(merged.survivor);
      expect(relaunchedCardIds).not.toContain(merged.absorbed);
      expect(relaunchedCardIds).toHaveLength(cardsBefore - 1);

      const relaunchedBadge = session.page.getByTestId('people-pair-review-open');
      await expect(relaunchedBadge).toBeVisible({ timeout: 60_000 });
      expect(await badgeCount(session.page)).toBe(badgeBeforeRelaunch);

      await relaunchedBadge.click();
      await expect(session.page.getByTestId('people-pair-review')).toBeVisible({ timeout: 15_000 });

      const undoControl = session.page.getByTestId('people-pair-review-undo');
      await expect(undoControl).toBeDisabled();
      await session.page.keyboard.press('Backspace');
      expect(await positionIndex(session.page)).toBe(1);

      const answeredKeys = new Set([pairKey(firstPairIds, merged), pairKey(mergePairIds, merged)]);
      const empty = session.page.getByTestId('people-pair-review-empty');
      for (let step = 0; step <= badgeBeforeRelaunch; step += 1) {
        if (await empty.isVisible()) break;
        const pair = await currentPairIds(session.page);
        expect(
          answeredKeys.has(pairKey(pair, merged)),
          'an answered pair came back after the relaunch — the 30-day decision did not survive',
        ).toBe(false);
        const before = await positionIndex(session.page);
        await session.page.keyboard.press('3');
        await expect.poll(
          async () => await empty.isVisible() || await positionIndex(session.page) !== before,
          { timeout: 15_000 },
        ).toBe(true);
      }
      await expect(empty).toBeVisible({ timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(workdir);
    }
  });
});
