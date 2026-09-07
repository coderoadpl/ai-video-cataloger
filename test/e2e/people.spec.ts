import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqlJsGlobalCatalogStore } from '../../adapters/db/index.js';
import { type AppError, type Result } from '../../core/domain/index.js';
import { ensureE2eFaceModels } from './face-models.js';
import { awaitPeopleGridUnfolded, copyPhotoFixtures, desktopLaunchEnv, dismissSetupWizard, ELECTRON_MAIN, expectInactiveWindow, isolatedHome, makeEmptyWorkdir, removeTempDir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

const personCard = (page: Page, personId: string) =>
  page.locator(`[data-testid="people-card"][data-person-id="${personId}"]`);

const topmostElementAtCheckbox = async (page: Page, personId: string): Promise<string> =>
  personCard(page, personId).locator('input[type="checkbox"]').evaluate((input) => {
    const rect = input.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (hit === null) return 'none';
    if (hit === input) return 'checkbox';
    return hit.getAttribute('data-testid') ?? hit.tagName.toLowerCase();
  });

const selectPerson = async (page: Page, personId: string): Promise<void> => {
  const card = personCard(page, personId);
  await card.hover();
  await card.locator('input[type="checkbox"]').check();
};

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-people-userdata-'));
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: desktopLaunchEnv({
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

test.describe('People: enable faces, index, and rename a real grouping', () => {
  test('faces switch, real indexing over a folder, and a rename via the card menu', async () => {
    const samplePhotos = process.env.E2E_FACES_SAMPLE_PHOTOS;
    if (samplePhotos === undefined || samplePhotos.length === 0) {
      test.skip(true, 'Set E2E_FACES_SAMPLE_PHOTOS to a folder of real photos with detectable faces to run this leg');
      return;
    }
    if (!existsSync(samplePhotos)) {
      test.skip(true, `E2E_FACES_SAMPLE_PHOTOS does not exist: ${samplePhotos}`);
      return;
    }

    const folder = makeEmptyWorkdir('people-real-indexing');
    const home = isolatedHome(folder);
    expectOk(await ensureE2eFaceModels({ homeDirectory: home }));

    expect(
      copyPhotoFixtures(samplePhotos, folder),
      'E2E_FACES_SAMPLE_PHOTOS must hold at least two photos of the same person — founding an identity takes two observations (ADR-0012)',
    ).toBeGreaterThanOrEqual(2);

    const session = await launch(folder);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();

      await stubOpenDialog(session.app, folder);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      await expect(session.page.getByText(folder)).toBeVisible({ timeout: 20_000 });

      const photosToggle = session.page.getByTestId('analysis-media-photos');
      await photosToggle.click();
      await expect(photosToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await expect(session.page.getByTestId('photos-sidebar-unscanned')).toBeHidden({ timeout: 120_000 });

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const facesSwitch = session.page.getByTestId('faces-enabled-switch');
      await expect(facesSwitch).toBeVisible({ timeout: 15_000 });
      if (!(await facesSwitch.locator('input[type="checkbox"]').isChecked())) {
        await facesSwitch.click();
        await session.page.getByTestId('settings-save').click();
        await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      } else {
        await session.page.getByTestId('settings-cancel').click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      const indexButton = session.page.getByTestId('people-index');
      await expect(indexButton).toBeEnabled({ timeout: 30_000 });
      await indexButton.click();

      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-people').click();
      await awaitPeopleGridUnfolded(session.page, 300_000);
      await expect(session.page.getByTestId('people-active-job')).toBeHidden({ timeout: 300_000 });

      const card = session.page.getByTestId('people-card').first();
      const personId = (await card.getAttribute('data-person-id')) ?? '';
      expect(personId).not.toEqual('');

      await card.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-rename').click();
      const renameInput = session.page.getByTestId('people-rename-input');
      await expect(renameInput).toBeVisible({ timeout: 10_000 });
      await renameInput.fill('E2E person one');
      await session.page.getByTestId('people-rename-save').click();
      await expect(renameInput).toBeHidden({ timeout: 15_000 });

      await expect(personCard(session.page, personId).getByText('E2E person one')).toBeVisible({ timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(folder);
    }
  });
});

const MERGE_TIMESTAMP = '2026-08-16T12:00:00.000Z';
const MERGE_FOLDER_ID = '80808080-8080-4080-8080-808080808080';
const MERGE_PEOPLE = ['person-alpha', 'person-beta', 'person-gamma'] as const;
const MERGE_OBSERVATIONS_PER_PERSON = 10;

const mergeEmbedding = Array.from({ length: 128 }, (_value, index) => (index === 0 ? 1 : 0));

const expectOk = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
};

const seedMergeCatalog = async (workdir: string): Promise<{ workspacePath: string }> => {
  const homeDirectory = isolatedHome(workdir);
  const workspacePath = join(workdir, 'workspace');
  const folderPath = join(workdir, 'people-merge');
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(folderPath, { recursive: true });

  expectOk(await ensureE2eFaceModels({ homeDirectory }));

  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory });
  try {
    expectOk(await globalCatalog.upsertFolder({
      folderId: MERGE_FOLDER_ID,
      currentPath: folderPath,
      displayName: 'People Merge',
      firstSeenAt: MERGE_TIMESTAMP,
      lastSeenAt: MERGE_TIMESTAMP,
    }));
    for (const personId of MERGE_PEOPLE) {
      const fingerprint = `video-${personId}`;
      writeFileSync(join(folderPath, `${personId}.mp4`), Buffer.from([0]));
      expectOk(await globalCatalog.upsertFile({
        fingerprint,
        folderId: MERGE_FOLDER_ID,
        fileName: `${personId}.mp4`,
        size: 1,
        durationS: null,
        width: null,
        height: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: MERGE_TIMESTAMP,
        analyzer: 'harness',
        model: 'claude-code',
        missingAt: null,
        capturedAt: '2026-08-15T12:00:00.000Z',
        capturedAtSource: 'container',
        gpsSource: null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        place: null,
      }));
      expectOk(await globalCatalog.upsertAnalysis({
        fingerprint,
        finalName: null,
        description: `A clip of ${personId}.`,
        transcript: null,
        language: 'en',
        tags: [],
      }));
      expectOk(await globalCatalog.upsertPerson({
        personId,
        displayName: null,
        kind: 'face',
        createdAt: MERGE_TIMESTAMP,
        centroid: mergeEmbedding,
        exemplarCount: MERGE_OBSERVATIONS_PER_PERSON,
      }));
      for (let index = 0; index < MERGE_OBSERVATIONS_PER_PERSON; index += 1) {
        expectOk(await globalCatalog.upsertFaceObservation({
          obsId: `${fingerprint}:face:${String(index)}:1`,
          fingerprint,
          kind: 'face',
          frameTsS: index + 1,
          bbox: { x: 0, y: 0, width: 80, height: 80 },
          embedding: mergeEmbedding,
          quality: 0.9,
          personId,
          cropPath: null,
          media: 'video',
        }));
      }
    }
  } finally {
    expectOk(await globalCatalog.dispose());
  }

  return { workspacePath };
};

test.describe('People: merging several selected groupings into the named one', () => {
  test('selecting three people merges them all into the person the user named', async () => {
    const workdir = makeEmptyWorkdir('people-merge-selected');
    const { workspacePath } = await seedMergeCatalog(workdir);
    const session = await launch(workdir);
    try {
      await session.page.getByTestId('mode-analysis').click();
      await stubOpenDialog(session.app, workspacePath);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      await expect(session.page.getByText(workspacePath)).toBeVisible({ timeout: 30_000 });

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const facesSwitch = session.page.getByTestId('faces-enabled-switch');
      await expect(facesSwitch).toBeVisible({ timeout: 15_000 });
      if (!(await facesSwitch.locator('input[type="checkbox"]').isChecked())) {
        await facesSwitch.click();
        await session.page.getByTestId('settings-save').click();
        await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      } else {
        await session.page.getByTestId('settings-cancel').click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-people').click();
      await expect(session.page.getByTestId('people-card')).toHaveCount(3, { timeout: 30_000 });

      const alphaCard = personCard(session.page, 'person-alpha');
      await alphaCard.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-rename').click();
      const renameInput = session.page.getByTestId('people-rename-input');
      await expect(renameInput).toBeVisible({ timeout: 10_000 });
      await renameInput.fill('E2E Alpha');
      await session.page.getByTestId('people-rename-save').click();
      await expect(renameInput).toBeHidden({ timeout: 15_000 });
      await expect(alphaCard.getByText('E2E Alpha')).toBeVisible({ timeout: 15_000 });

      await personCard(session.page, 'person-beta').hover();
      expect(await topmostElementAtCheckbox(session.page, 'person-beta')).toBe('checkbox');

      const mergeButton = session.page.getByTestId('people-merge-selected');
      await selectPerson(session.page, 'person-beta');
      await expect(mergeButton).toBeDisabled();
      await expect(session.page.getByTestId('people-merge-hint')).toBeVisible();

      await selectPerson(session.page, 'person-alpha');
      await selectPerson(session.page, 'person-gamma');
      await expect(session.page.getByTestId('people-merge-hint')).toHaveCount(0);
      await expect(mergeButton).toBeEnabled();

      await mergeButton.click();
      const mergeBody = session.page.getByTestId('people-merge-body');
      await expect(mergeBody).toContainText('E2E Alpha', { timeout: 10_000 });
      await expect(mergeBody).toContainText('3');
      await session.page.getByTestId('people-merge-confirm').click();

      await expect(session.page.getByTestId('people-card')).toHaveCount(1, { timeout: 30_000 });
      const merged = session.page.getByTestId('people-card').first();
      await expect(merged).toHaveAttribute('data-person-id', 'person-alpha');
      await expect(merged.getByText('E2E Alpha')).toBeVisible();
      await expect(merged.getByTestId('people-card-body')).toContainText(/3\s+(videos|filmy)/);
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(workdir);
    }
  });
});
