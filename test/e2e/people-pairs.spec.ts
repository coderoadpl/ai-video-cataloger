import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { z } from 'zod';

import { ensureE2eFaceModels } from './face-models.js';
import { awaitPeopleGridUnfolded, copyPhotoFixtures, desktopLaunchEnv, dismissSetupWizard, ELECTRON_MAIN, expectInactiveWindow, isolatedHome, makeEmptyWorkdir, removeTempDir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

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
const SETTLE_TIMEOUT_MS = 60_000;
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
    env: desktopLaunchEnv(userDataDir, {
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    }),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expectInactiveWindow(app);
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  await dismissSetupWizard(page);

  return { app, page };
}

const openPeople = async (page: Page): Promise<void> => {
  await page.getByTestId('mode-library').click();
  await page.getByTestId('subnav-people').click();
};

const badgeCount = async (page: Page): Promise<number> => {
  const state = page.getByTestId('people-pairs-query');
  await expect(state).toHaveAttribute('data-query-status', /^(success|error)$/, { timeout: SETTLE_TIMEOUT_MS });
  await expect(state).toHaveAttribute('data-query-status', 'success');
  await expect(state).toHaveAttribute('data-fetch-status', 'idle', { timeout: SETTLE_TIMEOUT_MS });
  return countSchema.parse(Number(z.string().regex(/^\d+$/).parse(await state.getAttribute('data-pending'))));
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

const currentPairKey = async (page: Page, merged: Merged | null): Promise<string> => pairKey(await currentPairIds(page), merged);

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
  test('a "Nie", its undo, a "Pomiń" and a "Tak" are answered on the real surface and outlive a relaunch', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const samples = process.env.E2E_FACES_PAIR_SAMPLES;
    if (samples === undefined || samples.length === 0) {
      test.skip(true, 'Set E2E_FACES_PAIR_SAMPLES to a folder of photos of a few people to run this leg');
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
        'the fixture must contain at least two candidate pairs at scope wide',
      ).toBeGreaterThanOrEqual(2);
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
      await expect.poll(() => badgeCount(session.page), { timeout: SETTLE_TIMEOUT_MS }).toBe(badgeBefore - 1);
      expect((await position(session.page)).total).toBe(opened.total);

      await session.page.keyboard.press('Backspace');
      await expect.poll(() => positionIndex(session.page), { timeout: 15_000 }).toBe(1);
      await expect.poll(() => badgeCount(session.page), { timeout: SETTLE_TIMEOUT_MS }).toBe(badgeBefore);
      await expect
        .poll(() => currentPairKey(session.page, null), {
          message: 'the undo did not bring the answered pair back to the head of the queue',
          timeout: 15_000,
        })
        .toBe(pairKey(firstPairIds, null));
      expect((await position(session.page)).total).toBe(opened.total);

      await session.page.keyboard.press('3');
      await expect.poll(() => positionIndex(session.page), { timeout: 15_000 }).toBe(2);
      await expect.poll(() => badgeCount(session.page), { timeout: SETTLE_TIMEOUT_MS }).toBe(badgeBefore - 1);
      await expect
        .poll(() => currentPairKey(session.page, null), {
          message: 'the skipped pair is still at the head — a 30-day skip must take it out of the queue',
          timeout: SETTLE_TIMEOUT_MS,
        })
        .not.toBe(pairKey(firstPairIds, null));
      const mergePairIds = await currentPairIds(session.page);

      await answerSame(session.page);
      await expect
        .poll(() => badgeCount(session.page), {
          message: 'the merge left the pending count untouched — the merged pair must leave the queue',
          timeout: SETTLE_TIMEOUT_MS,
        })
        .not.toBe(badgeBefore - 1);
      const pendingAfterMerge = await badgeCount(session.page);

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

      await expect
        .poll(() => decisionCounts(home), {
          message: 'the stored decisions are not one skip and one same — the undone "Nie" must leave no row behind',
          timeout: 30_000,
        })
        .toEqual({ skip: 1, same: 1 });
      const counts = await decisionCounts(home);

      await session.app.close();
      session = await launch(workdir);

      await openPeople(session.page);
      await awaitPeopleGridUnfolded(session.page, REGRID_TIMEOUT_MS);
      const relaunchedCardIds = await cardPersonIds(session.page);
      expect(relaunchedCardIds).toContain(merged.survivor);
      expect(relaunchedCardIds).not.toContain(merged.absorbed);
      expect(relaunchedCardIds).toHaveLength(cardsBefore - 1);

      expect(await badgeCount(session.page)).toBe(pendingAfterMerge);
      const relaunchedBadge = session.page.getByTestId('people-pair-review-open');
      if (pendingAfterMerge === 0) {
        await expect(relaunchedBadge).toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS });
      } else {
        await expect(relaunchedBadge).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
      }
      await expect
        .poll(() => badgeCount(session.page), {
          message: 'the pending count changed across the relaunch — the decisions did not survive it',
          timeout: SETTLE_TIMEOUT_MS,
        })
        .toBe(pendingAfterMerge);

      if (pendingAfterMerge > 0) {
        await relaunchedBadge.click();
        await expect(session.page.getByTestId('people-pair-review')).toBeVisible({ timeout: 15_000 });

        await expect(session.page.getByTestId('people-pair-review-undo')).toBeDisabled();
        await session.page.keyboard.press('Backspace');
        expect(await positionIndex(session.page)).toBe(1);

        const answeredKeys = new Set([pairKey(firstPairIds, merged), pairKey(mergePairIds, merged)]);
        expect(
          answeredKeys.has(await currentPairKey(session.page, merged)),
          'an answered pair came back after the relaunch — the decision did not survive',
        ).toBe(false);
      }

      expect(await decisionCounts(home), 'the stored decisions changed across the relaunch').toEqual(counts);
    } finally {
      await session.app.close();
      await removeTempDir(workdir);
    }
  });
});
