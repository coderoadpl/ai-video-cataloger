import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { z } from 'zod';

import { ensureE2eFaceModels } from './face-models.js';
import { awaitPeopleGridUnfolded, dismissSetupWizard, ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, removeTempDir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

const countSchema = z.number().int().nonnegative();
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
  const text = await page.getByTestId('people-pair-review-open').textContent();
  const digits = numberInText.parse(text ?? '');
  return countSchema.parse(Number(digits[digits.length - 1] ?? Number.NaN));
};

const position = async (page: Page): Promise<{ index: number; total: number }> => {
  const text = await page.getByTestId('people-pair-review-position').textContent();
  const digits = numberInText.parse(text ?? '');
  return {
    index: countSchema.parse(Number(digits[0] ?? Number.NaN)),
    total: countSchema.parse(Number(digits[1] ?? Number.NaN)),
  };
};

const currentPairIds = async (page: Page): Promise<[string, string]> => {
  const first = await page.getByTestId('people-pair-review-person-a').getAttribute('data-person-id');
  const second = await page.getByTestId('people-pair-review-person-b').getAttribute('data-person-id');
  return [z.string().min(1).parse(first), z.string().min(1).parse(second)];
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

const copyFixtures = (source: string, target: string): number => {
  const files = readdirSync(source).filter((name) => statSync(join(source, name)).isFile() && !name.startsWith('.'));
  for (const name of files) copyFileSync(join(source, name), join(target, name));
  return files.length;
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
  test('the queue is answered with the keyboard, undone, and the decisions outlive a relaunch', async () => {
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
    expect(copyFixtures(samples, folder)).toBeGreaterThan(0);

    const models = await ensureE2eFaceModels({ homeDirectory: home });
    if (!models.ok) {
      test.skip(true, `Face model artifacts unavailable in this environment: ${models.error.message}`);
      return;
    }

    let session = await launch(workdir);
    try {
      await runPhotosAnalysis(session, folder);
      await enableFacesAtWideScope(session.page);

      const indexButton = session.page.getByTestId('people-index');
      await expect(indexButton).toBeEnabled({ timeout: 60_000 });
      await indexButton.click();

      await openPeople(session.page);
      await awaitPeopleGridUnfolded(session.page, 600_000);

      const badge = session.page.getByTestId('people-pair-review-open');
      await expect(badge).toBeVisible({ timeout: 60_000 });
      const badgeBefore = await badgeCount(session.page);
      expect(
        badgeBefore,
        'E2E_FACES_PAIR_SAMPLES produced fewer than two reviewable pairs at scope \'wide\' — the fixture must contain people the conservative cut splits',
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
      await expect.poll(async () => (await position(session.page)).index, { timeout: 15_000 }).toBe(2);
      expect((await position(session.page)).total).toBe(opened.total);
      await expect.poll(() => badgeCount(session.page), { timeout: 15_000 }).toBe(badgeBefore - 1);

      await session.page.keyboard.press('Backspace');
      await expect.poll(async () => (await position(session.page)).index, { timeout: 15_000 }).toBe(1);
      expect(await currentPairIds(session.page)).toEqual(firstPairIds);
      expect((await position(session.page)).total).toBe(opened.total);
      await expect.poll(() => badgeCount(session.page), { timeout: 15_000 }).toBe(badgeBefore);

      await session.page.keyboard.press('2');
      await expect.poll(async () => (await position(session.page)).index, { timeout: 15_000 }).toBe(2);

      let disjoint = false;
      for (let step = 0; step < badgeBefore && !disjoint; step += 1) {
        if (await session.page.getByTestId('people-pair-review-empty').isVisible()) break;
        const pair = await currentPairIds(session.page);
        if (!pair.some((personId) => firstPairIds.includes(personId))) {
          disjoint = true;
          break;
        }
        const before = (await position(session.page)).index;
        await session.page.keyboard.press('3');
        await expect.poll(async () => (await position(session.page)).index, { timeout: 15_000 }).toBe(before + 1);
      }
      expect(
        disjoint,
        'no candidate pair disjoint from the first pair — the fixture must produce at least one, see the fixture precondition',
      ).toBe(true);

      await session.page.keyboard.press('1');
      await expect.poll(() => badgeCount(session.page), { timeout: 30_000 }).toBeLessThan(badgeBefore);

      await session.page.getByTestId('people-back-main').click();
      await expect(session.page.getByTestId('people-grid')).toBeVisible({ timeout: 15_000 });
      await awaitPeopleGridUnfolded(session.page, 30_000);
      await expect(session.page.getByTestId('people-card')).toHaveCount(cardsBefore - 1, { timeout: 30_000 });

      const badgeBeforeRelaunch = await badgeCount(session.page);
      const counts = await decisionCounts(home);
      expect(counts['same']).toBe(1);
      expect(counts['different'] ?? 0).toBeGreaterThanOrEqual(1);

      await session.app.close();
      session = await launch(workdir);

      await openPeople(session.page);
      const relaunchedBadge = session.page.getByTestId('people-pair-review-open');
      await expect(relaunchedBadge).toBeVisible({ timeout: 60_000 });
      expect(await badgeCount(session.page)).toBe(badgeBeforeRelaunch);

      await relaunchedBadge.click();
      await expect(session.page.getByTestId('people-pair-review')).toBeVisible({ timeout: 15_000 });

      const undoControl = session.page.getByTestId('people-pair-review-undo');
      await expect(undoControl).toBeDisabled();
      await session.page.keyboard.press('Backspace');
      expect((await position(session.page)).index).toBe(1);

      for (let step = 0; step <= badgeBeforeRelaunch; step += 1) {
        if (await session.page.getByTestId('people-pair-review-empty').isVisible()) break;
        const pair = await currentPairIds(session.page);
        expect(
          pair[0] === firstPairIds[0] && pair[1] === firstPairIds[1],
          'the pair answered "Nie" came back after the relaunch — the decision did not survive',
        ).toBe(false);
        expect(pair[0] === firstPairIds[1] && pair[1] === firstPairIds[0]).toBe(false);
        const before = (await position(session.page)).index;
        await session.page.keyboard.press('3');
        await expect.poll(async () => {
          if (await session.page.getByTestId('people-pair-review-empty').isVisible()) return before + 1;
          return (await position(session.page)).index;
        }, { timeout: 15_000 }).toBe(before + 1);
      }
      await expect(session.page.getByTestId('people-pair-review-empty')).toBeVisible({ timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(workdir);
    }
  });
});
